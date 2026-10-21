/* Connecting to MCP servers: the one client the agent's external tools and the
 * BrowserOS research provider both use. A leaf module — it imports nothing of the
 * agent — so research can use it without a cycle through the tool registry. */
import { MCPClient } from "@mastra/mcp";
import type { ToolArgs } from "../../types.ts";

export interface ExternalMcpServer {
	/** The name tools are prefixed with. */
	name: string;
	url: URL;
	/** The server's own tool names that may reach the model. */
	allow: readonly string[];
	headers?: Record<string, string>;
}

export type McpTools = Awaited<ReturnType<MCPClient["listTools"]>>;

export interface ExternalMcpToolset {
	tools: McpTools;
	/** Servers that could not be reached, with why. */
	unavailable: Array<{ name: string; reason: string }>;
	close(): Promise<void>;
}

/** How long connecting to or listing a server may take before it counts as unreachable. */
const CONNECT_TIMEOUT_MS = 10_000;

/** A failure's first line: what went wrong, without the stack the client appends. */
function reason(error: string): string {
	return (error.split("\n")[0] ?? error)
		.replace(/^Failed to connect to MCP server \S+: /, "")
		.slice(0, 200);
}

export async function externalMcpTools(
	servers: readonly ExternalMcpServer[],
): Promise<ExternalMcpToolset> {
	const client = new MCPClient({
		id: `external-${crypto.randomUUID()}`,
		timeout: CONNECT_TIMEOUT_MS,
		servers: Object.fromEntries(
			servers.map((server) => [
				server.name,
				{ url: server.url, requestInit: { headers: server.headers } },
			]),
		),
	});
	const allowed = new Set(
		servers.flatMap((server) => server.allow.map((tool) => `${server.name}_${tool}`)),
	);
	// Per server: one that cannot be reached is an error here, and the others still list.
	const { tools, errors } = await client.listToolsWithErrors();
	return {
		tools: Object.fromEntries(Object.entries(tools).filter(([name]) => allowed.has(name))),
		unavailable: Object.entries(errors).map(([name, error]) => ({ name, reason: reason(error) })),
		close: () => client.disconnect(),
	};
}

/** One server's tools by their own names, and calls returning the server's raw result. */
export interface McpTransport {
	listTools(): Promise<Array<{ name: string; description?: string }>>;
	/** `args` is the JSON object the server validates against the tool's own schema. */
	callTool(name: string, args: ToolArgs): Promise<unknown>;
	close(): Promise<void>;
}

/** A single server, connected; throws when it cannot be reached. */
export async function mcpTransport(url: string, timeoutMs: number): Promise<McpTransport> {
	const name = "server";
	const client = new MCPClient({
		id: `transport-${crypto.randomUUID()}`,
		timeout: timeoutMs,
		servers: { [name]: { url: new URL(url) } },
	});
	const { tools, errors } = await client.listToolsWithErrors();
	if (errors[name]) {
		await client.disconnect().catch(() => {});
		throw new Error(reason(errors[name]));
	}
	const own = (prefixed: string) => prefixed.slice(name.length + 1);
	return {
		listTools: async () =>
			Object.entries(tools).map(([prefixed, tool]) => ({
				name: own(prefixed),
				description: tool.description,
			})),
		callTool: async (tool, args) => {
			const found = tools[`${name}_${tool}`];
			if (!found?.execute) throw new Error(`the server has no tool ${tool}`);
			// SAFETY: an MCP tool's execute forwards the arguments to the server; outside an agent it reads no context field.
			return await found.execute(args, {} as never);
		},
		close: () => client.disconnect(),
	};
}
