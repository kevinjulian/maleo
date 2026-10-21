/* adopt-mastra-internal-agent 2.12: BrowserOS on the shared MCP client.
 *
 * A local server stands in for BrowserOS with a research tool, a page reader and
 * a browser-control tool. Through the real transport, research sees only the
 * allowlisted tools, an owned tab opens and reads, and browser control and
 * unowned pages are refused before any call reaches the server. */
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { connectBrowseros } from "./browseros-mcp.ts";

const calls: string[] = [];
let server: ReturnType<typeof Bun.serve>;

function browseros(): Server {
	const mcp = new Server({ name: "browseros", version: "1" }, { capabilities: { tools: {} } });
	const schema = { type: "object", properties: {}, additionalProperties: true };
	mcp.setRequestHandler(ListToolsRequestSchema, async () => ({
		tools: [
			{ name: "tabs", description: "Open or close a tab.", inputSchema: schema },
			{ name: "read", description: "Read a page.", inputSchema: schema },
			{ name: "click", description: "Click an element.", inputSchema: schema },
		],
	}));
	mcp.setRequestHandler(CallToolRequestSchema, async (request) => {
		calls.push(request.params.name);
		const text =
			request.params.name === "tabs"
				? JSON.stringify({ page: 7 })
				: "Sourdough starters need daily feeding.";
		return { content: [{ type: "text", text }] };
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
			await browseros().connect(transport);
			return transport.handleRequest(req);
		},
	});
});
afterAll(() => {
	void server.stop(true);
});

test("research reaches BrowserOS through the shared client with its allowlist intact", async () => {
	const client = await connectBrowseros({ url: `http://127.0.0.1:${server.port}/mcp` });
	try {
		expect((await client.listTools()).map((tool) => tool.name).sort()).toEqual([
			"click",
			"read",
			"tabs",
		]);
		expect((await client.listAllowedTools()).map((tool) => tool.name).sort()).toEqual([
			"read",
			"tabs",
		]);

		await expect(client.callAllowedTool("click", {})).rejects.toThrow(
			'BrowserOS capability "click" is not allowed for research',
		);
		await expect(client.callAllowedTool("read", { page: 3 })).rejects.toThrow(
			"page 3 is not owned by research",
		);
		expect(calls).toEqual([]);

		const opened = await client.callAllowedTool("tabs", {
			action: "new",
			url: "https://en.wikipedia.org/wiki/Sourdough",
		});
		expect(opened.text).toContain('"page":7');
		const page = await client.callAllowedTool("read", { page: 7 });
		expect(page.text).toContain("daily feeding");
		expect(calls).toEqual(["tabs", "read"]);
	} finally {
		await client.close();
	}
});

test("an unreachable BrowserOS is reported as a setup problem", async () => {
	await expect(
		connectBrowseros({ url: "http://127.0.0.1:9/mcp", timeoutMs: 2000 }),
	).rejects.toThrow("Cannot reach BrowserOS MCP");
});
