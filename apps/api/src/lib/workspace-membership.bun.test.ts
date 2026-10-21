/* Membership as a route sees it.
 *
 * `workspace-members.bun.test.ts` in @maleo/db covers the table. This covers the
 * seam: that `workspaceScope()` refuses a non-member, that it refuses in a way
 * that reveals nothing, and that a removal is felt on the very next request
 * rather than at the next sign-in.
 *
 * The indistinguishability assertion is the one worth keeping honest. A refusal
 * that says "forbidden" for a workspace that exists and "not found" for one
 * that does not turns the API into a directory of every tenant the deployment
 * holds — readable by any account, including one invited to a single
 * workspace. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { addWorkspaceMember, removeWorkspaceMember } from "@maleo/db/workspace-members";
import { scaffoldWorkspace } from "./workspace/scaffold.ts";
import { ensureDefaultWorkspace, syncWorkspaceRegistry } from "./workspace/registry.ts";
import { activeWorkspace, workspaceScope } from "./active-workspace.ts";
import { installTestCaller } from "../middleware/auth-testing.ts";
import type { Caller } from "@maleo/auth/session";

const MEMBER: Caller = { userId: "u-member", email: "m@example.com", role: "member" };
const OUTSIDER: Caller = { userId: "u-outsider", email: "o@example.com", role: "member" };

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-membership-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	await ensureDefaultWorkspace();
	await syncWorkspaceRegistry();
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted — see scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

/** A scoped surface, wired the way every route family wires one. */
function app(caller: Caller): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller(caller));
	instance.use("*", workspaceScope());
	instance.get("/probe", (c) => c.json({ workspace: activeWorkspace(c) }));
	return instance;
}

describe("a caller acts only where they are a member", () => {
	test("a member is served their workspace", async () => {
		await scaffoldWorkspace("veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: MEMBER.userId });

		const res = await app(MEMBER).request("/probe?workspace=veronika");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ workspace: "veronika" });
	});

	test("a non-member is refused a workspace that exists", async () => {
		await scaffoldWorkspace("veronika");

		const res = await app(OUTSIDER).request("/probe?workspace=veronika");

		expect(res.status).toBe(400);
	});

	test("belonging elsewhere grants nothing here", async () => {
		await scaffoldWorkspace("veronika");
		await scaffoldWorkspace("marcus");
		await addWorkspaceMember({ workspace: "marcus", user_id: MEMBER.userId });

		const res = await app(MEMBER).request("/probe?workspace=veronika");

		expect(res.status).toBe(400);
	});
});

describe("a refusal does not say which workspaces exist", () => {
	test("a real workspace and an invented one answer identically", async () => {
		await scaffoldWorkspace("veronika");

		const real = await app(OUTSIDER).request("/probe?workspace=veronika");
		const invented = await app(OUTSIDER).request("/probe?workspace=veronikaa");

		expect(real.status).toBe(invented.status);
		// Same body but for the echoed name — otherwise the API is a tenant
		// directory for any signed-in account.
		expect(await real.json()).toEqual({ error: "unknown_workspace", workspace: "veronika" });
		expect(await invented.json()).toEqual({ error: "unknown_workspace", workspace: "veronikaa" });
	});
});

describe("membership changes take effect immediately", () => {
	test("a removal is felt on the next request, with no re-authentication", async () => {
		await scaffoldWorkspace("veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: MEMBER.userId, role: "owner" });
		await addWorkspaceMember({ workspace: "veronika", user_id: OUTSIDER.userId });
		const server = app(OUTSIDER);

		const before = await server.request("/probe?workspace=veronika");
		await removeWorkspaceMember("veronika", OUTSIDER.userId);
		const after = await server.request("/probe?workspace=veronika");

		expect(before.status).toBe(200);
		// The session is untouched and still valid. Membership is read per
		// request precisely so that revoking access does not wait for a sign-out.
		expect(after.status).toBe(400);
	});

	test("a grant is felt on the next request too", async () => {
		await scaffoldWorkspace("veronika");
		const server = app(OUTSIDER);

		const before = await server.request("/probe?workspace=veronika");
		await addWorkspaceMember({ workspace: "veronika", user_id: OUTSIDER.userId });
		const after = await server.request("/probe?workspace=veronika");

		expect(before.status).toBe(400);
		expect(after.status).toBe(200);
	});
});

describe("the default workspace is not a free pass", () => {
	test("an account with no memberships cannot fall back into default", async () => {
		// The absent-workspace case resolves to `default`. Resolving it must not
		// also authorise it, or every signed-in account reaches the tenant that
		// owns every project written before scoping existed.
		const res = await app(OUTSIDER).request("/probe");

		expect(res.status).toBe(400);
	});

	test("a member of default reaches it without naming it", async () => {
		await addWorkspaceMember({ workspace: "default", user_id: MEMBER.userId });

		const res = await app(MEMBER).request("/probe");

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ workspace: "default" });
	});
});
