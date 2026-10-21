/* Text-to-speech proxy + provider status. Provider resolution lives in
 * ../lib/tts-synth.ts so this route and the chat agent stay in sync. /status
 * powers the editor's readiness gate + the Timeline Global Settings voice picker. */
import { Hono } from "hono";
import {
	plannedTtsProviderId,
	selectedTtsProviderId,
	ttsSelectionSource,
} from "../lib/tts-synth.ts";
import { synthesizeBilledTts } from "../lib/generation/billed-tts.ts";
import { measureOrProbeAudioDurationSec } from "../lib/audio-duration.ts";
import { effectiveVoiceCatalogue, ttsProviderCatalogue } from "../lib/voice-catalogue-source.ts";
import { ttsBody } from "./request-schemas.ts";
import { oneOf } from "@maleo/shared";
import { getContentProject } from "@maleo/db/project-detail";
import {
	ABSENT_WORKSPACE_RESOLVES_TO,
	activeWorkspace,
	unknownWorkspaceRefusal,
	workspaceScope,
} from "../lib/active-workspace.ts";
import { storeManagedMedia } from "../lib/media-storage.ts";
import {
	openGeneration,
	resolveSpeechCompleted,
	resolveFailed,
	listSpeech,
	speechFacets,
	softDeleteImage,
	toggleStar,
	SPEECH_SOURCES,
} from "@maleo/db/image-ledger";

/* The longest text one synchronous synthesis will accept.
 *
 * Stated once, here, because two surfaces need the same number: this route
 * refuses beyond it, and the speech lab's composer shows the remaining allowance
 * against it. A second copy is how a composer comes to allow what the route
 * rejects.
 *
 * The value is a starting point, not a measurement — it is roughly a minute of
 * narration, comfortably inside any request timeout for every provider. It
 * wants one timing pass against each registered provider before it is treated as
 * tuned because local CPU synthesis may run below real time, so it is
 * the one that sets the real ceiling. */
export const MAX_SYNTHESIS_CHARS = 1200;

export function ttsRoutes(): Hono {
	const app = new Hono();

	/* Provider readiness + per-provider voice catalogue, shaped like the image
	 * provider's status: a list derived from the registry, never a field named
	 * after a particular provider.
	 *
	 * It used to carry provider-specific configured fields and
	 * `image_configured` — three booleans that had to be added to, and read by,
	 * every surface each time a provider appeared. `providers` replaces all of
	 * them, so registering a provider shows it here with no change to this route
	 * and none in the web app.
	 *
	 * The voice lists come from lib/voice-catalogue-source.ts, the same module the
	 * catalogue endpoints read, so the payloads cannot name different voices or
	 * different sample clips for the same provider.
	 *
	 * `voices` stays the effective provider's, and is EMPTY when none is
	 * configured: a list of choices that cannot be synthesized is worse than none,
	 * because every one of them fails at the point of use. `providers[].voices`
	 * still carries every catalogue, since a surface offering a provider choice
	 * has to render the list for a provider it has not selected yet.
	 *
	 * SCOPED, because a catalogue now includes the caller's own cloned voices.
	 * The middleware is mounted on this path alone: `/clips` treats an ABSENT
	 * workspace as "every workspace" rather than as the default tenant, and the
	 * middleware's defaulting would silently narrow that listing. */
	app.use("/status", workspaceScope());
	app.get("/status", async (c) => {
		const workspace = activeWorkspace(c);
		const [providers, effective] = await Promise.all([
			ttsProviderCatalogue(workspace),
			effectiveVoiceCatalogue(workspace),
		]);
		return c.json({
			providers,
			selected_provider: (await selectedTtsProviderId()) ?? null,
			effective_provider: effective.provider,
			selection_error: effective.error,
			source: await ttsSelectionSource(),
			ready: effective.ready,
			voices: effective.voices,
		});
	});

	app.post("/generate", async (c) => {
		const parsed = ttsBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const text = (body.text ?? "").trim();
		if (!text) return c.json({ error: "text is required" }, 400);
		/* Refused BEFORE the meter, so an over-long request costs nothing. The cap
		 * exists because synthesis is synchronous: the clip comes back in this
		 * response, so a script long enough to outlast the request timeout would
		 * be billed and then lost. */
		if (text.length > MAX_SYNTHESIS_CHARS) {
			return c.json(
				{ error: "text_too_long", limit: MAX_SYNTHESIS_CHARS, length: text.length },
				413,
			);
		}
		/* A registry id, not one of two names this route knows. An unregistered id
		 * is refused by `selectReadyProvider` with a message naming it, which is
		 * where that check belongs — narrowing here could only go stale. */
		const provider = body.provider?.trim() || undefined;

		/* The workspace comes from the PROJECT, not from the body: content_projects
		 * .workspace is the authoritative record of which tenant owns the project,
		 * and a body field would let a caller pick a tenant by sending different
		 * JSON. Same rule as the scene-image route. */
		const projectId = body.project_id?.trim() || null;
		const source = body.source ?? (projectId ? "scene" : "lab");
		const workspace = projectId
			? ((await getContentProject(projectId))?.project.workspace ?? null)
			: ABSENT_WORKSPACE_RESOLVES_TO;
		if (!workspace) return c.json({ error: "project_not_found" }, 400);
		const refusal = await unknownWorkspaceRefusal(c, workspace);
		if (refusal) return refusal;

		/* Named before the ledger row is opened so the row records which provider
		 * the clip came from rather than the absence of a choice. Deliberately the
		 * health-free resolution: opening a ledger row must not depend on the
		 * service being reachable, and readiness is enforced one line later by the
		 * synthesis itself, where an unconfigured provider still yields a 503. */
		let plannedProvider: string;
		try {
			plannedProvider = await plannedTtsProviderId(provider);
		} catch (err) {
			// An explicitly named provider that implements no TTS is a bad request,
			// not an upstream failure — nothing has been recorded or metered yet.
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 400);
		}

		/* Opened before the provider is called, resolved after — inside this one
		 * request, with no job queue. The lifecycle is not about async: `meter()`
		 * records the spend INSIDE synthesizeBilledTts, before this handler writes
		 * a response, so a single write-on-success would let a process that dies
		 * mid-request leave billed spend with no artifact row at all. */
		const ledgerId = await openGeneration({
			workspace,
			projectId,
			medium: "speech",
			source,
			prompt: text,
			voice: body.voice || undefined,
			provider: plannedProvider,
		});

		try {
			const { bytes, ext } = await synthesizeBilledTts({
				text,
				voice: body.voice || undefined,
				provider,
				workspace,
			});
			const durationSec = await measureOrProbeAudioDurationSec(bytes, ext);
			const contentType =
				ext === "mp3" ? "audio/mpeg" : ext === "m4a" ? "audio/mp4" : `audio/${ext}`;
			const url = await storeManagedMedia({
				workspace,
				kind: "audio",
				body: bytes,
				contentType,
				filename: `speech.${ext}`,
			});
			await resolveSpeechCompleted(ledgerId, url, durationSec ?? null);
			return c.json({ url, durationSec: durationSec ?? undefined, id: ledgerId });
		} catch (err) {
			await resolveFailed(ledgerId);
			const msg = err instanceof Error ? err.message : String(err);
			// Unconfigured provider → 503 (setup), otherwise upstream failure → 502.
			const status = /not configured/i.test(msg) ? 503 : 502;
			return c.json({ error: msg }, status);
		}
	});

	/* The speech gallery's reads, shaped like the image gallery's so the two
	 * surfaces behave the same way for the same query. */
	app.get("/clips", async (c) => {
		const q = c.req.query();
		// An unregistered workspace is refused, not served an empty gallery. Empty
		// is a real answer here, so a typo returning 200 with zero rows would be
		// indistinguishable from the truth.
		const refusal = await unknownWorkspaceRefusal(c, q.workspace);
		if (refusal) return refusal;
		const limit = Number.parseInt(q.limit ?? "100", 10);
		const offset = Number.parseInt(q.offset ?? "0", 10);
		// Client input, so membership is checked rather than asserted. An unknown
		// `?source=` behaves as absent — an unfiltered listing — rather than
		// travelling into the query as a value nothing matches and returning an
		// empty page that reads as "no clips" instead of "no such source".
		const source = oneOf(q.source, SPEECH_SOURCES);
		const items = await listSpeech({
			workspace: q.workspace?.trim() || undefined,
			// `project=none` selects clips belonging to no project — a real answer,
			// distinct from "do not filter by project".
			projectId: q.project === "none" ? null : q.project?.trim() || undefined,
			source: source ?? undefined,
			search: q.q,
			limit: Number.isFinite(limit) ? limit : 100,
			offset: Number.isFinite(offset) ? offset : 0,
		});
		return c.json({ items });
	});

	app.get("/clips/facets", async (c) => {
		const workspace = c.req.query("workspace")?.trim();
		const refusal = await unknownWorkspaceRefusal(c, workspace);
		if (refusal) return refusal;
		return c.json(await speechFacets(workspace || undefined));
	});

	app.post("/clips/:id/star", async (c) => {
		return c.json({ ok: await toggleStar(c.req.param("id")) });
	});

	/* A hide, not a delete. This row is the artifact side of a metered, billed
	 * synthesis; tidying a gallery must not make that spend unattributable. */
	app.delete("/clips/:id", async (c) => {
		return c.json({ ok: await softDeleteImage(c.req.param("id")) });
	});

	return app;
}
