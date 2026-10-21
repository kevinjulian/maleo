import { expect, spyOn, test } from "bun:test";
import { Hono } from "hono";
import { agentTemplateCatalogSchema } from "@maleo/shared";
import { ensureAuthTables, getAuth } from "@maleo/auth/config";
import { openDb } from "@maleo/db/connection";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { setTextRunnerForTests } from "../lib/text-runner.ts";
import { admit } from "../middleware/perimeter.ts";
import { adminRoutes } from "./admin.ts";
import { AGENT_WORKFLOWS } from "../modules/agents/core/runtime/workflows/index.ts";
import { authStateRoutes } from "./auth-state.ts";

test("mounted HTTP catalog requires active owner and reads definitions without private state or AI", async () => {
	await ensureAuthTables();
	const oldSignup = process.env.MALEO_ALLOW_SIGNUP;
	process.env.MALEO_ALLOW_SIGNUP = "1";
	const signup = async (email: string) => {
		const response = await getAuth().handler(
			new Request("http://127.0.0.1/api/auth/sign-up/email", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					email,
					name: "Catalog test",
					password: "correct-horse-battery-staple",
				}),
			}),
		);
		expect(response.status).toBe(200);
		const cookie = response.headers
			.getSetCookie()
			.map((value) => value.split(";")[0])
			.join("; ");
		const row = await openDb().get<{ id: string }>("SELECT id FROM auth_user WHERE email = ?", [
			email,
		]);
		return { cookie, id: row!.id };
	};
	const owner = await signup("catalog-owner@example.com");
	const member = await signup("catalog-member@example.com");
	await openDb().run("UPDATE auth_user SET role = ? WHERE id = ?", ["instance_owner", owner.id]);
	await openDb().run("UPDATE auth_user SET role = ? WHERE id = ?", ["member", member.id]);
	const sentinel = "PRIVATE-CATALOG-SENTINEL";
	await upsertWorkspace({ name: "catalog-private", workspace_dir: "/tmp/catalog-private" });
	await openDb().run(
		"INSERT INTO content_projects (id, workspace, title, type, status, brief_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		[
			"catalog-private-project",
			"catalog-private",
			sentinel,
			"video",
			"draft",
			JSON.stringify({
				brief: sentinel,
				material: sentinel,
				reference: `https://private.invalid/${sentinel}`,
				mcp: { url: sentinel },
			}),
			1,
			1,
		],
	);
	const oldKey = process.env.OPENAI_API_KEY;
	process.env.OPENAI_API_KEY = `${sentinel}-credential`;
	let modelCalls = 0;
	setTextRunnerForTests(async () => {
		modelCalls++;
		throw new Error("Catalog must not invoke text runner");
	});
	const spawn = spyOn(Bun, "spawn");
	const spawnSync = spyOn(Bun, "spawnSync");
	const writes = spyOn(openDb(), "run").mockImplementation(async () => {
		throw new Error("Catalog must not write runtime state");
	});
	const api = new Hono()
		.route("/api/admin", adminRoutes())
		.route("/api/auth-state", authStateRoutes());
	api.all("/api/auth/*", (c) => getAuth().handler(c.req.raw));
	const server = Bun.serve({
		port: 0,
		hostname: "127.0.0.1",
		async fetch(request) {
			const admission = await admit(request, new URL(request.url).pathname);
			return admission.refusal ?? api.fetch(request, { caller: admission.caller });
		},
	});
	const originalFetch = globalThis.fetch;
	let externalCalls = 0;
	globalThis.fetch = Object.assign(
		async (input: RequestInfo | URL, init?: RequestInit) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== server.url.origin) {
				externalCalls++;
				throw new Error("Unexpected upstream request during catalog read");
			}
			return originalFetch(input, init);
		},
		{ preconnect: originalFetch.preconnect },
	);
	const read = (cookie?: string) =>
		fetch(new URL("/api/admin/agent-templates", server.url), { headers: cookie ? { cookie } : {} });
	try {
		expect((await read()).status).toBe(401);
		expect((await read(member.cookie)).status).toBe(403);
		const before = await openDb().get<{ count: number }>(
			"SELECT count(*) AS count FROM workspace_members WHERE user_id = ?",
			[owner.id],
		);
		for (let count = 0; count < 2; count++) {
			const response = await read(owner.cookie);
			expect(response.status).toBe(200);
			const text = await response.text();
			const catalog = agentTemplateCatalogSchema.parse(JSON.parse(text));
			expect(catalog.schemaVersion).toBe(2);
			expect(
				catalog.definitions.find((entry) => entry.id === "prompt:content:storyFramePrompt")
					?.instructions?.[0],
			).toContain("{{brief");
			expect(catalog.definitions.filter((item) => item.kind === "workflow")).toHaveLength(4);
			expect(text).not.toContain(owner.cookie);
			expect(text).not.toContain(owner.id);
			expect(text).not.toContain(sentinel);
		}
		expect(modelCalls).toBe(0);
		expect(spawn).not.toHaveBeenCalled();
		expect(spawnSync).not.toHaveBeenCalled();
		expect(writes).not.toHaveBeenCalled();
		expect(
			await openDb().get<{ count: number }>(
				"SELECT count(*) AS count FROM workspace_members WHERE user_id = ?",
				[owner.id],
			),
		).toEqual(before);
		const workflow = AGENT_WORKFLOWS.generate_story_assets;
		const metadata = workflow.metadata!.template;
		try {
			workflow.metadata!.template = undefined;
			expect((await read(owner.cookie)).status).toBe(500);
		} finally {
			workflow.metadata!.template = metadata;
		}
		if (process.env.MALEO_TEST_TEMPLATE_BROWSER === "1") {
			// Browser proof is opt-in because package unit tests do not own a fixed web port.
			globalThis.fetch = originalFetch;
			const proof = Bun.spawn(["bun", "scripts/inspect-template-catalog.ts"], {
				cwd: new URL("../../../web/", import.meta.url).pathname,
				env: {
					...process.env,
					MALEO_TEMPLATE_TEST_API: server.url.origin,
					MALEO_TEMPLATE_TEST_COOKIE: owner.cookie,
					MALEO_TEMPLATE_TEST_MEMBER_COOKIE: member.cookie,
				},
				stdout: "inherit",
				stderr: "inherit",
			});
			expect(await proof.exited).toBe(0);
		}
		expect(modelCalls).toBe(0);
		expect(writes).not.toHaveBeenCalled();
		writes.mockRestore();
		await openDb().run("UPDATE auth_user SET suspended = true WHERE id = ?", [owner.id]);
		expect((await read(owner.cookie)).status).toBe(401);
		await openDb().run("UPDATE auth_user SET suspended = false WHERE id = ?", [owner.id]);
		await openDb().run('DELETE FROM auth_session WHERE "userId" = ?', [owner.id]);
		expect((await read(owner.cookie)).status).toBe(401);
		expect(externalCalls).toBe(0);
	} finally {
		spawn.mockRestore();
		spawnSync.mockRestore();
		writes.mockRestore();
		setTextRunnerForTests(null);
		if (oldKey === undefined) delete process.env.OPENAI_API_KEY;
		else process.env.OPENAI_API_KEY = oldKey;
		globalThis.fetch = originalFetch;
		void server.stop(true);
		if (oldSignup === undefined) delete process.env.MALEO_ALLOW_SIGNUP;
		else process.env.MALEO_ALLOW_SIGNUP = oldSignup;
	}
}, 60_000);
