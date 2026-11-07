import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { listAdminAudit } from "@maleo/db/admin-audit";
import { ensureAuthTables } from "@maleo/auth/config";
import { testApp } from "../middleware/auth-testing.ts";
import { adminRoutes } from "./admin.ts";

// A stand-in render worker that records what reaches its comparison routes.
const seen: { method: string; path: string; auth: string | null; body: unknown }[] = [];
const worker = Bun.serve({
	port: 0,
	async fetch(request) {
		const url = new URL(request.url);
		const body = request.method === "POST" ? await request.json() : null;
		seen.push({
			method: request.method,
			path: url.pathname + url.search,
			auth: request.headers.get("authorization"),
			body,
		});
		if (url.pathname === "/comparisons/report")
			return Response.json({ state: "open", compared: 3 });
		if (url.pathname === "/comparisons/c-1/explain")
			return Response.json({ id: "c-1", explained_by: "x" });
		if (url.pathname === "/comparisons/c-2/explain")
			return Response.json({ error: "not_explainable" }, { status: 409 });
		return Response.json({ error: "not_found" }, { status: 404 });
	},
});
const previous = { url: process.env.MALEO_VIDEO_URL, token: process.env.MALEO_VIDEO_TOKEN };
process.env.MALEO_VIDEO_URL = `http://127.0.0.1:${worker.port}`;
process.env.MALEO_VIDEO_TOKEN = "worker-token";

beforeEach(async () => {
	await closeMaleoDb();
	await ensureAuthTables();
	seen.length = 0;
});
afterAll(() => {
	void worker.stop(true);
	process.env.MALEO_VIDEO_URL = previous.url;
	process.env.MALEO_VIDEO_TOKEN = previous.token;
	if (previous.url === undefined) delete process.env.MALEO_VIDEO_URL;
	if (previous.token === undefined) delete process.env.MALEO_VIDEO_TOKEN;
});

describe("admin render comparisons (p2-export 4.3)", () => {
	test("a non-administrator is refused and nothing reaches the worker", async () => {
		const member = testApp(adminRoutes(), {
			userId: "member",
			email: "m@example.com",
			role: "member",
		});
		expect((await member.request("/render-comparisons/report")).status).toBe(403);
		const explain = await member.request("/render-comparisons/c-1/explain", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ cause: "x", resolution: "remotion-defect" }),
		});
		expect(explain.status).toBe(403);
		expect(seen).toEqual([]);
	});

	test("an administrator reads the report through the worker token", async () => {
		const owner = testApp(adminRoutes());
		const res = await owner.request("/render-comparisons/report");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ state: "open", compared: 3 });
		expect(seen[0]).toMatchObject({
			method: "GET",
			path: "/comparisons/report",
			auth: "Bearer worker-token",
		});
	});

	test("an explanation records the administrator as the explainer and is audited", async () => {
		const owner = testApp(adminRoutes());
		const send = (id: string, body: unknown) =>
			owner.request(`/render-comparisons/${id}/explain`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		const ok = await send("c-1", {
			cause: "Remotion drops a frame",
			resolution: "remotion-defect",
			by: "spoofed",
		});
		expect(ok.status).toBe(200);
		expect(seen[0]?.body).toEqual({
			cause: "Remotion drops a frame",
			resolution: "remotion-defect",
			by: "test-operator",
		});
		expect((await send("c-2", { cause: "x", resolution: "remotion-defect" })).status).toBe(409);
		expect((await send("c-1", { cause: "x", resolution: "guess" })).status).toBe(400);
		const { items } = await listAdminAudit(10, 0);
		const actions = items
			.filter((row) => row.action === "render_comparison.explain")
			.map((row) => row.outcome)
			.sort();
		expect(actions).toEqual(["refused", "success"]);
	});
});
