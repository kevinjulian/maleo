/* Inviting somebody, and them arriving.
 *
 * Driven through the real routes and better-auth's real sign-up, because the
 * claim being tested is that redemption gets past CLOSED registration — and
 * that refusal lives inside a library hook, not in this repository's route
 * code. A test that stubbed the sign-up would assert nothing about it. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { upsertWorkspace } from "@maleo/db/workspaces";
import {
	addWorkspaceMember,
	isWorkspaceMember,
	listWorkspacesForUser,
} from "@maleo/db/workspace-members";
import { listPendingInvitations, mintInvitation } from "@maleo/db/workspace-invitations";
import { invitationRoutes } from "./invitations.ts";
import { workspacesRoutes } from "./workspaces.ts";
import { testApp } from "../middleware/auth-testing.ts";
import type { Caller } from "@maleo/auth/session";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
const priorAllowSignup = process.env.MALEO_ALLOW_SIGNUP;
let dataDir = "";

const json = { "content-type": "application/json" };
const PASSWORD = "correct-horse-battery-staple";
/* The owner is a REAL account, created through sign-up.
 *
 * Seeding a membership for an invented user id would leave the deployment with
 * zero accounts, and the first-account rule would then hand the deployment to
 * whoever redeemed the invitation. That cannot happen in production — an
 * invitation can only be minted by an owner, who by definition has an account —
 * so a fixture that allowed it would be testing a state the system cannot
 * reach. */
let owner: Caller;
/* A distinct client address per call.
 *
 * better-auth's rate-limit store is in memory and outlives a single auth
 * instance, so sign-ups accumulate across tests in this file. Sharing one
 * address would make every suite after the fifth fail on 429 — a fake failure
 * that looks exactly like a real authorisation bug. */
let addresses = 0;
const nextAddress = (): string => `203.0.113.${(addresses += 1) % 250}`;
const member: Caller = { userId: "u-member", email: "m@example.com", role: "member" };

/** Invitation routes answer signed-out callers, so no caller is installed. */
const publicApp = (): Hono => {
	const app = new Hono();
	app.route("/", invitationRoutes());
	return app;
};

const ownerApp = (caller?: Caller) => testApp(workspacesRoutes(), caller ?? owner);

async function ensureAuthTables(): Promise<void> {
	const mod = await import("@maleo/auth/config");
	await mod.ensureAuthTables();
}

async function seed(): Promise<void> {
	await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" }, openDb());

	// The first account, which claims the deployment — exactly as a real one does.
	const mod = await import("@maleo/auth/config");
	const res = await mod.getAuth().handler(
		new Request("http://127.0.0.1/api/auth/sign-up/email", {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "o@example.com", password: PASSWORD, name: "Owner" }),
		}),
	);
	expect(res.status).toBe(200);
	const id = (await openDb().get<{ id: string }>(
		`SELECT id FROM auth_user WHERE email = 'o@example.com'`,
	))!.id;
	owner = { userId: id, email: "o@example.com", role: "instance_owner" };

	await addWorkspaceMember({ workspace: "alpha", user_id: owner.userId, role: "owner" });
	await addWorkspaceMember({ workspace: "alpha", user_id: member.userId, role: "member" });
}

/** Mint through the route, as an owner would. */
async function invite(): Promise<{ token: string; id: string }> {
	const res = await ownerApp().request("/alpha/invitations", {
		method: "POST",
		headers: json,
		body: "{}",
	});
	expect(res.status).toBe(201);
	const body = (await res.json()) as { token: string; item: { id: string } };
	return { token: body.token, id: body.item.id };
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-invites-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	// Registration CLOSED: the point of the suite is that an invitation still works.
	delete process.env.MALEO_ALLOW_SIGNUP;
	await closeMaleoDb();
	await ensureAuthTables();
	await seed();
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

describe("minting an invitation", () => {
	test("an owner gets a token, once", async () => {
		const res = await ownerApp().request("/alpha/invitations", {
			method: "POST",
			headers: json,
			body: "{}",
		});
		const body = (await res.json()) as { token: string; item: { id: string } };

		expect(res.status).toBe(201);
		expect(body.token.length).toBeGreaterThan(30);
		// Not recoverable afterwards: the row holds only a hash.
		const stored = (await openDb().get<{ token_hash: string }>(
			`SELECT token_hash FROM workspace_invitations WHERE id = ?`,
			[body.item.id],
		))!;
		expect(stored.token_hash).not.toBe(body.token);
	});

	test("a member cannot invite", async () => {
		const res = await ownerApp(member).request("/alpha/invitations", {
			method: "POST",
			headers: json,
			body: "{}",
		});

		expect(res.status).toBe(403);
		expect(await listPendingInvitations("alpha")).toEqual([]);
	});

	test("an owner can revoke one", async () => {
		const { token, id } = await invite();

		const res = await ownerApp().request(`/alpha/invitations/${id}`, { method: "DELETE" });

		expect(res.status).toBe(200);
		expect((await publicApp().request(`/${token}`)).status).toBe(404);
	});
});

describe("redeeming past closed registration", () => {
	test("a new person gets an account and exactly one membership", async () => {
		const { token } = await invite();

		const res = await publicApp().request(`/${token}/redeem`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "invitee@example.com", password: PASSWORD, name: "Invitee" }),
		});

		expect(res.status).toBe(200);
		const created = (await openDb().get<{ id: string; role: string }>(
			`SELECT id, role FROM auth_user WHERE email = 'invitee@example.com'`,
		))!;
		expect(created).toBeTruthy();
		// The deployment is not handed over by an invitation.
		expect(created.role).toBe("member");
		expect(await listWorkspacesForUser(created.id)).toEqual(["alpha"]);
	});

	test("the session cookie comes back, so they are signed in", async () => {
		const { token } = await invite();

		const res = await publicApp().request(`/${token}/redeem`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "invitee2@example.com", password: PASSWORD }),
		});

		expect(res.headers.get("set-cookie")).toContain("session_token");
	});

	test("an ordinary sign-up is still refused", async () => {
		const mod = await import("@maleo/auth/config");
		/* The deployment already has an account (the owner), so the first-account
		 * rule does not apply and registration is closed. No invitation is in
		 * play, which is what proves the exemption is scoped to the redemption
		 * call stack rather than switched on globally while one is outstanding. */
		const res = await mod.getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-up/email", {
				method: "POST",
				headers: { ...json, "x-forwarded-for": nextAddress() },
				body: JSON.stringify({ email: "uninvited@example.com", password: PASSWORD, name: "No" }),
			}),
		);

		expect(res.status).toBe(403);
	});

	test("a link works once", async () => {
		const { token } = await invite();
		await publicApp().request(`/${token}/redeem`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "first@example.com", password: PASSWORD }),
		});

		const second = await publicApp().request(`/${token}/redeem`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "second@example.com", password: PASSWORD }),
		});

		expect(second.status).toBe(404);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_user WHERE email = 'second@example.com'`,
				)
			)?.c,
		).toBe(0);
	});
});

describe("the four bad tokens answer the same", () => {
	test("forged, expired, spent and revoked are indistinguishable", async () => {
		const forged = await publicApp().request("/not-a-token");

		const expiredMint = await mintInvitation({
			workspace: "alpha",
			invitedBy: owner.userId,
			lifetimeMs: 1,
		});
		await Bun.sleep(5);
		const expired = await publicApp().request(`/${expiredMint.token}`);

		const spentMint = await invite();
		await publicApp().request(`/${spentMint.token}/redeem`, {
			method: "POST",
			headers: { ...json, "x-forwarded-for": nextAddress() },
			body: JSON.stringify({ email: "spent@example.com", password: PASSWORD }),
		});
		const spent = await publicApp().request(`/${spentMint.token}`);

		const revokedMint = await invite();
		await ownerApp().request(`/alpha/invitations/${revokedMint.id}`, { method: "DELETE" });
		const revoked = await publicApp().request(`/${revokedMint.token}`);

		const answers = await Promise.all(
			[forged, expired, spent, revoked].map(async (r) => `${r.status}:${await r.text()}`),
		);
		// One answer, so trying tells a prober nothing.
		expect(new Set(answers).size).toBe(1);
		expect(answers[0]).toContain("404");
	});
});

describe("an account that already exists", () => {
	test("gains the membership rather than a second account", async () => {
		// A second workspace, so the owner has somewhere to be invited TO that
		// they are not already in.
		await upsertWorkspace({ name: "beta", workspace_dir: "/tmp/beta" }, openDb());
		await addWorkspaceMember({ workspace: "beta", user_id: member.userId, role: "owner" });
		const minted = await ownerApp({
			userId: member.userId,
			email: member.email,
			role: "member",
		}).request("/beta/invitations", { method: "POST", headers: json, body: "{}" });
		const token = ((await minted.json()) as { token: string }).token;

		// Sign the owner in: a real session for an account that already exists.
		const mod = await import("@maleo/auth/config");
		const signIn = await mod.getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-in/email", {
				method: "POST",
				headers: { ...json, "x-forwarded-for": nextAddress() },
				body: JSON.stringify({ email: "o@example.com", password: PASSWORD }),
			}),
		);
		expect(signIn.status).toBe(200);
		const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0]!;
		const before = (await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM auth_user`))!.c;

		const res = await publicApp().request(`/${token}/redeem`, {
			method: "POST",
			headers: { ...json, cookie },
			body: "{}",
		});

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ joined_existing_account: true });
		// No second identity was created for someone who already had one.
		expect((await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM auth_user`))!.c).toBe(
			before,
		);
		expect(await isWorkspaceMember("beta", owner.userId)).toBe(true);
	});
});

describe("the redemption screen can name the workspace", () => {
	test("a valid token reveals the display name and nothing more", async () => {
		const { token } = await invite();

		const body = (await (await publicApp().request(`/${token}`)).json()) as {
			item: Record<string, unknown>;
		};

		expect(body.item).toMatchObject({ workspace: "alpha", role: "member" });
		// Not the member list, not the description, not who invited them.
		expect(Object.keys(body.item).sort()).toEqual([
			"display_name",
			"expires_at",
			"role",
			"workspace",
		]);
	});
});
