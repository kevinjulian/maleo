/* Who may create an account, what the first one gets, and what a failed
 * attempt reveals.
 *
 * Driven through the library's HTTP handler rather than its internal API,
 * because the answers that matter here are the ones a caller on the network
 * actually receives: the status, the body, and the Set-Cookie header. An
 * assertion against an internal return value would pass while the route in
 * front of it leaked the difference. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { listWorkspacesForUser } from "@maleo/db/workspace-members";
import { resolveCaller } from "@maleo/auth/session";
import { Hono } from "hono";
import { testApp } from "./auth-testing.ts";
import { instanceOwnerOnly } from "./instance-owner.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
const priorAllowSignup = process.env.MALEO_ALLOW_SIGNUP;
let dataDir = "";

const PASSWORD = "correct-horse-battery-staple";

type AuthModule = typeof import("@maleo/auth/config");

async function authModule(): Promise<AuthModule> {
	// Imported per test, after the database redirect is in place. `getAuth()`
	// rebuilds on a new handle, so this stays correct across suites.
	const mod = await import("@maleo/auth/config");
	await mod.ensureAuthTables();
	return mod;
}

/* Each call gets its own client address unless one is named.
 *
 * The library's rate-limit store is in memory and outlives a single auth
 * instance, so counts accumulate across tests in this file. Sharing one address
 * would make every suite after the fourth fail on 429 — a fake failure that
 * looks exactly like a real authorisation bug. The rate-limit test below pins a
 * single address on purpose, which is the only place the limiter is under
 * test. */
let addresses = 0;
const nextAddress = (): string => `203.0.113.${(addresses += 1) % 250}`;

const post = async (
	mod: AuthModule,
	path: string,
	body: unknown,
	ip: string = nextAddress(),
): Promise<Response> =>
	mod.getAuth().handler(
		new Request(`http://127.0.0.1/api/auth${path}`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-forwarded-for": ip },
			body: JSON.stringify(body),
		}),
	);

const signUp = (mod: AuthModule, email: string): Promise<Response> =>
	post(mod, "/sign-up/email", { email, password: PASSWORD, name: email });

const signIn = (
	mod: AuthModule,
	email: string,
	password = PASSWORD,
	ip?: string,
): Promise<Response> => post(mod, "/sign-in/email", { email, password }, ip ?? nextAddress());

const roleOf = async (email: string): Promise<string | null> =>
	(
		await openDb().get<{ role: string | null }>(`SELECT role FROM auth_user WHERE email = ?`, [
			email,
		])
	)?.role ?? null;

const userIdOf = async (email: string): Promise<string> =>
	(await openDb().get<{ id: string }>(`SELECT id FROM auth_user WHERE email = ?`, [email]))!.id;

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-auth-bootstrap-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	delete process.env.MALEO_ALLOW_SIGNUP;
	await closeMaleoDb();
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	if (priorAllowSignup === undefined) delete process.env.MALEO_ALLOW_SIGNUP;
	else process.env.MALEO_ALLOW_SIGNUP = priorAllowSignup;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("the first account claims the deployment", () => {
	test("first sign-up succeeds and holds the instance owner role", async () => {
		const mod = await authModule();

		const response = await signUp(mod, "owner@example.com");

		expect(response.status).toBe(200);
		expect(await roleOf("owner@example.com")).toBe(mod.INSTANCE_OWNER);
		// First in the file: it pays for loading the auth library and migrating a fresh
		// database, which outlasts the default 5s under a parallel `bun run test`. A
		// timeout kills the embedded cluster with the test and fails every test after
		// it, so this one is given room.
	}, 60_000);

	test("a second sign-up is refused, and creates nothing", async () => {
		const mod = await authModule();
		await signUp(mod, "owner@example.com");

		const response = await signUp(mod, "intruder@example.com");

		expect(response.status).toBe(403);
		expect(await roleOf("intruder@example.com")).toBeNull();
	});

	test("an operator can deliberately open registration", async () => {
		const mod = await authModule();
		await signUp(mod, "owner@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";

		const response = await signUp(mod, "colleague@example.com");

		expect(response.status).toBe(200);
		// Opening the door does not hand out the deployment.
		expect(await roleOf("colleague@example.com")).toBe(mod.MEMBER);
	});

	test("a sign-up body cannot name its own role", async () => {
		const mod = await authModule();

		await post(mod, "/sign-up/email", {
			email: "owner@example.com",
			password: PASSWORD,
			name: "Owner",
			role: "instance_owner",
		});
		process.env.MALEO_ALLOW_SIGNUP = "1";
		await post(mod, "/sign-up/email", {
			email: "climber@example.com",
			password: PASSWORD,
			name: "Climber",
			role: "instance_owner",
		});

		// The field is server-controlled; the second account gets member whatever
		// it asked for.
		expect(await roleOf("climber@example.com")).toBe(mod.MEMBER);
	});
});

describe("existing work stays reachable after auth is turned on", () => {
	test("the first account owns every workspace already in the registry", async () => {
		const mod = await authModule();
		const db = openDb();
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" }, db);
		await upsertWorkspace({ name: "beta", workspace_dir: "/tmp/beta" }, db);

		await signUp(mod, "owner@example.com");

		expect(await listWorkspacesForUser(await userIdOf("owner@example.com"), db)).toEqual([
			"alpha",
			"beta",
		]);
	});

	test("a later account inherits nothing", async () => {
		const mod = await authModule();
		const db = openDb();
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" }, db);
		await signUp(mod, "owner@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";

		await signUp(mod, "colleague@example.com");

		expect(await listWorkspacesForUser(await userIdOf("colleague@example.com"), db)).toEqual([]);
	});
});

describe("credentials", () => {
	test("the stored verifier is argon2id and holds no recoverable password", async () => {
		const mod = await authModule();
		await signUp(mod, "owner@example.com");

		const stored = (await openDb().get<{ password: string }>(
			`SELECT password FROM auth_account LIMIT 1`,
		))!.password;

		expect(stored.startsWith("$argon2id$")).toBe(true);
		expect(stored).not.toContain(PASSWORD);
	});

	test("an unknown address and a wrong password are indistinguishable", async () => {
		const mod = await authModule();
		await signUp(mod, "owner@example.com");

		const unknown = await signIn(mod, "nobody@example.com");
		const wrong = await signIn(mod, "owner@example.com", "not-the-password");

		expect(unknown.status).toBe(wrong.status);
		expect(await unknown.text()).toBe(await wrong.text());
	});

	test("repeated failures are refused once the limit is reached", async () => {
		const mod = await authModule();
		await signUp(mod, "owner@example.com");

		// One address throughout: this is the only test where the limiter is the
		// subject rather than a nuisance.
		const attacker = "198.51.100.7";
		const statuses: number[] = [];
		for (let i = 0; i < 8; i += 1) {
			statuses.push((await signIn(mod, "owner@example.com", "wrong-password", attacker)).status);
		}
		// And a CORRECT password is refused too, which is the point: the limiter
		// must not be a password oracle that opens on the right guess.
		const correctAfterLimit = await signIn(mod, "owner@example.com", PASSWORD, attacker);

		expect(statuses).toContain(429);
		expect(correctAfterLimit.status).toBe(429);
	});

	test("the attempt count is kept in the database, where every API replica reads it", async () => {
		// An in-memory count is per process: with two replicas an attacker gets
		// the limit twice over by landing on each in turn. The library's memory
		// store is shared by every instance in one process, so no in-process test
		// can show two replicas; what it can show is where the count lives.
		const mod = await authModule();
		await signUp(mod, "owner@example.com");
		const attacker = "198.51.100.9";
		for (let i = 0; i < 3; i += 1)
			await signIn(mod, "owner@example.com", "wrong-password", attacker);

		const rows = await openDb().all<{ key: string; count: number }>(
			`SELECT key, count FROM auth_rate_limit WHERE key LIKE ?`,
			[`%${attacker}%sign-in/email%`],
		);
		expect(rows).toHaveLength(1);
		expect(Number(rows[0]!.count)).toBe(3);
	});
});

describe("the session cookie", () => {
	test("current account state overrides old session role and suspension", async () => {
		const mod = await authModule();
		const signedUp = await signUp(mod, "owner@example.com");
		const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0]!;
		const request = () => new Request("http://127.0.0.1/api/health", { headers: { cookie } });
		expect((await resolveCaller(request()))?.role).toBe("instance_owner");
		await openDb().run(`UPDATE auth_user SET role = 'member' WHERE email = ?`, [
			"owner@example.com",
		]);
		expect((await resolveCaller(request()))?.role).toBe("member");
		await openDb().run(`UPDATE auth_user SET suspended = true WHERE email = ?`, [
			"owner@example.com",
		]);
		expect(await resolveCaller(request())).toBeNull();
	});

	test("session response exposes instance owner role to the navigation shell", async () => {
		const mod = await authModule();
		const signedUp = await signUp(mod, "owner@example.com");
		const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0]!;
		const response = await mod
			.getAuth()
			.handler(new Request("http://127.0.0.1/api/auth/get-session", { headers: { cookie } }));
		expect(response.status).toBe(200);
		expect(((await response.json()) as { user: { role: string } }).user.role).toBe(
			"instance_owner",
		);
	});

	test("instance admin routes refuse ordinary members", async () => {
		const routes = new Hono();
		routes.use("*", instanceOwnerOnly());
		routes.get("/", (c) => c.json({ ok: true }));
		const member = testApp(routes, { userId: "member", email: "m@example.com", role: "member" });
		expect((await member.request("/")).status).toBe(403);
		expect((await testApp(routes).request("/")).status).toBe(200);
	});
	test("carries httpOnly and SameSite=Lax, and no Secure over plain http", async () => {
		const mod = await authModule();

		const cookie = (await signUp(mod, "owner@example.com")).headers.get("set-cookie") ?? "";

		expect(cookie).toContain("HttpOnly");
		expect(cookie).toContain("SameSite=Lax");
		// Development is http://127.0.0.1. A Secure cookie is not stored there at
		// all, so asserting it unconditionally would pin a broken sign-in.
		expect(cookie).not.toContain("Secure");
	});

	test("production configuration marks the cookie Secure", async () => {
		// The test database is opened first: production refuses to open one
		// without a real credential, and this asserts the cookie policy only.
		await authModule();
		const priorNodeEnv = process.env.NODE_ENV;
		process.env.NODE_ENV = "production";
		try {
			const mod = await authModule();
			// A fresh instance is built once production-ness changes, so it reads the
			// production setting rather than the one captured earlier.
			expect(mod.getAuth().options.advanced?.useSecureCookies).toBe(true);
		} finally {
			if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
			else process.env.NODE_ENV = priorNodeEnv;
		}
	});

	test("a bounded lifetime is set rather than left open-ended", async () => {
		const mod = await authModule();

		const expiresIn = mod.getAuth().options.session?.expiresIn;

		expect(typeof expiresIn).toBe("number");
		expect(expiresIn).toBeLessThanOrEqual(60 * 60 * 24 * 30);
	});

	test("signing out revokes the session server-side", async () => {
		const mod = await authModule();
		const signedUp = await signUp(mod, "owner@example.com");
		const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0]!;

		const sessionsBefore = (await openDb().get<{ c: number }>(
			`SELECT count(*) AS c FROM auth_session`,
		))!.c;
		const out = await mod.getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-out", {
				method: "POST",
				headers: { cookie, "content-type": "application/json" },
			}),
		);
		const sessionsAfter = (await openDb().get<{ c: number }>(
			`SELECT count(*) AS c FROM auth_session`,
		))!.c;

		expect(out.status).toBe(200);
		expect(sessionsBefore).toBe(1);
		// The row is gone, not merely the cookie cleared: a copied cookie must not
		// keep working.
		expect(sessionsAfter).toBe(0);
	});

	test("a session older than a day can still list its sessions", async () => {
		// The Security page lists sessions. better-auth refuses that once a
		// session passes `freshAge` unless the gate is off, which would fail for
		// nearly every operator — see the comment on `freshAge` in config.ts.
		const mod = await authModule();
		const signedUp = await signUp(mod, "owner@example.com");
		const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0]!;
		const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
		await openDb().run(`UPDATE auth_session SET "createdAt" = ?`, [twoDaysAgo.toISOString()]);

		const response = await mod
			.getAuth()
			.handler(new Request("http://127.0.0.1/api/auth/list-sessions", { headers: { cookie } }));

		expect(response.status).toBe(200);
		expect(((await response.json()) as unknown[]).length).toBe(1);
	});

	test("a revoked session is refused on the next request", async () => {
		const mod = await authModule();
		const signedUp = await signUp(mod, "owner@example.com");
		const cookie = (signedUp.headers.get("set-cookie") ?? "").split(";")[0]!;
		const sessionRequest = (): Request =>
			new Request("http://127.0.0.1/api/auth/get-session", { headers: { cookie } });

		const before = await mod.getAuth().handler(sessionRequest());
		expect(await before.json()).not.toBeNull();

		await openDb().run(`DELETE FROM auth_session`);

		const after = await mod.getAuth().handler(sessionRequest());
		expect(await after.json()).toBeNull();
	});
});
