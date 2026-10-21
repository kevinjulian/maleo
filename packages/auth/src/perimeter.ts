/* What a request must carry to get past the front door.
 *
 * THE PERIMETER IS THE DISPATCH, NOT THE `/api/*` PREFIX. `index.ts` resolves
 * `/uploads/*` and hands `/internal/*` to a second Hono app before `api.fetch`
 * ever runs, so middleware mounted on the `api` app cannot see either. A rule
 * written as "every /api/* route needs a session" would be satisfied in full
 * while the entire media library stayed readable by anyone who could guess a
 * filename.
 *
 * So coverage is decided here, on the pathname, and applied once in the
 * dispatch.
 *
 * Deny by default: anything not named below needs a session. Adding a route
 * therefore protects it, and exposing one is a deliberate edit to this file
 * rather than an accident of mount position. `perimeter.test.ts` asserts the
 * exempt set matches this list exactly, so a route cannot slip in by
 * dispatching earlier. */

/** Paths that authenticate by their own means, or by nothing at all. */
export const SESSION_EXEMPT_PREFIXES: readonly string[] = [
	/* The auth endpoints themselves. Requiring a session to sign in would be a
	 * closed loop with no way in. */
	"/api/auth/",
	/* Which screen the sign-in page should show. Answers one boolean to an
	 * anonymous caller — see routes/auth-state.ts. */
	"/api/auth-state",
	/* Redeeming an invitation. The one route that creates an account on a
	 * deployment with registration closed, and it is reachable signed-out by
	 * definition — the person redeeming does not have an account yet.
	 *
	 * Exempt from the session check, NOT from authorisation: the token is the
	 * credential, verified in routes/invitations.ts before anything is created. */
	"/api/invitations/",
	/* The Inngest sync endpoint. Authenticates by INNGEST_SIGNING_KEY inside the
	 * SDK's own handler.
	 *
	 * This one is why the list exists. Cover it by accident and the Inngest
	 * server gets a 401, reports zero functions, and every durable run stops —
	 * with nothing in the API logs, because a 401 is not an error. */
	"/api/inngest",
	/* The internal configuration service. Authenticates by MALEO_SERVICE_TOKEN
	 * in constant time, is mounted on a separate Hono app the CORS allowlist
	 * does not cover, and refuses every request when no token is configured.
	 *
	 * Named here even though it is dispatched before the session check would run
	 * anyway. "Exempt because of where it is mounted" is not a decision anyone
	 * made; this is. */
	"/internal/",
];

/** Exact paths, where a prefix would be too broad. */
export const SESSION_EXEMPT_PATHS: readonly string[] = [
	// Liveness for the platform. Says only that the process is answering.
	"/health",
	/* MCP clients (Codex CLI, Claude Code) carry no cookie. Exempt from the
	 * session check, NOT from authorisation: every request presents an API key,
	 * verified in mcp/credential.ts before any tool runs, and each call is checked
	 * against the key owner's workspace membership. */
	"/mcp",
	// The same endpoint as the web origin proxies it (mcp/mount.ts MCP_PUBLIC_PATH).
	"/api/mcp",
];

export function isSessionExempt(pathname: string): boolean {
	if (SESSION_EXEMPT_PATHS.includes(pathname)) return true;
	return SESSION_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
