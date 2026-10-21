/* adopt-mastra-internal-agent 1.4 and 2.11: the project's tools over MCP.
 *
 * Driven by the MCP SDK's own client over streamable HTTP, against the mounted
 * route, with keys issued by the auth library — the same path Codex CLI or Claude
 * Code takes. Delegated runs execute on the in-process host over the real agent
 * with a scripted model. */
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { putMedia } from "@maleo/storage";
import { createContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { upsertWorkspace } from "@maleo/db/workspaces";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { ensureAuthTables, getAuth, MODEL_NAMES } from "@maleo/auth/config";
import { setRegistrationPolicy } from "@maleo/auth/registration-policy";
import { buildAgentJob } from "../../../modules/agents/core/run-bracket.ts";
import { persist } from "../../../modules/agents/core/persistence.ts";
import { getLatestActiveJobForProject } from "../../../modules/agents/core/session-store.ts";
import { grantCredits } from "../../../lib/credit-service.ts";
import { setMediaClientForTests } from "../../../lib/image-gen-client.ts";
import { setStyleBibleGeneratorForTests } from "../../../lib/content-generator.ts";
import {
	draftShortPlan,
	installStoryProviders,
	removeStoryProviders,
} from "../../../modules/agents/core/runtime/__tests__/support/story-fixture.ts";
import { TOOLS } from "../../../modules/agents/core/registry.ts";
import { RUNTIME_TOOL_NAMES } from "../../../modules/agents/core/runtime/tools/registry-tools.ts";
import { setResearchProviderForTests } from "../../../modules/agents/core/services/research.ts";
import {
	AGENT_WORKFLOWS,
	createInternalAgent,
} from "../../../modules/agents/core/runtime/agent.ts";
import {
	answer,
	callTool,
	scriptedModel,
	type turn,
} from "../../../modules/agents/core/runtime/__tests__/support/scripted-model.ts";
import { inProcessHost, type RunHost } from "../../../modules/agents/core/service.ts";
import { MCP_PATH, MCP_PUBLIC_PATH, mcpRoutes } from "../../mount.ts";

let host: RunHost | undefined;
/** The agent a delegated run executes on, scripted per test. */
function agentWith(turns: Array<ReturnType<typeof turn>>): void {
	host = inProcessHost(
		new Mastra({
			agents: { maleo: createInternalAgent(scriptedModel(turns)) },
			workflows: AGENT_WORKFLOWS,
			storage: new InMemoryStore(),
			logger: false,
		}).getAgent("maleo"),
	);
}

const app = mcpRoutes({ host: async () => host! });
const ORIGIN = "http://maleo.test";

let ownKey = "";
let strangerKey = "";
let carouselId = "";
let threadId = "";
let foreignCarouselId = "";
let videoId = "";
let ownUserId = "";

/** A video project with a saved one-scene timeline, saved the way a run saves one,
 *  so reads and edits go through the real document. */
async function videoProject(title: string): Promise<string> {
	const projectId = (await createContentProject({ title, workspace: "mcp-own", type: "video" }))
		.project.id;
	const video = await buildAgentJob({
		projectId,
		instruction: "",
		contentType: "video",
		scenes: [
			{
				name: "Morning feed",
				durationSec: 4,
				shot: "Close-up",
				move: "Static",
				transition: "fade",
				visual: "a jar",
				voiceover: "Feed it daily",
			},
		],
	});
	await persist({ ...video, status: "done" });
	return projectId;
}

async function user(email: string): Promise<string> {
	const created = await getAuth().api.signUpEmail({
		body: { email, password: "correct-horse-battery", name: email },
	});
	return created.user.id;
}

async function keyFor(userId: string): Promise<string> {
	// Protocol tests share one key and can exceed the production per-minute quota.
	return (await getAuth().api.createApiKey({ body: { userId, name: "cli", rateLimitMax: 1000 } }))
		.key;
}

async function connect(key?: string, path = MCP_PATH): Promise<Client> {
	const client = new Client({ name: "test-cli", version: "1" });
	const transport = new StreamableHTTPClientTransport(new URL(`${ORIGIN}${path}`), {
		fetch: async (input, init) => app.fetch(new Request(input, init)),
		requestInit: key ? { headers: { authorization: `Bearer ${key}` } } : undefined,
	});
	await client.connect(transport);
	return client;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) =>
	(result.content as Array<{ text: string }>)[0]?.text ?? "";

beforeAll(async () => {
	await ensureAuthTables();
	await setRegistrationPolicy("open");
	// The first account claims the deployment; the two under test come after it.
	await user("owner@example.com");
	const own = await user("own@example.com");
	ownUserId = own;
	const stranger = await user("stranger@example.com");
	for (const name of ["mcp-own", "mcp-foreign"])
		await upsertWorkspace({ name, display_name: name, workspace_dir: `/tmp/${name}` });
	await addWorkspaceMember({ workspace: "mcp-own", user_id: own, role: "owner" });
	await addWorkspaceMember({ workspace: "mcp-foreign", user_id: stranger, role: "owner" });

	carouselId = (
		await createContentProject({ title: "Starter tips", workspace: "mcp-own", type: "image" })
	).project.id;
	await addContentStoryboard({
		project_id: carouselId,
		storyboard_json: { slides: [{ caption: "Feed it daily", visual: "a jar" }] },
	});
	threadId = (
		await createContentProject({ title: "Starter thread", workspace: "mcp-own", type: "text" })
	).project.id;
	await addContentStoryboard({
		project_id: threadId,
		storyboard_json: { posts: [{ body: "Keep it warm." }] },
	});
	foreignCarouselId = (
		await createContentProject({ title: "Not yours", workspace: "mcp-foreign", type: "image" })
	).project.id;
	videoId = await videoProject("Starter video");

	ownKey = await keyFor(own);
	strangerKey = await keyFor(stranger);
});

afterEach(() => {
	setResearchProviderForTests(null);
	removeStoryProviders();
});
afterAll(async () => {
	await closeMaleoDb();
});

/** Calls a tool whose result is JSON. */
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
	const result = await client.callTool({ name, arguments: args });
	if (result.isError) throw new Error(text(result));
	return JSON.parse(text(result)) as T;
}

interface RunView {
	status: string;
	pendingAction: { actionId: string; question: string; options: Array<{ value: string }> } | null;
	result: string | null;
}

async function until(client: Client, runId: string, status: string): Promise<RunView> {
	for (let i = 0; i < 400; i++) {
		const run = await call<RunView>(client, "get_run", { runId });
		if (run.status === status) return run;
		await Bun.sleep(10);
	}
	throw new Error(`run never reached ${status}`);
}

describe("serving the project's tools over MCP", () => {
	test("Maleo keys authenticate while other prefixes are rejected", async () => {
		expect(ownKey).toStartWith("maleo_");
		const retired = await getAuth().api.createApiKey({
			body: { userId: ownUserId, name: "retired-prefix", prefix: "retired_" },
		});
		await expect(connect(retired.key)).rejects.toThrow();
		await openDb().run("DELETE FROM auth_apikey WHERE id = ?", [retired.id]);
		expect((await getAuth().api.verifyApiKey({ body: { key: retired.key } })).valid).toBe(false);
	});
	test("the served tools are the services, the registry's reads, and its direct edits; never ask_user, finish or a workflow", async () => {
		const client = await connect(ownKey);
		const { tools } = await client.listTools();
		const names = tools.map((tool) => tool.name);
		const reads = ["read_skill", "read_web_page", "research_topic", "search_web", "view_timeline"];
		const services = [
			"answer_action",
			"cancel_run",
			"get_project",
			"get_run",
			"list_projects",
			"run_agent",
		];
		const edits = TOOLS.filter(
			(tool) =>
				(tool.kind === "mutate" || tool.kind === "generate") && !RUNTIME_TOOL_NAMES.has(tool.name),
		).map((tool) => tool.name);
		expect(names.sort()).toEqual([...services, ...reads, ...edits].sort());
		for (const name of ["add_scene", "update_scene", "generate_frame"])
			expect(names).toContain(name);
		for (const name of [
			"ask_user",
			"finish",
			"plan_story",
			"generate_story_assets",
			"view_carousel",
			"add_slide",
			"generate_slide_image",
			"view_thread",
			"add_post",
		])
			expect(names).not.toContain(name);
		// Every registry tool takes the project it reads or changes.
		for (const tool of tools.filter(
			(tool) =>
				!services.includes(tool.name) &&
				!["search_web", "research_topic", "read_web_page"].includes(tool.name),
		))
			expect(tool.inputSchema.required).toContain("projectId");
		expect(
			tools
				.filter((tool) => !tool.annotations?.readOnlyHint)
				.map((tool) => tool.name)
				.sort(),
		).toEqual(["answer_action", "cancel_run", "run_agent", ...edits].sort());
		await client.close();
	});

	test("the endpoint the web origin proxies, /api/mcp, serves the same tools to the same key", async () => {
		const client = await connect(ownKey, MCP_PUBLIC_PATH);
		expect((await client.listTools()).tools.length).toBe(
			(await (await connect(ownKey)).listTools()).tools.length,
		);
		await client.close();
		await expect(connect(undefined, MCP_PUBLIC_PATH)).rejects.toThrow();
	});

	test("a client sees only its own projects; a retired image or text project offers no tools", async () => {
		const client = await connect(ownKey);
		const projects = await call<Array<{ id: string; type: string }>>(client, "list_projects", {});
		expect(projects.map((project) => project.id).sort()).toEqual(
			[carouselId, threadId, videoId].sort(),
		);
		expect(
			await call<{ tools: string[]; edits: string[] }>(client, "get_project", {
				projectId: carouselId,
			}),
		).toMatchObject({ tools: [], edits: [] });
		expect(
			await call<{ tools: string[]; edits: string[] }>(client, "get_project", {
				projectId: threadId,
			}),
		).toMatchObject({ tools: [], edits: [] });
		expect(
			(await call<{ tools: string[] }>(client, "get_project", { projectId: videoId })).tools,
		).toEqual(["view_timeline", "read_skill"]);
		expect(
			text(
				await client.callTool({ name: "get_project", arguments: { projectId: foreignCarouselId } }),
			),
		).toBe("project not found");
		await client.close();
	});

	test("a read is traced as the key's owner, and research changes no project state", async () => {
		setResearchProviderForTests({
			search: async () => [],
			readPage: async (url) => ({
				title: "Sourdough",
				text: "A sourdough starter is a fermented mixture of flour and water that hosts wild yeast and lactic acid bacteria. ".repeat(
					3,
				),
				finalUrl: url,
			}),
		});
		const client = await connect(ownKey);
		expect(
			text(
				await client.callTool({
					name: "read_web_page",
					arguments: { projectId: videoId, url: "https://en.wikipedia.org/wiki/Sourdough" },
				}),
			),
		).toContain("Read en.wikipedia.org");
		await client.close();
		const db = openDb();
		expect(await db.all("SELECT id FROM project_citation WHERE project_id = ?", [videoId])).toEqual(
			[],
		);
		const traced = await db.all<{ actor_type: string; actor_id: string }>(
			"SELECT actor_type, actor_id FROM content_project_events WHERE project_id = ? AND kind = 'agent.tool_call' AND summary LIKE 'read_web_page%'",
			[videoId],
		);
		expect(traced).toEqual([{ actor_type: "operator", actor_id: `mcp:${ownUserId}` }]);
	});

	test("a video project's saved timeline reads through the agent's own tool, and a read leaves no run behind", async () => {
		const client = await connect(ownKey);
		expect(
			text(await client.callTool({ name: "view_timeline", arguments: { projectId: videoId } })),
		).toContain("Morning feed");
		expect(await getLatestActiveJobForProject(videoId)).toBeUndefined();
		await client.close();
	});

	test("a retired image or text project refuses reads and research, and no run is left behind", async () => {
		const client = await connect(ownKey);
		expect(
			text(await client.callTool({ name: "view_timeline", arguments: { projectId: carouselId } })),
		).toBe("view_timeline does not apply to a image project");
		const research = await client.callTool({
			name: "read_web_page",
			arguments: { projectId: threadId, url: "https://en.wikipedia.org/wiki/Sourdough" },
		});
		expect(research.isError).toBe(true);
		expect(text(research)).toBe("AI is not available for text projects");
		expect(await getLatestActiveJobForProject(threadId)).toBeUndefined();
		await client.close();
	});

	test("a request without a key, or with an unknown one, is refused before any tool runs", async () => {
		await expect(connect()).rejects.toThrow();
		await expect(connect("maleo_not-a-real-key")).rejects.toThrow();
		const raw = await app.fetch(
			new Request(`${ORIGIN}${MCP_PATH}`, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					accept: "application/json, text/event-stream",
				},
				body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
			}),
		);
		expect(raw.status).toBe(401);
	});

	test("a project in a workspace the key's owner is not a member of reads as not found", async () => {
		const client = await connect(ownKey);
		const result = await client.callTool({
			name: "view_timeline",
			arguments: { projectId: foreignCarouselId },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toBe("project not found");
		// The same answer as a project that does not exist, so a key cannot probe for ids.
		expect(
			text(
				await client.callTool({
					name: "view_timeline",
					arguments: { projectId: "no-such-project" },
				}),
			),
		).toBe("project not found");
		await client.close();

		const stranger = await connect(strangerKey);
		expect(
			text(await stranger.callTool({ name: "view_timeline", arguments: { projectId: videoId } })),
		).toBe("project not found");
		await stranger.close();
	});

	test("a suspended owner's key stops working with the account", async () => {
		const suspended = await user("suspended@example.com");
		const key = await keyFor(suspended);
		await (await connect(key)).close();
		await openDb().run(`UPDATE ${MODEL_NAMES.user} SET suspended = true WHERE id = ?`, [suspended]);
		await expect(connect(key)).rejects.toThrow();
	});

	test("a tool is refused for a project of another content type", async () => {
		const client = await connect(ownKey);
		const result = await client.callTool({
			name: "view_timeline",
			arguments: { projectId: threadId },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toBe("view_timeline does not apply to a text project");
		await client.close();
	});
});

describe("changing a project through the agent", () => {
	test("run_agent starts a run in the project chat; it waits for approval, answer_action resumes it once, and it settles into the editor", async () => {
		installStoryProviders();
		const projectId = (
			await createContentProject({ title: "Fresh story", workspace: "mcp-own", type: "video" })
		).project.id;
		// A drafted, unapproved plan saved on the project, so generation parks at its gate.
		const planned = await buildAgentJob({
			projectId,
			instruction: "",
			brief: "a lighthouse keeper's last night",
			contentType: "video",
		});
		draftShortPlan(planned);
		await persist({ ...planned, status: "done" });
		agentWith([
			callTool("workflow-generate_story_assets", { inputData: {} }),
			answer("Generated the story."),
		]);
		const client = await connect(ownKey);

		const { runId } = await call<{ runId: string }>(client, "run_agent", {
			projectId,
			instruction: "generate the story",
		});
		expect((await getLatestActiveJobForProject(projectId))?.id).toBe(runId);
		const parked = await until(client, runId, "awaiting_input");
		expect(parked.pendingAction?.options.map((option) => option.value)).toContain("approve");
		expect(
			text(
				await client.callTool({
					name: "run_agent",
					arguments: { projectId, instruction: "again" },
				}),
			),
		).toContain("already has an active run");

		expect(
			await call<{ outcome: string }>(client, "answer_action", {
				runId,
				actionId: "an-older-action",
				answer: "approve",
			}),
		).toMatchObject({ outcome: "stale" });
		expect(
			await call<{ outcome: string }>(client, "answer_action", {
				runId,
				actionId: parked.pendingAction!.actionId,
				answer: "approve",
			}),
		).toMatchObject({ outcome: "resumed" });
		const done = await until(client, runId, "done");
		expect(done.result).toBe("Generated the story.");
		expect(
			await call<{ outcome: string }>(client, "answer_action", {
				runId,
				actionId: parked.pendingAction!.actionId,
				answer: "approve",
			}),
		).toMatchObject({ outcome: "stale" });

		// Settled into the editor: the project's saved timeline carries the generated frames.
		const { getContentProject } = await import("@maleo/db/project-detail");
		expect(
			JSON.stringify((await getContentProject(projectId))?.storyboards[0]?.storyboard_json),
		).toContain("/uploads/frame-");
		await client.close();
	});

	test("run_agent refuses a retired image or text project before any run starts", async () => {
		const client = await connect(ownKey);
		for (const projectId of [carouselId, threadId]) {
			const result = await client.callTool({
				name: "run_agent",
				arguments: { projectId, instruction: "add a slide" },
			});
			expect(result.isError).toBe(true);
			expect(text(result)).toMatch(/^AI is not available for (image|text) projects$/);
			expect(await getLatestActiveJobForProject(projectId)).toBeUndefined();
		}
		await client.close();
	});

	test("an oversized instruction is refused before any run starts", async () => {
		const client = await connect(ownKey);
		const result = await client.callTool({
			name: "run_agent",
			arguments: { projectId: videoId, instruction: "x".repeat(8_001) },
		});
		expect(result.isError).toBe(true);
		expect(text(result)).toBe("instruction: at most 8000 characters");
		expect(await getLatestActiveJobForProject(videoId)).toBeUndefined();
		await client.close();
	});

	test("another workspace's run cannot be read, answered or stopped", async () => {
		const projectId = (
			await createContentProject({ title: "Asking story", workspace: "mcp-own", type: "video" })
		).project.id;
		agentWith([callTool("ask_user", { question: "Warm or dry?" }), answer("Done.")]);
		const client = await connect(ownKey);
		const { runId } = await call<{ runId: string }>(client, "run_agent", {
			projectId,
			instruction: "tune the tone",
		});
		await until(client, runId, "awaiting_input");

		const stranger = await connect(strangerKey);
		for (const name of ["get_run", "cancel_run"])
			expect(text(await stranger.callTool({ name, arguments: { runId } }))).toBe("run not found");
		expect(
			text(
				await stranger.callTool({
					name: "answer_action",
					arguments: { runId, actionId: "x", answer: "warm" },
				}),
			),
		).toBe("run not found");
		await stranger.close();

		expect(await call<{ status: string }>(client, "cancel_run", { runId })).toMatchObject({
			status: "error",
		});
		expect((await call<RunView>(client, "get_run", { runId })).status).toBe("error");
		await client.close();
	});
});

describe("changing a project with a direct edit", () => {
	const video = videoProject;
	const saved = async (projectId: string) => {
		const { getContentProject } = await import("@maleo/db/project-detail");
		return JSON.stringify((await getContentProject(projectId))?.storyboards[0]?.storyboard_json);
	};

	test("a direct edit runs as one tool call in the project chat and settles into the saved timeline", async () => {
		const projectId = await video("Direct add");
		agentWith([]);
		const client = await connect(ownKey);
		const done = await call<RunView & { runId: string }>(client, "add_scene", {
			projectId,
			name: "Keep it warm",
			visual: "a warm jar",
			voiceover: "Keep it somewhere warm",
		});
		expect(done.status).toBe("done");
		expect(await saved(projectId)).toContain("Keep it warm");
		expect(await getLatestActiveJobForProject(projectId)).toBeUndefined();
		await client.close();
	});

	test("an edit of existing work parks for approval, and answer_action applies it once", async () => {
		const projectId = await video("Direct update");
		agentWith([]);
		const client = await connect(ownKey);
		const parked = await call<RunView & { runId: string }>(client, "update_scene", {
			projectId,
			index: 0,
			name: "Feed it twice",
		});
		expect(parked.status).toBe("awaiting_input");
		expect(await saved(projectId)).not.toContain("Feed it twice");
		expect(
			text(
				await client.callTool({
					name: "add_scene",
					arguments: { projectId, name: "x", visual: "y", voiceover: "z" },
				}),
			),
		).toContain("already has an active run");

		expect(
			await call<{ outcome: string }>(client, "answer_action", {
				runId: parked.runId,
				actionId: parked.pendingAction!.actionId,
				answer: "approve",
			}),
		).toMatchObject({ outcome: "resumed" });
		await until(client, parked.runId, "done");
		expect(await saved(projectId)).toContain("Feed it twice");
		await client.close();
	});

	test("an edit is refused before any change for another workspace's project, a retired content type, or invalid args", async () => {
		const stranger = await connect(strangerKey);
		expect(
			text(
				await stranger.callTool({
					name: "add_scene",
					arguments: { projectId: videoId, name: "x", visual: "y", voiceover: "z" },
				}),
			),
		).toBe("project not found");
		await stranger.close();
		const client = await connect(ownKey);
		expect(
			text(
				await client.callTool({
					name: "add_scene",
					arguments: { projectId: carouselId, name: "x", visual: "y", voiceover: "z" },
				}),
			),
		).toBe("add_scene does not apply to a image project");
		const invalid = await client.callTool({
			name: "update_scene",
			arguments: { projectId: videoId, index: "first" },
		});
		expect(invalid.isError).toBe(true);
		expect(text(invalid)).toStartWith("invalid args for update_scene");
		for (const projectId of [carouselId, videoId])
			expect(await getLatestActiveJobForProject(projectId)).toBeUndefined();
		expect(await saved(carouselId)).not.toContain('"x"');
		await client.close();
	});

	test("a direct generate_frame is charged once and traced as the key's owner", async () => {
		const projectId = await video("Direct generate");
		setStyleBibleGeneratorForTests(async () => "test style bible");
		agentWith([]);
		const prior = {
			enforce: process.env.MALEO_CREDITS_ENFORCE,
			backend: process.env.MALEO_MEDIA_STORAGE_BACKEND,
			worker: process.env.MALEO_GEN_WORKER_URL,
		};
		process.env.MALEO_CREDITS_ENFORCE = "1";
		process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
		process.env.MALEO_GEN_WORKER_URL = "http://media-worker.test";
		await grantCredits({
			scopeType: "workspace",
			scopeId: "mcp-own",
			credits: 1000,
			idempotencyKey: `grant-${projectId}`,
		});
		const submitted: string[] = [];
		setMediaClientForTests({
			async submitImage(input) {
				submitted.push(input.prompt);
				return `job-${submitted.length}`;
			},
			async submitVideo() {
				throw new Error("unused");
			},
			async videoReadiness() {
				return {};
			},
			async submitTts() {
				throw new Error("unused");
			},
			async poll(id) {
				const put = await putMedia({
					workspace: "mcp-own",
					kind: "image",
					body: new Blob(["png"]),
					contentType: "image/png",
				});
				return {
					id,
					kind: "image",
					status: "done",
					imageUrl: null,
					audioUrl: null,
					stored: { key: put.key, hash: put.hash, size: put.size, contentType: put.contentType },
					fromCache: false,
					providerId: "test",
					providerSource: "default",
					model: null,
					cost: null,
					latencyMs: null,
					error: null,
				};
			},
			async download() {
				throw new Error("unused");
			},
			fileUrl: (path) => path,
		});
		const db = openDb();
		const captures = async () =>
			(await db.all("SELECT id FROM credit_transactions WHERE type = 'capture'")).length;
		const before = await captures();
		try {
			const client = await connect(ownKey);
			const done = await call<RunView>(client, "generate_frame", { projectId, index: 0 });
			expect(done.status).toBe("done");
			await client.close();
		} finally {
			setMediaClientForTests(undefined);
			for (const [name, value] of [
				["MALEO_CREDITS_ENFORCE", prior.enforce],
				["MALEO_MEDIA_STORAGE_BACKEND", prior.backend],
				["MALEO_GEN_WORKER_URL", prior.worker],
			] as const) {
				if (value === undefined) delete process.env[name];
				else process.env[name] = value;
			}
		}
		/* The scene's frame is submitted once. A project's first frame also renders a
		 * style reference board, which is its own image job; each job is captured once. */
		expect(submitted.filter((prompt) => prompt === "a jar")).toHaveLength(1);
		expect((await captures()) - before).toBe(submitted.length);
		const traced = await db.all<{ actor_type: string; actor_id: string }>(
			"SELECT actor_type, actor_id FROM content_project_events WHERE project_id = ? AND kind = 'agent.tool_call'",
			[projectId],
		);
		// The style lock records its own calls; every one is the key's owner's.
		expect(traced.length).toBeGreaterThan(0);
		expect(new Set(traced.map((row) => `${row.actor_type}:${row.actor_id}`))).toEqual(
			new Set([`operator:mcp:${ownUserId}`]),
		);
	});
});
