import "./lib/resolve-env.ts";
import { provideEditorEngine } from "@maleo/shared/editor";
import { editorEngine } from "./lib/editor-engine.ts";
import { Hono } from "hono";
import { MAX_IMPORT_REQUEST_BYTES } from "@maleo/shared";
import { edgeSafeStatus } from "./lib/edge-safe-status.ts";
import { activityStreamRoutes } from "./routes/activity-stream.ts";
import { imageGenRoutes } from "./routes/image-gen.ts";
import { videoRoutes } from "./routes/video.ts";
import { settingsRoutes } from "./routes/settings.ts";
import { operationsRoutes } from "./routes/operations.ts";
import { stockRoutes } from "./routes/stock.ts";
import { ttsRoutes } from "./routes/tts.ts";
import { mediaRoutes } from "./routes/media.ts";
import { voiceCloneRoutes } from "./routes/voice-clones.ts";
import { inngestRoutes } from "./routes/inngest.ts";
import { creditsRoutes } from "./routes/credits.ts";
import { capabilitiesRoutes, providerRoutes, securityRoutes } from "./routes/capabilities.ts";
import { workspacesRoutes } from "./routes/workspaces.ts";
import { mcpServerRoutes } from "./modules/agents/mcp-servers/index.ts";
import { adminRoutes } from "./routes/admin.ts";
import { resolveUploadFilePath } from "./lib/upload-files.ts";
import { buildUploadResponse } from "./lib/upload-response.ts";
import { setTextProviderSelectionReader } from "./lib/text-runner.ts";
import { readTextProviderSelection } from "./lib/text-provider-settings.ts";
import { loadGlobalSecretsIntoEnv } from "./lib/global-secrets.ts";
import { installProviderConfigSource } from "./lib/provider-config-source.ts";
import { completeRotationIfProven } from "@maleo/db/secret-store";
import { internalConfigRoutes } from "./routes/internal-config.ts";
import { MCP_PATHS, mcpRoutes } from "./mcp/mount.ts";
import { internalMediaRoutes } from "./routes/internal-media.ts";
import { internalMediaImportRoutes } from "./modules/media-import/index.ts";
import { internalMediaProcessingRoutes } from "./modules/media-processing/index.ts";
import { ensureDefaultWorkspace, syncWorkspaceRegistry } from "./lib/workspace/registry.ts";
import { ensureAuthTables, getAuth } from "@maleo/auth/config";
import { databaseReady } from "@maleo/db/connection";
import { authStateRoutes } from "./routes/auth-state.ts";
import { invitationRoutes } from "./routes/invitations.ts";
import { admit } from "./middleware/perimeter.ts";
import { configuredCorsOrigins, corsAllowlist } from "./middleware/cors.ts";
import { configuredServiceToken } from "./lib/service-token.ts";
import { assertMediaStorageConfigured, verifyMediaStorageReady } from "@maleo/storage";

provideEditorEngine(editorEngine);
import { findLegacyMediaForUser } from "@maleo/db/media-objects";
import { serveMedia } from "./routes/media.ts";

/* A production deployment without a service token is a misconfiguration, and it
 * should surface at deploy rather than at first use.
 *
 * The routes refuse every request when no token is set, so nothing is exposed
 * either way — but a worker that cannot read provider configuration fails jobs
 * with a credential error, which reads like a provider problem and gets
 * debugged as one. Failing to start names the actual cause once. */
if (process.env.NODE_ENV === "production" && !configuredServiceToken()) {
	throw new Error(
		"MALEO_SERVICE_TOKEN is not set. The media worker authenticates to /internal/* with it, " +
			"and every request there is refused without it — refusing to start rather than serving a " +
			"deployment whose worker cannot resolve providers.",
	);
}
assertMediaStorageConfigured();
await verifyMediaStorageReady();

/* The database before anything reads it: connect, run pending migrations, write
 * the shipped fixtures. A missing credential in production, an off-host database
 * without TLS, or a migration that fails stops the boot here, naming the cause,
 * rather than serving against a database in an unknown state. */
await databaseReady();

/* Publish app-global secrets before provider configuration is installed. */
loadGlobalSecretsIntoEnv();

/* Then teach the provider layers to resolve configuration through this process's
 * stored settings, not the environment alone — which is what makes a credential
 * entered in Settings reach a provider at all. Environment still wins, so a
 * deployment configured entirely by environment variables is unaffected. */
await installProviderConfigSource();

await ensureDefaultWorkspace();
await syncWorkspaceRegistry();

/* The auth library migrates its own four tables, and it has to happen before
 * the first request rather than lazily: a sign-in that arrives first would be
 * answered by a library whose tables do not exist yet. Awaited at module scope
 * for that reason — the server below must not start until it is done. */
await ensureAuthTables();

/* Finish a master key rotation the operator started in Settings, if this boot
 * proves they saved the new key. `process.env` is fixed at start, so THIS is the
 * only moment that proof can exist. Booting with the old key is not a failure —
 * it leaves the rotation pending and everything readable, which is the whole
 * reason both wrappings are kept. */
try {
	if (await completeRotationIfProven()) {
		console.log(
			"[secrets] master key rotation complete — the previous key no longer opens the store",
		);
	}
} catch (error) {
	// A store that cannot be inspected must not stop the API booting; every
	// provider configured by environment variable still resolves.
	console.error("[secrets] could not check for a pending key rotation:", error);
}

/* Teach the text runner where the user's provider choice lives. Injected here
 * rather than imported inside the runner so the generation path does not pull
 * the settings store in behind it — that coupling is how the previous runner
 * ended up with a pricing formula inlined in it.
 *
 * Read per call, not cached: a settings page that appears to work but needs a
 * restart to take effect is worse than one that is absent. */
setTextProviderSelectionReader(readTextProviderSelection);

const PORT = parseInt(process.env.MALEO_API_PORT ?? process.env.PORT ?? "8090", 10) || 8090;
// This API authenticates its own callers. Every path it answers requires a
// session except the ones packages/auth/src/perimeter.ts names, and the check runs in
// the `fetch` dispatch below (middleware/perimeter.ts) rather than as middleware
// on one of the two Hono apps. It no longer depends on a reverse proxy to fence it, so MALEO_API_HOST
// binds to loopback as a default rather than as the security control it was.
//
// MEMBERSHIP IS THE BOUNDARY; WORKSPACE SCOPING IS NOT, and this is the comment
// a reader checking whether tenancy protects anything will reach first. A
// request names a workspace, and workspace_members decides whether this caller
// may act in it — that is the check that refuses. Scoping is the separate,
// weaker thing: it decides what an operator is SHOWN. A route that filters by
// the active workspace and never consults membership is open, however carefully
// it scopes. See specs/workspace-scoping "Scoping is not isolation".
const HOST = process.env.MALEO_API_HOST?.trim() || "127.0.0.1";
const CORS_ORIGINS = configuredCorsOrigins();

const api = new Hono();
// Outermost, so every route's provider failure keeps its reason behind Cloudflare.
api.use("*", edgeSafeStatus());

/* Mounted OUTSIDE `api` on purpose. `api.use("*", cors(...))` below applies CORS
 * to everything on that app, and this one serves decrypted credentials to our
 * own worker processes — a browser must never be able to reach it, and
 * inheriting a permissive origin from a sibling route is exactly how it would.
 * Dispatched in `fetch` before `api`, the same way upload files are. */
const mcp = mcpRoutes();
const internal = new Hono();
internal.route("/internal", internalConfigRoutes());
internal.route("/internal/media", internalMediaRoutes());
internal.route("/internal/media-imports", internalMediaImportRoutes());
internal.route("/internal/media-processing", internalMediaProcessingRoutes());

// The web client runs on a separate origin, so CORS is always wired. See
// middleware/cors.ts.
api.use("*", corsAllowlist(CORS_ORIGINS));

api.get("/health", (c) => c.json({ ok: true, ts: new Date().toISOString() }));
/* Sign-in, sign-up, sign-out and session lookup. Mounted ON `api` so the CORS
 * allowlist above covers it — a credentialed sign-in from an unlisted origin
 * must be refused the same way every other route refuses one. */
api.on(["GET", "POST"], "/api/auth/*", (c) => getAuth().handler(c.req.raw));
/* Answers an anonymous caller on purpose: the sign-in screen has to know
 * whether to ask for a credential or to offer creating the first owner. */
api.route("/api/auth-state", authStateRoutes());
/* Answers a signed-out caller holding an invitation token — see
 * packages/auth/src/perimeter.ts for why it is exempt and what authorises it instead. */
api.route("/api/invitations", invitationRoutes());
api.route("/api/video", videoRoutes());
api.route("/api/image-gen", imageGenRoutes());
api.route("/api/activity-stream", activityStreamRoutes());
api.route("/api/settings", settingsRoutes());
api.route("/api/operations", operationsRoutes());
api.route("/api/stock", stockRoutes());
api.route("/api/tts", ttsRoutes());
api.route("/api/media", mediaRoutes());
// A workspace's cloned voices. Separate from /api/tts because a clone is
// library state, not a synthesis.
api.route("/api/voice-clones", voiceCloneRoutes());
api.route("/api/credits", creditsRoutes());
// The settings surface: capabilities, their providers, and provider configuration.
api.route("/api/capabilities", capabilitiesRoutes());
api.route("/api/providers", providerRoutes());
api.route("/api/security", securityRoutes());
// The registry an operator chooses their scope from. Not itself scoped — see
// routes/workspaces.ts.
api.route("/api/workspaces", workspacesRoutes());
api.route("/api/mcp-servers", mcpServerRoutes());
api.route("/api/admin", adminRoutes());
// Inngest sync endpoint — the Inngest server invokes durable functions here.
api.route("/api/inngest", inngestRoutes());
api.notFound((c) => c.json({ error: "not_found" }, 404));
api.onError((err, c) => {
	console.error("[error]", err);
	return c.json(
		{ error: "internal", message: err instanceof Error ? err.message : String(err) },
		500,
	);
});

const server = Bun.serve({
	port: PORT,
	hostname: HOST,
	// Long timeouts: SSE activity stream is long-lived; large video renders wait
	// on the render worker. Bun.serve max idleTimeout is 255 (4m15s).
	idleTimeout: 255,
	maxRequestBodySize: MAX_IMPORT_REQUEST_BYTES,
	fetch: async (req) => {
		const { pathname } = new URL(req.url);

		/* THE PERIMETER. Every path this process answers passes through here, and
		 * before `resolveUploadFilePath`. See middleware/perimeter.ts. */
		const { caller, refusal } = await admit(req, pathname);
		if (refusal) return refusal;

		const uploadPath = resolveUploadFilePath(pathname);
		if (uploadPath) {
			const mapped = await findLegacyMediaForUser(pathname, caller!.userId);
			if (mapped.mapped)
				return mapped.mediaId
					? await serveMedia(
							mapped.mediaId,
							caller!.userId,
							req.headers.get("range"),
							undefined,
							req.method === "HEAD" ? "HEAD" : "GET",
						)
					: new Response("not_found", { status: 404 });
			// Byte ranges are not an optimization here: iOS refuses to play network
			// media from a server that does not honour them. See upload-response.ts.
			return buildUploadResponse(Bun.file(uploadPath), req.headers.get("range"));
		}
		if (pathname.startsWith("/internal/")) return internal.fetch(req);
		if (MCP_PATHS.includes(pathname)) return mcp.fetch(req);
		/* The caller travels to the routes on Hono's env, so the session is looked
		 * up once per request rather than again inside every scoped family. See
		 * `activeCaller` in lib/active-workspace.ts. */
		return api.fetch(req, { caller });
	},
});

console.log(`maleo-api listening on :${server.port}`);

const shutdown = (sig: string) => {
	console.log(`received ${sig}, closing`);
	void server.stop();
	process.exit(0);
};
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
