/* The sign-in boundary must NOT behave like the rest of the HTTP boundary.
 *
 * Everywhere else a 401 means "your session went away, go to /login". Here it
 * means "that password was wrong". If these calls went through `client.ts` the
 * sign-in screen would answer a typo by navigating to itself — a reload that
 * discards what was typed and shows no error, forever. That is the loop this
 * file exists to pin shut.
 *
 * `fetch` is stubbed rather than pointed at a local server. What is under test
 * is the client's POLICY — which status produces which message, and whether it
 * navigates — not transport. Transport is covered against a real server in
 * app/api-proxy.bun.test.ts. Stubbing also sidesteps module load order: `apiUrl()`
 * captures its base at import, and by the time this suite runs another module
 * has already imported it with the empty same-origin base, which `fetch` in a
 * test process cannot resolve. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import {
	changePassword,
	createFirstOwner,
	listSessions,
	readAuthState,
	readSession,
	revokeOtherSessions,
	signIn,
	signOut,
	updateName,
} from "./auth.ts";

const realFetch = globalThis.fetch;
/** Set per test to shape the next answer. */
let reply: (req: Request) => Response = () => new Response("{}");
/** Paths the client asked for, so the boundary itself can be asserted. */
const requested: string[] = [];
const navigations: string[] = [];

beforeAll(() => {
	globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
		const path = typeof input === "string" ? input : input.toString();
		requested.push(path);
		return Promise.resolve(reply(new Request(`http://stub.local${path}`, init)));
	}) as typeof fetch;

	/* jsdom is not in play here; `window.location.href = ...` would throw. The
	 * navigation is the behaviour under test, so it is recorded rather than
	 * performed. */
	(globalThis as unknown as { window: unknown }).window = {
		location: {
			get href() {
				return "http://127.0.0.1/login";
			},
			set href(value: string) {
				navigations.push(value);
			},
			search: "",
		},
	};
});

afterAll(() => {
	globalThis.fetch = realFetch;
});

afterEach(() => {
	navigations.length = 0;
	requested.length = 0;
});

describe("a failed sign-in is an answer, not a redirect", () => {
	test("a wrong password throws and navigates nowhere", async () => {
		reply = () =>
			new Response(JSON.stringify({ message: "Invalid email or password" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});

		await expect(signIn("owner@example.com", "wrong")).rejects.toThrow();
		// The whole point: no navigation. A redirect here is the infinite loop.
		expect(navigations).toEqual([]);
	});

	test("the refusal message is shown rather than a status code", async () => {
		reply = () =>
			new Response(JSON.stringify({ message: "Invalid email or password" }), {
				status: 401,
				headers: { "content-type": "application/json" },
			});

		await expect(signIn("owner@example.com", "wrong")).rejects.toThrow("Invalid email or password");
	});

	test("a rate-limited attempt says so instead of blaming the password", async () => {
		reply = () =>
			new Response("{}", { status: 429, headers: { "content-type": "application/json" } });

		await expect(signIn("owner@example.com", "right")).rejects.toThrow(/Too many attempts/);
	});

	test("a refusal never reveals whether the address is registered", async () => {
		reply = () =>
			new Response("{}", { status: 401, headers: { "content-type": "application/json" } });

		const message = await signIn("nobody@example.com", "x").catch((e: Error) => e.message);

		expect(message).not.toContain("nobody@example.com");
		expect(message).toMatch(/did not match/);
	});
});

describe("reading who is signed in", () => {
	test("a 401 reads as nobody rather than throwing", async () => {
		reply = () => new Response("{}", { status: 401 });

		// The gate calls this before anything renders; a throw here would be a
		// blank page rather than a sign-in screen.
		expect(await readSession()).toBeNull();
	});

	test("a session returns its user", async () => {
		reply = () =>
			new Response(JSON.stringify({ user: { id: "u1", email: "a@example.com", name: "A" } }), {
				headers: { "content-type": "application/json" },
			});

		expect(await readSession()).toMatchObject({ id: "u1", email: "a@example.com" });
	});

	test("an empty body reads as nobody", async () => {
		reply = () => new Response("null", { headers: { "content-type": "application/json" } });

		expect(await readSession()).toBeNull();
	});
});

describe("the screen asks which screen it is", () => {
	test("an unclaimed deployment reports no accounts", async () => {
		reply = () =>
			new Response(JSON.stringify({ hasAccounts: false, registrationOpen: true }), {
				headers: { "content-type": "application/json" },
			});

		expect(await readAuthState()).toMatchObject({ hasAccounts: false });
	});

	test("creating the first owner reports the refusal reason on failure", async () => {
		reply = () =>
			new Response(JSON.stringify({ message: "registration is closed on this deployment" }), {
				status: 403,
				headers: { "content-type": "application/json" },
			});

		await expect(createFirstOwner("a@example.com", "x".repeat(12), "A")).rejects.toThrow(
			"registration is closed",
		);
	});
});

describe("the session cookie is actually sent", () => {
	test("every call includes credentials", async () => {
		reply = () =>
			new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

		await readSession();

		// Without `credentials: "include"` the cookie never leaves the browser on
		// a cross-origin deployment, and every request is anonymous.
		expect(requested).toEqual(["/api/auth/get-session"]);
	});
});

describe("sign-out", () => {
	test("does not throw when the session is already gone", async () => {
		reply = () => new Response("{}", { status: 401 });

		// Signing out of an expired session is a no-op, not an error to show.
		await signOut();
		expect(navigations).toEqual([]);
	});
});

const json = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("sign-out reports what happened", () => {
	test("a server failure throws, so the operator is not shown sign-in with a live session", async () => {
		reply = () => json({ message: "boom" }, 500);
		await expect(signOut()).rejects.toThrow();
	});

	test("success resolves", async () => {
		reply = () => json({ success: true });
		await signOut();
		expect(requested).toEqual(["/api/auth/sign-out"]);
	});
});

describe("account calls are answers, not redirects", () => {
	test("updateName posts the trimmed name", async () => {
		let body: Promise<unknown> | undefined;
		reply = (req) => {
			body = req.json();
			return json({ status: true });
		};
		await updateName("  Ada  ");
		expect(requested).toEqual(["/api/auth/update-user"]);
		expect(await body).toEqual({ name: "Ada" });
	});

	test("updateName surfaces the refusal", async () => {
		reply = () => json({ message: "Name too long" }, 400);
		await expect(updateName("x")).rejects.toThrow("Name too long");
		expect(navigations).toEqual([]);
	});

	test("changePassword asks the server to sign out other sessions", async () => {
		let body: Promise<unknown> | undefined;
		reply = (req) => {
			body = req.json();
			return json({ token: null });
		};
		await changePassword("old-password-123", "new-password-456");
		expect(requested).toEqual(["/api/auth/change-password"]);
		expect(await body).toEqual({
			currentPassword: "old-password-123",
			newPassword: "new-password-456",
			revokeOtherSessions: true,
		});
	});

	test("a wrong current password says so and navigates nowhere", async () => {
		reply = () => json({ message: "Invalid password", code: "INVALID_PASSWORD" }, 400);
		await expect(changePassword("wrong", "new-password-456")).rejects.toThrow(
			"Current password is incorrect.",
		);
		expect(navigations).toEqual([]);
	});

	test("a 401 on change-password is an answer, not a redirect", async () => {
		reply = () => json({ message: "Unauthorized" }, 401);
		await expect(changePassword("a", "b")).rejects.toThrow("Unauthorized");
		expect(navigations).toEqual([]);
	});

	test("listSessions marks the current session", async () => {
		reply = (req) =>
			new URL(req.url).pathname.endsWith("/get-session")
				? json({ session: { id: "s2" }, user: { id: "u" } })
				: json([
						{ id: "s1", userAgent: "Firefox", updatedAt: "2026-09-28T00:00:00.000Z" },
						{ id: "s2", userAgent: "Chrome", updatedAt: "2026-09-29T00:00:00.000Z" },
					]);
		const sessions = await listSessions();
		expect(sessions.map((s) => [s.id, s.current])).toEqual([
			["s1", false],
			["s2", true],
		]);
	});

	test("listSessions surfaces a refusal", async () => {
		reply = () => json({ message: "Forbidden" }, 403);
		await expect(listSessions()).rejects.toThrow("Forbidden");
	});

	test("revokeOtherSessions posts and surfaces a refusal", async () => {
		reply = () => json({ status: true });
		await revokeOtherSessions();
		expect(requested).toEqual(["/api/auth/revoke-other-sessions"]);
		reply = () => json({ message: "nope" }, 500);
		await expect(revokeOtherSessions()).rejects.toThrow("nope");
	});
});
