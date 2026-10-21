import { beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { listAdminAudit } from "@maleo/db/admin-audit";
import { settingNames } from "../lib/admin-config-audit.ts";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { testApp } from "../middleware/auth-testing.ts";
import type { Caller } from "@maleo/auth/session";
import { settingsRoutes } from "./settings.ts";
import { capabilitiesRoutes, providerRoutes, securityRoutes } from "./capabilities.ts";

const owner: Caller = { userId: "owner", email: "owner@example.com", role: "instance_owner" };
const member: Caller = { userId: "member", email: "member@example.com", role: "member" };
const outsider: Caller = { userId: "outsider", email: "out@example.com", role: "member" };

beforeEach(async () => {
	await closeMaleoDb();
	await upsertWorkspace({ name: "alpha", workspace_dir: "/tmp/alpha" });
	await addWorkspaceMember({ workspace: "alpha", user_id: member.userId, role: "owner" });
});

describe("settings authority", () => {
	test("member gets readiness, but no instance settings or global writes", async () => {
		const app = testApp(settingsRoutes(), member);
		expect((await app.request("/channel-manifests")).status).toBe(200);
		expect((await app.request("/global")).status).toBe(403);
		expect((await app.request("/text-provider/key")).status).toBe(403);
		expect((await app.request("/captions-setup", { method: "POST" })).status).toBe(403);
		expect((await app.request("/global", { method: "PUT" })).status).toBe(403);
		expect((await testApp(settingsRoutes(), owner).request("/global")).status).toBe(200);
	});

	test("named workspace reads need membership and writes need workspace ownership", async () => {
		const path = "/workspaces/alpha/writer-style";
		expect((await testApp(settingsRoutes(), member).request(path)).status).toBe(200);
		expect((await testApp(settingsRoutes(), outsider).request(path)).status).toBe(400);
		expect((await testApp(settingsRoutes(), owner).request(path)).status).toBe(400);
		expect(
			(await testApp(settingsRoutes(), outsider).request(path, { method: "PUT" })).status,
		).toBe(400);
	});

	test("provider and security config refuse members", async () => {
		expect(
			(await testApp(capabilitiesRoutes(), member).request("/image/provider", { method: "PUT" }))
				.status,
		).toBe(403);
		expect((await testApp(providerRoutes(), member).request("/openai/config")).status).toBe(403);
		expect((await testApp(securityRoutes(), member).request("/")).status).toBe(403);
	});

	test("every readiness read stays open to a member", async () => {
		const app = testApp(settingsRoutes(), member);
		for (const path of [
			"/image-provider",
			"/tts-provider",
			"/text-provider",
			"/research-status",
			"/captions-status",
			"/channel-manifests",
		]) {
			expect({ path, status: (await app.request(path)).status }).not.toEqual({ path, status: 403 });
		}
		expect((await testApp(capabilitiesRoutes(), member).request("/")).status).toBe(200);
	});

	test("every workspace-scoped route class refuses a non-member and an unowned write", async () => {
		const reads = [
			"secrets",
			"image-policy",
			"video-policy",
			"writer-style",
			"capabilities",
			"active-matrix",
			"behavior/content",
			"decide",
		];
		for (const route of reads) {
			const status = (
				await testApp(settingsRoutes(), outsider).request(`/workspaces/alpha/${route}`)
			).status;
			expect({ route, status }).toEqual({ route, status: 400 });
		}
		const writes: Array<[string, string]> = [
			["PUT", "secrets"],
			["PUT", "image-policy"],
			["DELETE", "video-policy/log"],
			["PUT", "writer-style"],
			["PUT", "behavior/content"],
		];
		for (const [method, route] of writes) {
			const status = (
				await testApp(settingsRoutes(), outsider).request(`/workspaces/alpha/${route}`, { method })
			).status;
			expect({ route, refused: status >= 400 }).toEqual({ route, refused: true });
		}
	});

	test("the config audit names settings, never their values", async () => {
		expect(settingNames({ updates: { OPENAI_API_KEY: "sk-x", OTHER: "y" } })).toEqual([
			"updates.OPENAI_API_KEY",
			"updates.OTHER",
		]);
		const response = await testApp(settingsRoutes(), member).request("/global", {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ updates: { OPENAI_API_KEY: "sk-very-secret" } }),
		});
		expect(response.status).toBe(403);
		const { items } = await listAdminAudit(10, 0);
		expect(items[0]).toMatchObject({
			actor_id: "member",
			outcome: "refused",
			target_id: "/global:updates.OPENAI_API_KEY",
		});
		expect(JSON.stringify(items)).not.toContain("sk-very-secret");
	});

	test("a failed audit write keeps the real status and says the record is missing", async () => {
		await openDb().run("DROP TABLE admin_audit");
		const response = await testApp(settingsRoutes(), member).request("/global", { method: "PUT" });
		expect(response.status).toBe(403);
		expect(response.headers.get("x-maleo-audit")).toBe("failed");
	});
});
