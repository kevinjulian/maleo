/* Membership is the authorisation boundary, so its edges are asserted rather
 * than assumed — especially the one that cannot be undone from inside the app:
 * a workspace left with no owner. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "./handle-testing.ts";
import type { Db } from "./handle.ts";
import {
	addWorkspaceMember,
	getWorkspaceMember,
	isWorkspaceMember,
	LastOwnerError,
	listWorkspaceMembers,
	listWorkspacesForUser,
	pruneMembershipsOutsideRegistry,
	removeWorkspaceMember,
	setWorkspaceMemberRole,
} from "./workspace-members.ts";

let db: Db;
let t: TestDb;

const workspace = async (name: string): Promise<void> => {
	await db.run(
		`INSERT INTO workspaces (name, display_name, status, workspace_dir, created_at, updated_at)
		 VALUES (?, ?, 'active', ?, 1, 1)`,
		[name, name, `/tmp/${name}`],
	);
};

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	await workspace("alpha");
	await workspace("beta");
});
afterEach(() => t.close());

describe("membership reads and writes", () => {
	test("a member can be added and read back", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);

		expect(await getWorkspaceMember("alpha", "u1", db)).toMatchObject({
			workspace: "alpha",
			user_id: "u1",
			role: "owner",
		});
		expect(await isWorkspaceMember("alpha", "u1", db)).toBe(true);
	});

	test("membership does not leak across workspaces", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1" }, db);

		expect(await isWorkspaceMember("beta", "u1", db)).toBe(false);
		expect(await listWorkspacesForUser("u1", db)).toEqual(["alpha"]);
	});

	test("listing is scoped to the account, not to the registry", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1" }, db);
		await addWorkspaceMember({ workspace: "beta", user_id: "u2" }, db);

		expect(await listWorkspacesForUser("u1", db)).toEqual(["alpha"]);
		expect(await listWorkspacesForUser("u2", db)).toEqual(["beta"]);
		// An account with no memberships sees nothing, rather than everything.
		expect(await listWorkspacesForUser("nobody", db)).toEqual([]);
	});

	test("adding the same member twice updates the role instead of duplicating", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "member" }, db);
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);

		expect(await listWorkspaceMembers("alpha", db)).toHaveLength(1);
		expect((await getWorkspaceMember("alpha", "u1", db))?.role).toBe("owner");
	});
});

describe("a workspace is never left without an owner", () => {
	test("removing the last owner is refused", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);

		await expect(removeWorkspaceMember("alpha", "u1", db)).rejects.toThrow(LastOwnerError);
		expect(await isWorkspaceMember("alpha", "u1", db)).toBe(true);
	});

	test("demoting the last owner is refused too", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);

		await expect(setWorkspaceMemberRole("alpha", "u1", "member", db)).rejects.toThrow(
			LastOwnerError,
		);
		expect((await getWorkspaceMember("alpha", "u1", db))?.role).toBe("owner");
	});

	test("an owner may be removed while another remains", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);
		await addWorkspaceMember({ workspace: "alpha", user_id: "u2", role: "owner" }, db);

		await removeWorkspaceMember("alpha", "u1", db);

		expect(await isWorkspaceMember("alpha", "u1", db)).toBe(false);
		expect(await isWorkspaceMember("alpha", "u2", db)).toBe(true);
	});

	test("a plain member may always be removed", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);
		await addWorkspaceMember({ workspace: "alpha", user_id: "u2", role: "member" }, db);

		await removeWorkspaceMember("alpha", "u2", db);

		expect(await isWorkspaceMember("alpha", "u2", db)).toBe(false);
	});

	test("the last owner of one workspace is not the last owner of another", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);
		await addWorkspaceMember({ workspace: "beta", user_id: "u1", role: "owner" }, db);
		await addWorkspaceMember({ workspace: "beta", user_id: "u2", role: "owner" }, db);

		// Removable from beta, which keeps an owner; still refused in alpha.
		await removeWorkspaceMember("beta", "u1", db);
		await expect(removeWorkspaceMember("alpha", "u1", db)).rejects.toThrow(LastOwnerError);
	});
});

describe("membership does not outlive its workspace", () => {
	test("rows naming a workspace outside the registry are pruned", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);
		await addWorkspaceMember({ workspace: "beta", user_id: "u1", role: "owner" }, db);
		await db.run(`DELETE FROM workspaces WHERE name = 'beta'`);

		expect(await pruneMembershipsOutsideRegistry(db)).toBe(1);
		expect(await listWorkspacesForUser("u1", db)).toEqual(["alpha"]);
	});

	test("pruning a consistent registry changes nothing", async () => {
		await addWorkspaceMember({ workspace: "alpha", user_id: "u1", role: "owner" }, db);

		expect(await pruneMembershipsOutsideRegistry(db)).toBe(0);
		expect(await isWorkspaceMember("alpha", "u1", db)).toBe(true);
	});
});
