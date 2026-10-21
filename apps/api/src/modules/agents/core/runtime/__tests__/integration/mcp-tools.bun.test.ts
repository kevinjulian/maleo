/* adopt-mastra-internal-agent 1.4: consuming an external MCP server.
 *
 * A local MCP server offers a harmless tool and a dangerous one; only the
 * allowlisted tool reaches the agent's model, and calling it reaches the server. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Agent } from "@mastra/core/agent";
import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { externalMcpTools, type ExternalMcpToolset } from "../../tools/mcp-client.ts";

const calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;
let toolset: ExternalMcpToolset;

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
		return {
			content: [
				{
					type: "text",
					text: `${String(request.params.arguments?.word)}: a living culture of flour and water`,
				},
			],
		};
	});
	return mcp;
}

beforeAll(async () => {
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
	toolset = await externalMcpTools([
		{
			name: "dictionary",
			url: new URL(`http://127.0.0.1:${server.port}/mcp`),
			allow: ["lookup_word"],
		},
	]);
});

afterAll(async () => {
	await toolset.close();
	void server.stop(true);
});

describe("an allowlisted external MCP server", () => {
	test("only the allowlisted tool is exposed", () => {
		expect(Object.keys(toolset.tools)).toEqual(["dictionary_lookup_word"]);
	});

	test("the agent's model is offered only the allowlisted tool, and calling it reaches the server", async () => {
		let offered: string[] = [];
		let turn = 0;
		// SAFETY: scripted results carry only the fields Mastra reads from a V2 model.
		const model = new MastraLanguageModelV2Mock({
			doGenerate: async (options: { tools?: Array<{ name: string }> }) => {
				turn += 1;
				if (turn === 1) {
					offered = (options.tools ?? []).map((tool) => tool.name);
					return {
						content: [
							{
								type: "tool-call",
								toolCallId: "c1",
								toolName: "dictionary_lookup_word",
								input: JSON.stringify({ word: "starter" }),
							},
						],
						finishReason: "tool-calls",
						usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
						warnings: [],
					};
				}
				return {
					content: [{ type: "text", text: "defined" }],
					finishReason: "stop",
					usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
					warnings: [],
				};
			},
		} as never);
		const agent = new Agent({
			id: "reader",
			name: "reader",
			instructions: "Define words.",
			model,
			tools: toolset.tools,
		});

		const result = await agent.generate("What is a starter?", { maxSteps: 3 });

		expect(offered).toEqual(["dictionary_lookup_word"]);
		expect(calls).toEqual(["lookup_word"]);
		expect(result.text).toBe("defined");
	});
});
