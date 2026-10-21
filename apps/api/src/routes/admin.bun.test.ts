import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { recordAdminAudit } from "@maleo/db/admin-audit";
import { upsertWorkspace } from "@maleo/db/workspaces";
import {
	addWorkspaceMember,
	getWorkspaceMember,
	listWorkspacesForUser,
} from "@maleo/db/workspace-members";
import { ensureAuthTables, getAuth } from "@maleo/auth/config";
import { testApp } from "../middleware/auth-testing.ts";
import { adminRoutes } from "./admin.ts";
import { workspacesRoutes } from "./workspaces.ts";

beforeEach(async () => {
	await closeMaleoDb();
	await ensureAuthTables();
});

const previousSignup = process.env.MALEO_ALLOW_SIGNUP;
const workspaceDirs: string[] = [];
afterEach(() => {
	for (const dir of workspaceDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	if (previousSignup === undefined) delete process.env.MALEO_ALLOW_SIGNUP;
	else process.env.MALEO_ALLOW_SIGNUP = previousSignup;
});

async function createAccount(email: string) {
	const response = await getAuth().handler(
		new Request("http://127.0.0.1/api/auth/sign-up/email", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ email, name: email, password: "correct-horse-battery-staple" }),
		}),
	);
	const id = (
		await openDb().get<{ id: string }>(`SELECT id FROM auth_user WHERE email = ?`, [email])
	)?.id;
	return { response, id: id! };
}

describe("instance admin directories", () => {
	test("owner sees bounded metadata and member sees no directory", async () => {
		const signUp = await getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "owner@example.com",
					name: "Owner",
					password: "correct-horse-battery-staple",
				}),
			}),
		);
		expect(signUp.status).toBe(200);
		const id = (await openDb().get<{ id: string }>(`SELECT id FROM auth_user WHERE email = ?`, [
			"owner@example.com",
		]))!.id;
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		await openDb().run(
			`INSERT INTO content_projects (id, workspace, title, type, status, brief_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			["project-1", "alpha", "Example", "video", "draft", "private brief", 1, 1],
		);
		const owner = testApp(adminRoutes(), {
			userId: id,
			email: "owner@example.com",
			role: "instance_owner",
		});
		const member = testApp(adminRoutes(), {
			userId: "member",
			email: "member@example.com",
			role: "member",
		});
		expect((await member.request("/users")).status).toBe(403);
		expect((await member.request("/workspaces")).status).toBe(403);
		expect((await member.request("/projects")).status).toBe(403);
		const users = await (await owner.request("/users?q=owner&limit=1")).json();
		expect(users.total).toBe(1);
		expect(users.items).toHaveLength(1);
		expect(users.items[0].email).toBe("owner@example.com");
		const projects = await (await owner.request("/projects?q=example")).json();
		expect(projects.total).toBe(1);
		expect(projects.items[0].brief_json).toBeUndefined();
		const detail = await (await owner.request("/projects/project-1")).json();
		expect(detail.item.workspace).toBe("alpha");
		expect(detail.item.brief_json).toBeUndefined();
	});

	test("audit pages omit credentials and raw tokens", async () => {
		await recordAdminAudit({
			actor_id: "owner",
			action: "membership.grant",
			target_type: "user",
			target_id: "member",
			outcome: "success",
			reason: null,
		});
		const app = testApp(adminRoutes());
		const body = await (await app.request("/audit?limit=1")).json();
		expect(body.total).toBe(1);
		expect(body.items).toHaveLength(1);
		expect(JSON.stringify(body)).not.toContain("token");
	});

	test("last active owner is protected; suspension blocks sign-in", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("second@example.com");
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const json = (value: unknown) => ({
			headers: { "content-type": "application/json" },
			body: JSON.stringify(value),
		});
		expect(
			(
				await admin.request(`/users/${first.id}/role`, {
					method: "PATCH",
					...json({ role: "member" }),
				})
			).status,
		).toBe(409);
		expect(
			(
				await admin.request(`/users/${second.id}/role`, {
					method: "PATCH",
					...json({ role: "instance_owner" }),
				})
			).status,
		).toBe(200);
		const suspendResponse = await admin.request(`/users/${second.id}/status`, {
			method: "PATCH",
			...json({ suspended: true }),
		});
		expect(suspendResponse.status).toBe(200);
		expect(
			(
				await openDb().get<{ suspended: boolean }>(`SELECT suspended FROM auth_user WHERE id = ?`, [
					second.id,
				])
			)?.suspended,
		).toBe(true);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_session WHERE "userId" = ?`,
					[second.id],
				)
			)?.c,
		).toBe(0);
		const signIn = await getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "second@example.com",
					password: "correct-horse-battery-staple",
				}),
			}),
		);
		expect(signIn.status).toBe(401);
		expect(
			(
				await admin.request(`/users/${first.id}/status`, {
					method: "PATCH",
					...json({ suspended: true }),
				})
			).status,
		).toBe(409);
		expect(
			(
				await admin.request(`/users/${second.id}/status`, {
					method: "PATCH",
					...json({ suspended: false }),
				})
			).status,
		).toBe(200);
		const restoredSignIn = await getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-in/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email: "second@example.com",
					password: "correct-horse-battery-staple",
				}),
			}),
		);
		expect(restoredSignIn.status).toBe(200);
		expect(
			(await admin.request(`/users/${second.id}/revoke-sessions`, { method: "POST" })).status,
		).toBe(200);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_session WHERE "userId" = ?`,
					[second.id],
				)
			)?.c,
		).toBe(0);
		const audit = await (await admin.request("/audit")).json();
		expect(audit.items.some((r: { outcome: string }) => r.outcome === "refused")).toBe(true);
	});

	test("account deletion refuses last workspace owner and preserves project content", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("second@example.com");
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		await addWorkspaceMember({ workspace: "alpha", user_id: second.id, role: "owner" });
		await openDb().run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
			["project-1", "alpha", "Example", "video", "draft", 1, 1],
		);
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const remove = () =>
			admin.request(`/users/${second.id}`, {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ confirm_email: "second@example.com" }),
			});
		expect((await remove()).status).toBe(409);
		await addWorkspaceMember({ workspace: "alpha", user_id: first.id, role: "owner" });
		expect((await remove()).status).toBe(200);
		expect(await listWorkspacesForUser(second.id)).toEqual([]);
		expect(
			(
				await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM auth_user WHERE id = ?`, [
					second.id,
				])
			)?.c,
		).toBe(0);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_session WHERE "userId" = ?`,
					[second.id],
				)
			)?.c,
		).toBe(0);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_account WHERE "userId" = ?`,
					[second.id],
				)
			)?.c,
		).toBe(0);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM content_projects WHERE id = ?`,
					["project-1"],
				)
			)?.c,
		).toBe(1);
	});

	test("stored registration policy changes sign-up; environment override is reported", async () => {
		const first = await createAccount("first@example.com");
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const write = (policy: string) =>
			admin.request("/authentication", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ policy }),
			});
		expect((await write("open")).status).toBe(200);
		expect((await createAccount("second@example.com")).response.status).toBe(200);
		process.env.MALEO_ALLOW_SIGNUP = "0";
		const policy = await (await admin.request("/authentication")).json();
		expect(policy.policy).toEqual({
			stored: "open",
			effective: "invitation_only",
			source: "environment",
		});
		expect((await write("invitation_only")).status).toBe(409);
		expect((await createAccount("third@example.com")).response.status).toBe(403);
	});

	test("explicit self-grant changes ordinary access; last owner cannot be removed", async () => {
		const first = await createAccount("first@example.com");
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		const caller = { userId: first.id, email: "first@example.com", role: "instance_owner" };
		const admin = testApp(adminRoutes(), caller);
		const ordinary = testApp(workspacesRoutes(), caller);
		expect((await ordinary.request("/alpha")).status).toBe(400);
		const grant = await admin.request(`/workspaces/alpha/members/${first.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role: "owner" }),
		});
		expect(grant.status).toBe(200);
		expect((await ordinary.request("/alpha")).status).toBe(200);
		expect(
			(await admin.request(`/workspaces/alpha/members/${first.id}`, { method: "DELETE" })).status,
		).toBe(409);
		expect((await getWorkspaceMember("alpha", first.id))?.role).toBe("owner");
		const audit = await (await admin.request("/audit")).json();
		expect(audit.items.some((r: { action: string }) => r.action === "membership.grant")).toBe(true);
	});

	test("admin invitation gives token once and audit never stores it", async () => {
		const first = await createAccount("first@example.com");
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const minted = await (
			await admin.request("/workspaces/alpha/invitations", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ role: "member" }),
			})
		).json();
		expect(typeof minted.item.token).toBe("string");
		expect(minted.item.item.role).toBe("member");
		const audit = await (await admin.request("/audit")).json();
		expect(JSON.stringify(audit)).not.toContain(minted.item.token);
		expect(
			(
				await admin.request(`/workspaces/alpha/invitations/${minted.item.item.id}`, {
					method: "DELETE",
				})
			).status,
		).toBe(200);
	});

	test("concurrent demotions preserve one active instance owner", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("second@example.com");
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const request = (id: string) =>
			admin.request(`/users/${id}/role`, {
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ role: "member" }),
			});
		expect(
			(
				await admin.request(`/users/${second.id}/role`, {
					method: "PATCH",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ role: "instance_owner" }),
				})
			).status,
		).toBe(200);
		const statuses = (await Promise.all([request(first.id), request(second.id)]))
			.map((r) => r.status)
			.sort((a, b) => a - b);
		expect(statuses).toEqual([200, 409]);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM auth_user WHERE role = 'instance_owner' AND suspended = false`,
				)
			)?.c,
		).toBe(1);
	});

	test("a suspended account cannot be promoted to instance owner", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("second@example.com");
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const json = (value: unknown) => ({
			headers: { "content-type": "application/json" },
			body: JSON.stringify(value),
		});
		expect(
			(
				await admin.request(`/users/${second.id}/status`, {
					method: "PATCH",
					...json({ suspended: true }),
				})
			).status,
		).toBe(200);
		const promoted = await admin.request(`/users/${second.id}/role`, {
			method: "PATCH",
			...json({ role: "instance_owner" }),
		});
		expect(promoted.status).toBe(409);
		expect(await promoted.json()).toEqual({ error: "suspended_account" });
		expect(
			(await openDb().get<{ role: string }>(`SELECT role FROM auth_user WHERE id = ?`, [second.id]))
				?.role,
		).toBe("member");
	});

	test("workspace impact names affected accounts and final-workspace deletion is refused", async () => {
		const first = await createAccount("first@example.com");
		const dir = mkdtempSync(join(tmpdir(), "maleo-admin-ws-"));
		workspaceDirs.push(dir);
		await upsertWorkspace({ name: "alpha", workspace_dir: dir });
		await addWorkspaceMember({ workspace: "alpha", user_id: first.id, role: "owner" });
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const impact = await (await admin.request("/workspaces/alpha/delete-impact")).json();
		expect(impact.item).toMatchObject({
			affected_accounts: 1,
			losing_access: [{ id: first.id, email: "first@example.com" }],
			final_workspace: true,
		});
		const remove = (confirmed: string[] = [first.id]) =>
			admin.request("/workspaces/alpha", {
				method: "DELETE",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ confirm_name: "alpha", confirm_losing_access: confirmed }),
			});
		expect((await remove()).status).toBe(409);
		const otherDir = mkdtempSync(join(tmpdir(), "maleo-admin-ws-"));
		workspaceDirs.push(otherDir);
		await upsertWorkspace({ name: "beta", workspace_dir: otherDir });
		expect((await remove([])).status).toBe(409);
		// Same count, different account: the confirmation names people, not a number.
		expect((await remove(["someone-else"])).status).toBe(409);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM workspaces WHERE name = 'alpha'`,
				)
			)?.c,
		).toBe(1);
		expect((await remove()).status).toBe(200);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM workspaces WHERE name = 'alpha'`,
				)
			)?.c,
		).toBe(0);
	});

	test("created workspace has the named owner and the admin is not a member", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("second@example.com");
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const create = (body: unknown) =>
			admin.request("/workspaces", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await create({ name: "gamma" })).status).toBe(400);
		expect((await create({ name: "gamma", owner_email: "nobody@example.com" })).status).toBe(404);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM workspaces WHERE name = 'gamma'`,
				)
			)?.c,
		).toBe(0);
		expect((await create({ name: "gamma", owner_email: "Second@Example.com" })).status).toBe(200);
		expect((await getWorkspaceMember("gamma", second.id))?.role).toBe("owner");
		expect(await getWorkspaceMember("gamma", first.id)).toBeNull();
		expect((await create({ name: "gamma", owner_email: "second@example.com" })).status).toBe(409);
	});

	test("user detail flags sole ownership and search matches wildcards literally", async () => {
		const first = await createAccount("first@example.com");
		process.env.MALEO_ALLOW_SIGNUP = "1";
		const second = await createAccount("a_b@example.com");
		await createAccount("axb@example.com");
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		await upsertWorkspace({ name: "beta", workspace_dir: "/tmp/beta" });
		await addWorkspaceMember({ workspace: "alpha", user_id: second.id, role: "owner" });
		await addWorkspaceMember({ workspace: "beta", user_id: second.id, role: "owner" });
		await addWorkspaceMember({ workspace: "beta", user_id: first.id, role: "owner" });
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const detail = await (await admin.request(`/users/${second.id}`)).json();
		expect(detail.item.workspaces).toEqual([
			{ name: "alpha", role: "owner", sole_owner: true },
			{ name: "beta", role: "owner", sole_owner: false },
		]);
		const found = await (await admin.request("/users?q=a_b")).json();
		expect(found.items.map((u: { email: string }) => u.email)).toEqual(["a_b@example.com"]);
		expect((await (await admin.request("/users?q=%25")).json()).total).toBe(0);
	});

	test("admin deletion cancels runs; the ordinary route stays closed to a non-member admin", async () => {
		const first = await createAccount("first@example.com");
		const dir = mkdtempSync(join(tmpdir(), "maleo-admin-ws-"));
		workspaceDirs.push(dir);
		const keep = mkdtempSync(join(tmpdir(), "maleo-admin-ws-"));
		workspaceDirs.push(keep);
		await upsertWorkspace({ name: "alpha", workspace_dir: dir });
		await upsertWorkspace({ name: "beta", workspace_dir: keep });
		const now = Date.now();
		await openDb().run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at) VALUES ('p1', 'alpha', 'Work', 'video', 'draft', ?, ?)`,
			[now, now],
		);
		await openDb().run(
			`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at) VALUES ('wr1', 'p1', 'video', 'running', ?, ?)`,
			[now, now],
		);
		const caller = { userId: first.id, email: "first@example.com", role: "instance_owner" };
		const ordinary = testApp(workspacesRoutes(), caller);
		expect((await ordinary.request("/alpha", { method: "DELETE" })).status).not.toBe(200);
		const admin = testApp(adminRoutes(), caller);
		expect(
			(await (await admin.request("/workspaces/alpha/delete-impact")).json()).item.in_flight_runs,
		).toBe(1);
		const removed = await admin.request("/workspaces/alpha", {
			method: "DELETE",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ confirm_name: "alpha", confirm_losing_access: [] }),
		});
		expect(removed.status).toBe(200);
		expect((await removed.json()).item.runsCancelled).toBe(1);
		expect(
			(await openDb().get<{ c: number }>(`SELECT count(*) AS c FROM workflow_run WHERE id = 'wr1'`))
				?.c,
		).toBe(0);
		expect(
			(
				await openDb().get<{ c: number }>(
					`SELECT count(*) AS c FROM workspaces WHERE name = 'beta'`,
				)
			)?.c,
		).toBe(1);
	});

	test("a refused role change is audited as a role change", async () => {
		const first = await createAccount("first@example.com");
		await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
		await addWorkspaceMember({ workspace: "alpha", user_id: first.id, role: "owner" });
		const admin = testApp(adminRoutes(), {
			userId: first.id,
			email: "first@example.com",
			role: "instance_owner",
		});
		const demote = await admin.request(`/workspaces/alpha/members/${first.id}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ role: "member" }),
		});
		expect(demote.status).toBe(409);
		const audit = await (await admin.request("/audit")).json();
		expect(audit.items[0]).toMatchObject({
			action: "membership.role",
			outcome: "refused",
			reason: "last_workspace_owner",
		});
	});
});
