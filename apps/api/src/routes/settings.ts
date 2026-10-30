/* Settings are app/admin scope and are deliberately NOT scoped by the active
 * workspace: switching workspace must not change what is configured here.
 *
 * The `:name` routes below are a different thing and easy to confuse with one.
 * They address a workspace EXPLICITLY in the path — an operator administering a
 * named workspace's secrets or policies — rather than reading the tenant the
 * operator is currently working in. They take their name from the URL, not from
 * `lib/active-workspace.ts`, and that is correct: administering a workspace does
 * not require being inside it. */
import { oneOf, writerStyleProfiles } from "@maleo/shared";
import {
	capabilityToggleBody,
	channelActivationsPatch,
	contentBehaviorPatch,
	globalEnvBody,
	imagePolicyPatch,
	textProviderKeyBody,
	videoPolicyPatch,
	workspaceSecretBody,
	writerStylePatch,
} from "./settings-schemas.ts";
import { Hono, type Context } from "hono";
import { activeCaller, notOwnerRefusal } from "../lib/active-workspace.ts";
import { getWorkspaceMember } from "@maleo/db/workspace-members";
import { notInstanceOwnerRefusal } from "../middleware/instance-owner.ts";
import { auditConfigMutation } from "../lib/admin-config-audit.ts";
import {
	ALLOWED_KEYS,
	effectiveEnv,
	readDashboardEnv,
	updateDashboardEnv,
} from "../lib/dashboard-env.ts";
import {
	maskSecret,
	readWorkspaceSecrets,
	setWorkspaceSecret,
	unsetWorkspaceSecret,
} from "../lib/workspace-secrets.ts";
import { isRefreshable, refreshSecret } from "../lib/secret-refresh.ts";
import {
	getGenerationStats,
	readImagePolicy,
	resetGenerationLog,
	stripLegacyImagePolicy,
	writeImagePolicy,
	type ImagePolicy,
} from "../lib/image-policy.ts";
import {
	readWorkspaceConfigText,
	workspaceWriterStyle,
	writeWorkspaceConfigText,
} from "../lib/config-yaml.ts";
import YAML from "yaml";
import {
	getVideoStats,
	readVideoPolicy,
	resetVideoLog,
	type VideoPolicy,
} from "../lib/video-policy.ts";
import {
	listModules,
	getModule,
	refreshableForCapability,
	CAPABILITY_IDS,
} from "../lib/capabilities/modules.ts";
import { getEnabled, setEnabled } from "../lib/capabilities/enabled.ts";
import type { CapabilityCard } from "../lib/capabilities/types.ts";
import {
	readChannelActivations,
	writeChannelActivations,
	activeMatrix,
} from "../lib/channel-activations.ts";
import { getChannelManifest, listChannelManifests } from "../lib/channel-caps.ts";
import {
	readContentBehavior,
	writeContentBehavior,
	decideContent,
	type ContentBehavior,
} from "../lib/content-behavior.ts";
import { getLocalWhisperStatus, setupLocalWhisper } from "../lib/local-whisper.ts";
import { providersFor, selectReadyProvider } from "@maleo/media/providers";
import {
	providersFor as textProvidersFor,
	selectReadyProvider as selectReadyTextProvider,
} from "../lib/ai-provider/index.ts";
import { readTextProviderSelection } from "../lib/text-provider-settings.ts";
import { textModelOptions } from "../lib/ai-provider/providers/api/discovery.ts";
import { checkReachable as checkTextApiReachable } from "../lib/ai-provider/index.ts";
import {
	maskSecret as maskGlobalSecret,
	readGlobalSecrets,
	setGlobalSecret,
	unsetGlobalSecret,
} from "../lib/global-secrets.ts";
/* The environment variable the `api` provider reads its credential from. Named
 * once here; the value itself never touches `global_settings`. */
const AI_API_KEY_SECRET = "MALEO_AI_API_KEY";
/* Providers the prompts and every call site's reply handling are verified
 * against (the parity matrix, modules/agents/core/provider-parity.bun.test.ts). Anything absent
 * here is selectable but unsupported, and every surface that offers it has to
 * say so. */
const SUPPORTED_TEXT_PROVIDERS: readonly string[] = ["api"];
import { mediaWorkerConfigured } from "../lib/image-gen-client.ts";
import { getGlobalImageProvider } from "@maleo/db/global-settings";
import {
	resolveTtsProvider,
	selectedTtsProviderId,
	ttsProviders,
	ttsSelectionSource,
} from "../lib/tts-synth.ts";

interface GlobalKeyView {
	key: string;
	set: boolean;
	value_masked: string;
	source: "file" | "env" | "unset";
}

function maskGlobal(value: string): string {
	if (!value) return "";
	if (value.length <= 8) return "***";
	return `${value.slice(0, 3)}••••${value.slice(-3)}`;
}

export function settingsRoutes(): Hono {
	const app = new Hono();
	app.use("*", auditConfigMutation());
	const readiness = new Set([
		"/image-provider",
		"/tts-provider",
		"/text-provider",
		"/research-status",
		"/captions-status",
		"/channel-manifests",
	]);
	app.use("*", async (c: Context, next) => {
		const path = new URL(c.req.url).pathname.replace(/^\/api\/settings/, "");
		const workspacePart = path.startsWith("/workspaces/")
			? path.slice("/workspaces/".length).split("/")[0]
			: null;
		if (workspacePart) {
			let name: string;
			try {
				name = decodeURIComponent(workspacePart);
			} catch {
				return c.json({ error: "invalid_workspace" }, 400);
			}
			if (c.req.method === "GET") {
				if (!(await getWorkspaceMember(name, activeCaller(c).userId))) {
					return c.json({ error: "unknown_workspace", workspace: name }, 400);
				}
			} else {
				const refusal = await notOwnerRefusal(c, name);
				if (refusal) return refusal;
			}
		} else if (c.req.method !== "GET" || !readiness.has(path)) {
			const refusal = notInstanceOwnerRefusal(c);
			if (refusal) return refusal;
		}
		await next();
	});

	async function imageProviderStatus() {
		const selected = await getGlobalImageProvider();
		const providers = await Promise.all(
			providersFor("image").map(async (provider) => ({
				id: provider.meta.id,
				label: provider.meta.label,
				health: await provider.meta.health("image"),
			})),
		);
		let effectiveProvider: string | null = null;
		let selectionError: string | null = null;
		try {
			effectiveProvider = (
				await selectReadyProvider("image", selected ? { workspace: { image: selected } } : {})
			).provider.meta.id;
		} catch (error) {
			selectionError = error instanceof Error ? error.message : String(error);
		}
		return {
			selected_provider: selected ?? null,
			effective_provider: effectiveProvider,
			selection_error: selectionError,
			// "global", not "workspace": this is stored in `global_settings`, whose
			// primary key is `key` alone with no workspace column. It has always
			// been app-wide, and reporting it as workspace-scoped told the UI to
			// label it "Workspace default" — a claim the schema never supported.
			source: selected
				? ("global" as const)
				: process.env.MALEO_PROVIDER_IMAGE?.trim()
					? ("env" as const)
					: ("default" as const),
			worker_configured: mediaWorkerConfigured(),
			providers,
		};
	}

	/* The provider CHOICE is written through `PUT /api/capabilities/:id/provider`
	 * — one endpoint for every capability. The image, tts and text write routes
	 * that used to live here are gone; three routes doing one thing is why the
	 * web surface needed three hooks and three status shapes.
	 *
	 * The GET projections below stay. They are not selection: the editor's
	 * pickers need each provider's models, thinking levels and reference support,
	 * which the capability list deliberately does not carry, and the key and
	 * reachability routes have nothing to do with choosing a provider at all. */
	app.get("/image-provider", async (c) => c.json(await imageProviderStatus()));

	/* --- TTS provider ---------------------------------------------------------
	 *
	 * The image route's twin, deliberately down to its error codes. TTS used to
	 * be chosen by an `MALEO_TTS_PROVIDER` string that no settings surface could
	 * see or write, so the UI reported a provider it did not control. */
	async function ttsProviderStatus() {
		const selected = await selectedTtsProviderId();
		const providers = await Promise.all(
			ttsProviders().map(async (provider) => ({
				id: provider.meta.id,
				label: provider.meta.label,
				health: await provider.meta.health("tts"),
				voice_count: provider.meta.tts?.voices.length ?? 0,
			})),
		);
		let effectiveProvider: string | null = null;
		let selectionError: string | null = null;
		try {
			effectiveProvider = (await resolveTtsProvider()).provider.meta.id;
		} catch (error) {
			selectionError = error instanceof Error ? error.message : String(error);
		}
		return {
			selected_provider: selected ?? null,
			effective_provider: effectiveProvider,
			selection_error: selectionError,
			source: await ttsSelectionSource(),
			providers,
		};
	}

	app.get("/tts-provider", async (c) => c.json(await ttsProviderStatus()));

	/* --- AI text provider ---------------------------------------------------
	 *
	 * Everything the settings UI renders comes from provider metadata: models,
	 * thinking levels, whether the provider bills per token, and why it is
	 * unavailable. No model list, level list, or provider name may appear as a
	 * literal in a React file — providers disagree on models and thinking
	 * levels, so a hardcoded union is wrong for every provider individually and
	 * rots the moment one adds a model. */
	async function textProviderStatus(refresh = false) {
		const modelOptions = await textModelOptions(refresh);
		let selection: Awaited<ReturnType<typeof readTextProviderSelection>> = {};
		let selectionError: string | null = null;
		try {
			selection = await readTextProviderSelection();
		} catch {
			selectionError =
				"Saved text selection is invalid. Ask the instance owner to select an available model.";
		}
		const providers = await Promise.all(
			// `internal` providers are resolvable but never offered to a user.
			textProvidersFor("text")
				.filter((p) => !p.meta.internal)
				.map(async (provider) => ({
					id: provider.meta.id,
					label: provider.meta.label,
					models: provider.meta.models,
					...(provider.meta.id === "api"
						? { model_options: modelOptions.options, discovery: modelOptions.discovery }
						: {}),
					thinking_levels: provider.meta.thinkingLevels,
					health: await provider.meta.health("text"),
					// Why, not just that. "Unavailable" with no reason sends the user to
					// the logs for something the health check already knows.
					health_reason: (await provider.meta.healthReason?.("text")) ?? null,
					metered_per_token: provider.meta.traits.meteredPerToken,
					context_tokens: provider.meta.traits.contextTokens,
					// Only providers in the parity matrix are supported; anything else
					// is selectable but unsupported, and must say so.
					supported: SUPPORTED_TEXT_PROVIDERS.includes(provider.meta.id),
				})),
		);
		let effectiveProvider: string | null = null;
		let effectiveSelection: import("@maleo/shared").TextSelection | null = null;
		try {
			if (!selectionError) {
				const decision = await selectReadyTextProvider("text", selection);
				effectiveProvider = decision.provider.meta.id;
				if (decision.choice.model)
					effectiveSelection = { ...decision.choice, model: decision.choice.model };
			}
		} catch (error) {
			selectionError = error instanceof Error ? error.message : String(error);
		}
		return {
			selected: selection.default ?? null,
			effective_provider: effectiveProvider,
			effective_selection: effectiveSelection,
			selection_error: selectionError,
			source: selection.default
				? ("settings" as const)
				: process.env.MALEO_PROVIDER_TEXT?.trim()
					? ("env" as const)
					: ("default" as const),
			providers,
		};
	}

	app.get("/text-provider", async (c) =>
		c.json(await textProviderStatus(c.req.query("refresh") === "true")),
	);

	/* The AI provider's API key. Written to the chmod-0600 global secrets file
	 * and published into the environment, never into `global_settings` — the
	 * settings table is plaintext SQLite and would carry the key into every
	 * backup and dump. Only ever read back masked. */
	app.get("/text-provider/key", (c) => {
		const value = readGlobalSecrets()[AI_API_KEY_SECRET] ?? process.env[AI_API_KEY_SECRET] ?? "";
		return c.json({
			key: AI_API_KEY_SECRET,
			set: value.length > 0,
			value_masked: maskGlobalSecret(value),
		});
	});

	app.put("/text-provider/key", async (c) => {
		const parsed = textProviderKeyBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const value = parsed.data.value ?? "";
		if (!value) {
			unsetGlobalSecret(AI_API_KEY_SECRET);
			delete process.env[AI_API_KEY_SECRET];
			return c.json({ key: AI_API_KEY_SECRET, set: false, value_masked: "" });
		}
		setGlobalSecret(AI_API_KEY_SECRET, value);
		// Take effect now rather than at the next restart.
		process.env[AI_API_KEY_SECRET] = value;
		return c.json({ key: AI_API_KEY_SECRET, set: true, value_masked: maskGlobalSecret(value) });
	});

	/** Explicit reachability probe. Separate from health() because health is
	 *  called on every settings render and a network round-trip per render makes
	 *  the page as slow as the slowest endpoint. */
	app.post("/text-provider/check", async (c) => c.json(await checkTextApiReachable()));

	// --- BrowserOS research status ------------------------------------------
	// Configured/connected state for factual web research. The MCP URL stays
	// server-managed (env) — never persisted per-storyboard. Returns only the
	// operator-set URL + allowlisted tool names; no internal endpoint leakage.
	app.get("/research-status", async (c) => {
		const { getBrowserosStatus } = await import("../lib/browseros-mcp.ts");
		const status = await getBrowserosStatus();
		return c.json({ status });
	});

	// --- Local captions -------------------------------------------------------
	// One-click dashboard bridge for free local caption alignment
	// (@remotion/install-whisper-cpp + ffmpeg). Generation auto-align is still
	// env-gated; explicit setup/align actions use these endpoints.
	app.get("/captions-status", async (c) => {
		const status = await getLocalWhisperStatus();
		return c.json({ status });
	});

	app.post("/captions-setup", async (c) => {
		try {
			const status = await setupLocalWhisper();
			return c.json({ ok: true, status });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 500);
		}
	});

	// --- Global dashboard .env ----------------------------------------------

	app.get("/global", (c) => {
		const file = readDashboardEnv();
		const eff = effectiveEnv();
		const items: GlobalKeyView[] = ALLOWED_KEYS.map((key) => {
			const value = eff[key] ?? "";
			const inFile = file[key] != null && file[key] !== "";
			const inEnv = process.env[key] != null && process.env[key] !== "";
			return {
				key,
				set: Boolean(value),
				value_masked: maskGlobal(value),
				source: inFile ? "file" : inEnv ? "env" : "unset",
			};
		});
		return c.json({ items });
	});

	// Body: { updates: { KEY: "value", KEY2: "" /* deletes */ } }
	app.put("/global", async (c) => {
		const parsed = globalEnvBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "updates required" }, 400);
		updateDashboardEnv(parsed.data.updates);
		return c.json({ ok: true });
	});

	// --- Per-workspace secrets -------------------------------------------------

	app.get("/workspaces/:name/secrets", (c) => {
		const name = c.req.param("name");
		const secrets = readWorkspaceSecrets(name);
		const items = Object.entries(secrets).map(([key, value]) => ({
			key,
			value_masked: maskSecret(value),
			refreshable: isRefreshable(key),
		}));
		return c.json({ items });
	});

	// Body: { key, value }. Use empty value to delete via DELETE route below.
	app.put("/workspaces/:name/secrets", async (c) => {
		const name = c.req.param("name");
		const parsed = workspaceSecretBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const key = parsed.data.key.trim();
		const value = parsed.data.value;
		if (!key) return c.json({ error: "key required" }, 400);
		if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
			return c.json({ error: "key must be UPPER_SNAKE_CASE" }, 400);
		}
		if (!value) return c.json({ error: "value required (use DELETE to remove)" }, 400);
		setWorkspaceSecret(name, key, value);
		return c.json({ ok: true, key, value_masked: maskSecret(value) });
	});

	app.delete("/workspaces/:name/secrets/:key", (c) => {
		const name = c.req.param("name");
		const key = c.req.param("key");
		unsetWorkspaceSecret(name, key);
		return c.json({ ok: true });
	});

	app.post("/workspaces/:name/secrets/:key/refresh", async (c) => {
		const name = c.req.param("name");
		const key = c.req.param("key");
		if (!isRefreshable(key)) {
			return c.json({ error: `key ${key} is not refreshable` }, 400);
		}
		try {
			const result = await refreshSecret(name, key);
			return c.json({ ok: true, ...result });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	// --- Per-workspace image policy -------------------------------------------

	app.get("/workspaces/:name/image-policy", async (c) => {
		const name = c.req.param("name");
		// Opportunistic migration: strip legacy fields if any persist.
		await stripLegacyImagePolicy(name);
		const policy = await readImagePolicy(name);
		const stats = await getGenerationStats(name);
		return c.json({ policy, stats });
	});

	app.put("/workspaces/:name/image-policy", async (c) => {
		const name = c.req.param("name");
		const parsed = imagePolicyPatch.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success)
			return c.json({ error: "invalid_image_policy", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const current = await readImagePolicy(name);
		const merged: ImagePolicy = {
			daily_limit: body.daily_limit ?? current.daily_limit,
			hourly_limit: body.hourly_limit ?? current.hourly_limit,
			gap_seconds: body.gap_seconds ?? current.gap_seconds,
			allowed_hours: body.allowed_hours ?? current.allowed_hours,
			cost_per_image_usd: body.cost_per_image_usd ?? current.cost_per_image_usd,
			max_daily_cost_usd: body.max_daily_cost_usd ?? current.max_daily_cost_usd,
			on_limit_hit: body.on_limit_hit ?? current.on_limit_hit,
			notify_on_limit:
				body.notify_on_limit !== undefined
					? Boolean(body.notify_on_limit)
					: current.notify_on_limit,
		};
		await writeImagePolicy(name, merged);
		return c.json({ ok: true, policy: merged });
	});

	// Reset the daily/hourly counter. Useful after a quota reset upstream
	// or for testing.
	app.delete("/workspaces/:name/image-policy/log", async (c) => {
		const name = c.req.param("name");
		const removed = await resetGenerationLog(name);
		return c.json({ ok: true, removed });
	});

	// --- Per-workspace video policy -------------------------------------------

	app.get("/workspaces/:name/video-policy", async (c) => {
		const name = c.req.param("name");
		const policy = await readVideoPolicy(name);
		const stats = await getVideoStats(name);
		return c.json({ policy, stats });
	});

	app.put("/workspaces/:name/video-policy", async (c) => {
		const name = c.req.param("name");
		const parsed = videoPolicyPatch.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success)
			return c.json({ error: "invalid_video_policy", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const current = await readVideoPolicy(name);
		const merged: VideoPolicy = {
			post_mode: body.post_mode ?? current.post_mode,
			reply_mode: body.reply_mode ?? current.reply_mode,
			post_prob: body.post_prob ?? current.post_prob,
			reply_prob: body.reply_prob ?? current.reply_prob,
			default_preset: body.default_preset ?? current.default_preset,
			default_template: body.default_template ?? current.default_template,
			daily_limit: body.daily_limit ?? current.daily_limit,
			hourly_limit: body.hourly_limit ?? current.hourly_limit,
			gap_seconds: body.gap_seconds ?? current.gap_seconds,
			allowed_hours: body.allowed_hours ?? current.allowed_hours,
			cost_per_render_usd: body.cost_per_render_usd ?? current.cost_per_render_usd,
			max_daily_cost_usd: body.max_daily_cost_usd ?? current.max_daily_cost_usd,
			on_limit_hit: body.on_limit_hit ?? current.on_limit_hit,
		};
		const text = await readWorkspaceConfigText(name);
		const doc = YAML.parseDocument(text);
		doc.setIn(["video_policy"], merged);
		await writeWorkspaceConfigText(name, String(doc));
		return c.json({ ok: true, policy: merged });
	});

	app.delete("/workspaces/:name/video-policy/log", async (c) => {
		const name = c.req.param("name");
		const removed = await resetVideoLog(name);
		return c.json({ ok: true, removed });
	});

	// --- Per-workspace narration writer style ---------------------------------

	/* The library plus this workspace's choice. The options come from the library
	 * rather than the client so the picker cannot offer a profile that does not
	 * exist, and a retired key reads back as no selection rather than as an option. */
	app.get("/workspaces/:name/writer-style", async (c) => {
		const name = c.req.param("name");
		return c.json({
			selected: (await workspaceWriterStyle(name))?.key ?? null,
			options: writerStyleProfiles().map((profile) => ({
				key: profile.key,
				label: profile.label,
				person: profile.person,
				tense: profile.tense,
				sentenceRhythm: profile.sentenceRhythm,
			})),
		});
	});

	/* Written through `YAML.parseDocument` + `setIn`, like `video_policy` beside it,
	 * so an operator's comments and key order in `config.yaml` survive the write.
	 * `null` clears the selection, which must stay reachable: unset is a real state
	 * that means "plan as this workspace did before writer styles existed". */
	app.put("/workspaces/:name/writer-style", async (c) => {
		const name = c.req.param("name");
		const parsed = writerStylePatch.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success)
			return c.json({ error: "invalid_writer_style", issues: parsed.error.issues }, 400);
		const key = parsed.data.writerStyle;
		const text = await readWorkspaceConfigText(name);
		const doc = YAML.parseDocument(text);
		if (key === null) doc.deleteIn(["writer_style"]);
		else doc.setIn(["writer_style"], key);
		await writeWorkspaceConfigText(name, String(doc));
		return c.json({ ok: true, selected: key });
	});

	// --- Capability registry ------------------------------------------------

	app.get("/workspaces/:name/capabilities", async (c) => {
		const name = c.req.param("name");
		const cards: CapabilityCard[] = await Promise.all(
			listModules().map(async (cap) => {
				const inspection = await cap.inspect(name);
				// Default-on inference: if module looks ok and user hasn't set
				// explicit enabled, treat as on. Hard-disabled status overrides.
				const inferredOn = inspection.status === "ok";
				const enabled = await getEnabled(name, cap.id, inferredOn);
				const present = readWorkspaceSecrets(name);
				const missing = cap.required_secrets.filter((k) => !present[k]);
				return {
					id: cap.id,
					group: cap.group,
					label: cap.label,
					description: cap.description,
					enabled,
					status: enabled ? inspection.status : "disabled",
					status_detail: inspection.status_detail ?? null,
					required_secrets: cap.required_secrets,
					missing_secrets: missing,
					refreshable_secrets: refreshableForCapability(cap),
					policy_key: cap.policy_key,
					policy: inspection.policy ?? null,
					metrics: inspection.metrics ?? null,
				};
			}),
		);
		return c.json({ items: cards });
	});

	app.put("/workspaces/:name/capabilities/:id/enabled", async (c) => {
		const name = c.req.param("name");
		const id = oneOf(c.req.param("id"), CAPABILITY_IDS);
		if (!id || !getModule(id)) return c.json({ error: "unknown_capability" }, 404);
		const parsed = capabilityToggleBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "enabled boolean required" }, 400);
		const body = parsed.data;
		await setEnabled(name, id, body.enabled);
		return c.json({ ok: true, id, enabled: body.enabled });
	});

	// --- Channel manifests + activations ------------------------------------

	app.get("/channel-manifests", (c) => {
		return c.json({ items: listChannelManifests() });
	});

	app.get("/workspaces/:name/channels/:channel/activations", async (c) => {
		const name = c.req.param("name");
		const channel = c.req.param("channel");
		const manifest = getChannelManifest(channel);
		if (!manifest) return c.json({ error: "unknown_channel" }, 404);
		const activations = await readChannelActivations(name, manifest.id);
		return c.json({ manifest, activations });
	});

	app.put("/workspaces/:name/channels/:channel/activations", async (c) => {
		const name = c.req.param("name");
		const channel = c.req.param("channel");
		const manifest = getChannelManifest(channel);
		if (!manifest) return c.json({ error: "unknown_channel" }, 404);
		const parsed = channelActivationsPatch.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success)
			return c.json({ error: "invalid_activations", issues: parsed.error.issues }, 400);
		const next = await writeChannelActivations(name, manifest.id, parsed.data);
		return c.json({ ok: true, activations: next });
	});

	app.get("/workspaces/:name/active-matrix", async (c) => {
		const name = c.req.param("name");
		return c.json({ items: await activeMatrix(name) });
	});

	// One-shot per-channel preview data for a given kind: combines manifest,
	// activation row, and the configured image aspect override per active
	// channel. Used by Inbox/Workspace DraftDetail to render previews.
	app.get("/workspaces/:name/channel-previews/:kind", async (c) => {
		const name = c.req.param("name");
		const kindRaw = c.req.param("kind").toLowerCase();
		const kind: "post" | "reply" = kindRaw === "reply" ? "reply" : "post";
		const manifests = listChannelManifests();
		const activationsByChannel = await Promise.all(
			manifests.map((manifest) => readChannelActivations(name, manifest.id)),
		);
		const items = manifests
			.map((manifest, index) => {
				const activations = activationsByChannel[index]!;
				const row = activations[kind];
				const active = row.text || row.image || row.video;
				return {
					channel: manifest.id,
					label: manifest.label,
					manifest,
					row,
					image_aspect:
						activations.overrides.image_aspect ?? manifest.image_aspect_ratios[0] ?? null,
					active,
				};
			})
			.filter((p) => p.active);
		return c.json({ items });
	});

	// --- Behavior: content decisions ---------------------------------------

	app.get("/workspaces/:name/behavior/content", async (c) => {
		const name = c.req.param("name");
		return c.json({ behavior: await readContentBehavior(name), active: await activeMatrix(name) });
	});

	app.put("/workspaces/:name/behavior/content", async (c) => {
		const name = c.req.param("name");
		const parsed = contentBehaviorPatch.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success)
			return c.json({ error: "invalid_behavior", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const current = await readContentBehavior(name);
		const next: ContentBehavior = {
			mix: body.mix ?? current.mix,
			rules: body.rules ?? current.rules,
		};
		await writeContentBehavior(name, next);
		return c.json({ ok: true, behavior: next });
	});

	// Live preview — what would workspace pick right now for this (channel, kind)?
	app.get("/workspaces/:name/decide", async (c) => {
		const name = c.req.param("name");
		const channel = c.req.query("channel") ?? "";
		const kind = oneOf(c.req.query("kind"), ["post", "reply"] as const) ?? "post";
		const manifest = getChannelManifest(channel);
		if (!manifest) return c.json({ error: "unknown_channel" }, 404);
		// Sample 1000 rolls for distribution view; also return one fresh roll.
		const counts: Record<string, number> = { text: 0, image: 0, video: 0, skip: 0 };
		for (let i = 0; i < 1000; i++) {
			const r = await decideContent(name, kind, manifest.id);
			if (r.skip) counts.skip++;
			else counts[r.type]++;
		}
		const sample = await decideContent(name, kind, manifest.id);
		return c.json({ sample, distribution_1000: counts });
	});

	return app;
}
