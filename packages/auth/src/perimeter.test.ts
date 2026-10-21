/* The exempt set, pinned.
 *
 * Two different failures are guarded here, and they point opposite ways:
 *
 *   - a path that should be covered slipping out, which is a hole;
 *   - a path that must NOT be covered slipping in, which is an outage. The
 *     Inngest sync endpoint is the expensive one: covered by a session check it
 *     answers the Inngest server with 401, the server reports zero functions,
 *     every durable run stops, and nothing appears in the API logs because a
 *     401 is not an error.
 *
 * The list is asserted by value rather than by behaviour, so adding an entry is
 * a visible change to a test someone has to read. */
import { describe, expect, test } from "vite-plus/test";
import { isSessionExempt, SESSION_EXEMPT_PATHS, SESSION_EXEMPT_PREFIXES } from "./perimeter.ts";

describe("the exempt set is exactly this and nothing else", () => {
	test("the declared prefixes", () => {
		// Adding a line here is the whole point: exposure is an edit to a list,
		// not a consequence of where something got mounted.
		expect([...SESSION_EXEMPT_PREFIXES]).toEqual([
			"/api/auth/",
			"/api/auth-state",
			"/api/invitations/",
			"/api/inngest",
			"/internal/",
		]);
	});

	test("the declared exact paths", () => {
		expect([...SESSION_EXEMPT_PATHS]).toEqual(["/health", "/mcp", "/api/mcp"]);
		// Exact, not a prefix: the MCP-server configuration routes keep the session check.
		expect(isSessionExempt("/api/mcp-servers")).toBe(false);
	});
});

describe("machine boundaries stay reachable", () => {
	test("the Inngest sync endpoint is not covered", () => {
		// If this ever goes false, durable execution stops silently.
		expect(isSessionExempt("/api/inngest")).toBe(true);
	});

	test("the internal configuration service is not covered", () => {
		expect(isSessionExempt("/internal/config")).toBe(true);
		expect(isSessionExempt("/internal/provider-config/openai")).toBe(true);
	});

	test("invitation redemption is not covered", () => {
		// Whoever is redeeming does not have an account yet. A session check here
		// would make an invitation impossible to accept.
		expect(isSessionExempt("/api/invitations/abc123")).toBe(true);
		expect(isSessionExempt("/api/invitations/abc123/redeem")).toBe(true);
	});

	test("the auth endpoints are not covered", () => {
		// Requiring a session to sign in is a closed loop with no way in.
		expect(isSessionExempt("/api/auth/sign-in/email")).toBe(true);
		expect(isSessionExempt("/api/auth/get-session")).toBe(true);
		expect(isSessionExempt("/api/auth-state")).toBe(true);
	});

	test("liveness is not covered", () => {
		expect(isSessionExempt("/health")).toBe(true);
	});
});

describe("everything else is covered", () => {
	test("data routes require a session", () => {
		for (const path of [
			"/api/workspaces",
			"/api/settings",
			"/api/credits",
			"/api/image-gen",
			"/api/operations",
			"/api/security",
			"/api/providers",
		]) {
			expect(isSessionExempt(path)).toBe(false);
		}
	});

	test("media files require a session", () => {
		// The gap a rule written as "every /api/* route" would have left wide open.
		expect(isSessionExempt("/uploads/clip.mp4")).toBe(false);
		expect(isSessionExempt("/uploads/render-1.png")).toBe(false);
	});

	test("a route nobody has written yet is covered", () => {
		expect(isSessionExempt("/api/some-future-route")).toBe(false);
		expect(isSessionExempt("/")).toBe(false);
	});

	test("an exempt prefix cannot be used to smuggle a covered path", () => {
		// `/health` is exact, so this must not inherit its exemption.
		expect(isSessionExempt("/healthz")).toBe(false);
		expect(isSessionExempt("/health/secrets")).toBe(false);
	});

	test("a lookalike prefix outside the list is covered", () => {
		// `/internal/` carries the trailing slash for this reason.
		expect(isSessionExempt("/internal-notes")).toBe(false);
		expect(isSessionExempt("/api/authorise")).toBe(false);
	});
});
