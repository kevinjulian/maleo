/* `POST /mcp` — the project's tools for MCP clients.
 *
 * Streamable HTTP, stateless: every request builds its own server and transport.
 * Authenticated by API key (credential.ts) rather than session, which is why
 * packages/auth/src/perimeter.ts names this path as exempt from the session check. */
import { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { runHost } from "../modules/agents/core/runtime/durable.ts";
import { mcpPrincipal } from "./credential.ts";
import type { McpDeps } from "./dispatch.ts";
import { buildMcpServer } from "./server.ts";

export const MCP_PATH = "/mcp";
/* The same endpoint under the API prefix, which is the only path the web origin
 * proxies to the API (apps/web serve.ts). It is the URL a user copies from
 * Settings → MCP: one public origin, whether or not the API is exposed itself. */
export const MCP_PUBLIC_PATH = "/api/mcp";
export const MCP_PATHS: readonly string[] = [MCP_PATH, MCP_PUBLIC_PATH];

function rpcError(status: number, code: number, message: string): Response {
	return Response.json({ jsonrpc: "2.0", error: { code, message }, id: null }, { status });
}

/** Delegated runs execute on the durable host. */
const DURABLE: McpDeps = { host: runHost };

export function mcpRoutes(deps: McpDeps = DURABLE): Hono {
	const app = new Hono();
	app.on("POST", [...MCP_PATHS], async (c) => {
		const principal = await mcpPrincipal(c.req.raw);
		if (!principal)
			return rpcError(
				401,
				-32001,
				"unauthorized: send a valid API key as Authorization: Bearer <key>",
			);
		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: undefined,
			enableJsonResponse: true,
		});
		await buildMcpServer(principal, deps).connect(transport);
		return transport.handleRequest(c.req.raw);
	});
	// Stateless: no session to resume or delete.
	app.on(["GET", "DELETE"], [...MCP_PATHS], () => rpcError(405, -32000, "method not allowed"));
	return app;
}
