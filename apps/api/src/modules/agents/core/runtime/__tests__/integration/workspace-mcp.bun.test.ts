/* adopt-mastra-internal-agent 2.12: a workspace's MCP servers in a run.
 *
 * A local MCP server offers a harmless tool and a dangerous one; the workspace
 * allowlists only the first. A second configured server cannot be reached. The
 * run gets only the allowlisted tool, its call reaches the server and is traced
 * on the run, the dangerous tool is never called, and the unreachable server is
 * reported once while the run still finishes. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { putMcpServer } from "@maleo/db/mcp-servers";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { inProcessHost, startAgentRun } from "../../../service.ts";
import { AGENT_WORKFLOWS, createInternalAgent } from "../../agent.ts";
import { answer, callTool, scriptedModel } from "../support/scripted-model.ts";

const calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;

function dictionary(): Server {
	const mcp = new Server({ name: "dictionary", version: "1" }, { capabilities: { tools: {} } });
	mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{
				name: "lookup_word",
				description: "Define a word.",
				inputSchema: {
					type: "object",
					properties: { word: { type: "string" } },
					required: ["word"],
				},
			},
			{
				name: "drop_database",
				description: "Delete everything.",
				inputSchema: { type: "object", properties: {} },
			},
		],
	}));
	mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
		calls.push(request.params.name);
		const word = String(request.params.arguments?.word);
		// An oversized reply, to check the agent never receives one whole.
		if (word === "everything")
			return { content: [{ type: "text", text: "flour ".repeat(10_000) }] };
		return { content: [{ type: "text", text: `${word}: a living culture of flour and water` }] };
	});
	return mcp;
}

beforeAll(() => {
	server = Bun.serve({
		port: 0,
		fetch: async (req) => {
			const transport = new WebStandardStreamableHTTPServerTransport({
				sessionIdGenerator: undefined,
				enableJsonResponse: true,
			});
			await dictionary().connect(transport);
			return transport.handleRequest(req);
		},
	});
});
afterAll(async () => {
	void server.stop(true);
	await closeMaleoDb();
});

describe("a workspace's MCP servers in a run", () => {
	test("only allowlisted tools are callable, calls are traced, and an unreachable server is reported without failing the run", async () => {
		const projectId = (await createContentProject({ title: "Glossary", type: "video" })).project.id;
		const job = await buildAgentJob({ projectId, instruction: "", contentType: "video" });
		await saveRun(job);
		await putMcpServer({
			workspace: job.workspace!,
			name: "dictionary",
			url: `http://127.0.0.1:${server.port}/mcp`,
			allow: ["lookup_word"],
		});
		await putMcpServer({
			workspace: job.workspace!,
			name: "offline",
			url: "http://127.0.0.1:9/mcp",
			allow: ["anything"],
		});

		const model = scriptedModel([
			callTool("dictionary_lookup_word", { word: "starter" }),
			callTool("dictionary_drop_database", {}),
			callTool("dictionary_lookup_word", { word: "everything" }, "call-everything"),
			answer("Defined it."),
		]);
		const host = inProcessHost(
			new Mastra({
				agents: { maleo: createInternalAgent(model) },
				workflows: AGENT_WORKFLOWS,
				storage: new InMemoryStore(),
				logger: false,
			}).getAgent("maleo"),
		);
		await startAgentRun(host, job, "define starter");

		const done = (await loadRun(job.id))!;
		expect(done.status).toBe("done");
		expect(calls).toEqual(["lookup_word", "lookup_word"]);
		const completed = done.events.filter((event) => event.kind === "tool_call_completed");
		expect(completed.map((event) => event.kind === "tool_call_completed" && event.tool)).toEqual([
			"dictionary_lookup_word",
			"dictionary_lookup_word",
		]);
		expect(completed[1]?.kind === "tool_call_completed" && completed[1].note).toStartWith(
			'{"truncated":true',
		);
		expect(completed[0]?.kind === "tool_call_completed" && completed[0].note).toContain(
			"living culture",
		);
		const notes = done.events.filter((event) => event.kind === "thinking_note");
		expect(notes).toHaveLength(1);
		expect(notes[0]?.kind === "thinking_note" && notes[0].body).toContain(
			`"offline" could not be reached`,
		);
		const traced = await openDb().all<{ summary: string }>(
			"SELECT summary FROM content_project_events WHERE project_id = ? AND kind = 'agent.tool_call'",
			[projectId],
		);
		expect(traced.map((row) => row.summary)).toContain("dictionary_lookup_word — ok");
	}, 60_000);
});
