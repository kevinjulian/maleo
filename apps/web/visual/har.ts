/* API replay for the suites that must run without the api.
 *
 * `routeFromHAR` matches a recorded response by URL, and the URL the app sends
 * is not frozen: every `/api/operations` request now carries the active
 * workspace (`client.ts` adds it at one seam), which no entry in the recorded
 * HAR has. Every operations request therefore missed, `notFound: "abort"`
 * rejected it, and the editor rendered "Could not load content: Failed to
 * fetch" — the whole suite failing on a query parameter rather than on
 * anything it photographs.
 *
 * The workspace is dropped for MATCHING only, and only when it is the value a
 * recorded session would have used. Re-recording would work too and is worse:
 * it bakes today's parameter list into the fixture, so the next scoping
 * parameter breaks the suite the same way. This states the rule instead —
 * replay ignores the workspace, because the fixture is one workspace.
 */
import type { BrowserContext } from "@playwright/test";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_MEDIA_IMPORT_LIMITS } from "@maleo/shared";
import { WORKSPACE_QUERY_KEY } from "../src/models/core/active-workspace.ts";
import { storyboardAuthoringState, videoJobs } from "./fixtures/fixture-data.ts";

export const FONT_HAR = resolve(import.meta.dirname, ".output/fonts.har");
export const FONT_URL = /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\//;

/** Replay `har` for `/api/**`, ignoring the workspace parameter when matching. */
export async function replayApi(context: BrowserContext, har: string): Promise<void> {
	// The external stylesheet blocks initial scripts; share warmup's real responses across workers.
	if (existsSync(FONT_HAR))
		await context.routeFromHAR(FONT_HAR, { url: FONT_URL, notFound: "fallback" });
	await context.routeFromHAR(har, { url: "**/api/**", update: false, notFound: "abort" });
	/* Registered after the HAR route so it runs first: handlers run in reverse
	 * registration order, and `fallback` hands the rewritten URL to the one
	 * underneath. */
	await context.route("**/api/**", async (route) => {
		const url = new URL(route.request().url());
		if (!url.searchParams.has(WORKSPACE_QUERY_KEY)) {
			await route.fallback();
			return;
		}
		url.searchParams.delete(WORKSPACE_QUERY_KEY);
		await route.fallback({ url: url.toString().replace(/\?$/, "") });
	});
	/* The editor autosaves its state 1.2s after it mounts. The recording has no
	 * entry for that write, so `notFound: "abort"` rejected it and an "Auto-save
	 * failed: Failed to fetch" banner appeared in whichever screenshot happened
	 * to be taken after the debounce — three baselines were captured that way.
	 * A fixture has nowhere to save to; the write succeeds and is discarded.
	 * Specs that assert on this request register their own handler afterwards,
	 * which runs first. */
	await context.route("**/api/operations/projects/*/editor-state**", async (route) => {
		if (route.request().method() === "PUT") await route.fulfill({ json: { ok: true } });
		else await route.fallback();
	});
	/* The same for the storyboard itself: entering Studio, or any edit, saves a
	 * new storyboard version, and the recording has no entry for that POST
	 * either. Specs that assert on saving register their own handler. */
	await context.route(/\/api\/operations\/projects\/[^/]+\/storyboards(\?|$)/, async (route) => {
		if (route.request().method() === "POST")
			await route.fulfill({ json: { storyboard: { id: "fixture-saved-storyboard", version: 2 } } });
		else await route.fallback();
	});
	/* Edits reach the server as commands (`p1-command-log`), and the recording has
	 * no command log. Every submission is accepted and discarded here; specs that
	 * assert on what was saved serve a stateful log (`command-log.ts`), whose
	 * handlers run first. */
	let seq = 0;
	await context.route(/\/api\/operations\/projects\/[^/]+\/commands(\?|$)/, async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({
				json: {
					headSeq: seq,
					headVersion: seq + 1,
					headStoryboardId: "fixture-saved-storyboard",
					entries: [],
				},
			});
			return;
		}
		const body = route.request().postDataJSON() as { commands: { clientCommandId: string }[] };
		const accepted = body.commands.map(({ clientCommandId }) => {
			seq += 1;
			return { clientCommandId, seq, version: seq + 1 };
		});
		await route.fulfill({
			json: { headSeq: seq, headVersion: seq + 1, accepted, rejected: [], delivered: [] },
		});
	});
	await context.route(
		/\/api\/operations\/projects\/[^/]+\/storyboard-presentation(\?|$)/,
		async (route) => {
			seq += 1;
			await route.fulfill({ json: { ok: true, version: seq + 1 } });
		},
	);
	// Media import did not exist in the recording. Keep ready/empty GET states
	// deterministic; upload/processing suites override these with their own jobs.
	await context.route(
		/\/api\/operations\/projects\/[^/]+\/media\/import(?:\/readiness)?(\?|$)/,
		async (route) => {
			if (route.request().method() !== "GET") {
				await route.fallback();
				return;
			}
			await route.fulfill({
				json: new URL(route.request().url()).pathname.endsWith("/readiness")
					? { available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS }
					: { items: [], nextCursor: null },
			});
		},
	);
	await context.route(/\/api\/operations\/projects\/[^/]+\/captions\/readiness(\?|$)/, (route) =>
		route.fulfill({
			json: { available: true, captions: { available: true, model: "base", runtime: "1.5.5" } },
		}),
	);

	// Scoped history adds paging parameters that the old exact-URL HAR lacks.
	await context.route(/\/api\/video\/jobs(\?|$)/, (route) =>
		route.fulfill({
			json: {
				items: videoJobs,
				total: videoJobs.length,
				limit: 60,
				offset: 0,
				has_more: false,
				next_offset: null,
				projects: videoJobs.map((job) => ({ id: job.project_id, title: job.project_title })),
			},
		}),
	);
	await context.route(/\/api\/video\/projects\/[^/]+\/exports(\?|$)/, (route) =>
		route.fulfill({ json: { active: null, latest: null } }),
	);
	// These route families were never present in the old recording. Keep their
	// deterministic empty/configured states beside replay instead of reviving a
	// live-database recorder only to add three response envelopes.
	await context.route("**/api/auth/get-session", (route) =>
		route.fulfill({
			json: {
				user: {
					id: "fixture-user",
					email: "fixture@example.com",
					name: "Fixture",
					role: "instance_owner",
				},
			},
		}),
	);
	await context.route("**/api/providers/kokoro/config**", (route) =>
		route.fulfill({
			json: {
				provider: "kokoro",
				label: "Kokoro",
				fields: [],
			},
		}),
	);
	await context.route("**/api/security", (route) =>
		route.fulfill({
			json: {
				master_key: {
					state: "absent",
					rotationPending: false,
					fingerprint: null,
					source: null,
					path: "/fixture/master-key",
				},
				shadowed: [],
			},
		}),
	);
	await context.route("**/api/image-gen/images**", (route) =>
		route.fulfill({
			json: route.request().url().includes("/facets") ? { projects: [] } : { items: [] },
		}),
	);
	await context.route("**/api/settings/image-provider", (route) =>
		route.fulfill({
			json: {
				selected_provider: "fixture-image",
				effective_provider: "fixture-image",
				selection_error: null,
				source: "global",
				worker_configured: true,
				providers: [{ id: "fixture-image", label: "Fixture Image", health: "ready" }],
			},
		}),
	);
	await context.route("**/api/operations/projects/*/storyboard-authoring**", (route) =>
		route.fulfill({
			json: {
				state: storyboardAuthoringState,
				legacy: false,
				generatedByBeatId: {},
				references: {
					"entity:fixture-ref-character": {
						label: "Fixture Character",
						role: "character",
						source: "existing",
					},
					"planned:fixture-archive-door": {
						label: "Archive Door",
						role: "prop",
						source: "planned",
					},
				},
			},
		}),
	);
}
