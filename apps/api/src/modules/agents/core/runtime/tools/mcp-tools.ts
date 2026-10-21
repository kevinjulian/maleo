/* Tools from operator-configured MCP servers, as the internal agent sees them.
 *
 * A server's tools reach the model only when its allowlist names them: an
 * external server can add or rename tools at any time, and an unreviewed tool in
 * the model's hands is a prompt-injection and exfiltration path. Mastra names a
 * server's tools `<server>_<tool>`; the allowlist names them as the server does.
 *
 * Each server connects on its own, so one that cannot be reached loses only its
 * own tools. External calls are traced on the run like the agent's own, and can
 * change nothing in a project: only maleo's tools reach project state. */
import type { RequestContext } from "@mastra/core/request-context";
import { getMcpServersWithHeaders } from "@maleo/db/mcp-servers";
import { persist } from "../../persistence.ts";
import { emitToolCall } from "../../trace.ts";
import { runState } from "../run-state.ts";
import { externalMcpTools, type ExternalMcpToolset, type McpTools } from "./mcp-client.ts";
import { runFor, type AgentRunContext } from "./registry-tools.ts";

type McpTool = McpTools[string];

/* An external server's reply is untrusted and unbounded; past this it is cut, so
 * one tool cannot flood the model's context and the run's spend. */
const MAX_OUTPUT_CHARS = 20_000;

function bounded(output: unknown): unknown {
	const text = JSON.stringify(output) ?? "";
	return text.length <= MAX_OUTPUT_CHARS
		? output
		: { truncated: true, text: text.slice(0, MAX_OUTPUT_CHARS) };
}

/* An external tool as the agent calls it: the call and its result are recorded
 * on the run (chat events and the project trace) like any tool call. */
function traced(name: string, tool: McpTool): McpTool {
	const execute = tool.execute;
	if (!execute) return tool;
	return {
		...tool,
		execute: async (input: unknown, context) => {
			// SAFETY: the agent passes its request context, typed by AgentRunContext, to every tool it calls.
			const job = await runFor(
				context?.requestContext as RequestContext<AgentRunContext> | undefined,
			);
			let output: unknown;
			const { note, ok } = await emitToolCall(
				job,
				name,
				typeof input === "object" && input ? { ...input } : {},
				async () => {
					output = bounded(await execute(input, context));
					return { note: JSON.stringify(output).slice(0, 2000) };
				},
			);
			await persist(job);
			return ok ? output : { error: true, note };
		},
	};
}

/* ponytail: one toolset per workspace configuration, held open for the process and
 * rebuilt when the configuration changes (the superseded connections are left to
 * close with the process). An unreachable server is retried after FAILURE_TTL_MS
 * rather than on every model step. */
const FAILURE_TTL_MS = 60_000;
const toolsets = new Map<string, { at: number; toolset: Promise<ExternalMcpToolset> }>();

async function workspaceToolset(workspace: string): Promise<ExternalMcpToolset> {
	const servers = await getMcpServersWithHeaders(workspace);
	const key = `${workspace}:${servers.map((server) => `${server.name}@${server.updatedAt}`).join(",")}`;
	const cached = toolsets.get(key);
	if (
		cached &&
		(Date.now() - cached.at < FAILURE_TTL_MS || (await cached.toolset).unavailable.length === 0)
	)
		return await cached.toolset;
	const toolset = externalMcpTools(
		servers.map((server) => ({
			name: server.name,
			url: new URL(server.url),
			allow: server.allow,
			headers: server.headers,
		})),
	);
	toolsets.set(key, { at: Date.now(), toolset });
	return await toolset;
}

/** The run's workspace's allowlisted external tools. A server that cannot be
 *  reached is reported on the run once, and the run goes on without its tools. */
export async function externalToolsFor({
	requestContext,
}: {
	requestContext: RequestContext<AgentRunContext>;
}): Promise<McpTools> {
	const job = await runFor(requestContext);
	if (!job.workspace) return {};
	const toolset = await workspaceToolset(job.workspace);
	const state = runState(job);
	const unreported = toolset.unavailable.filter(
		(server) => !state.mcpUnavailable?.includes(server.name),
	);
	if (unreported.length) {
		state.mcpUnavailable = [
			...(state.mcpUnavailable ?? []),
			...unreported.map((server) => server.name),
		];
		for (const server of unreported)
			job.events.push({
				kind: "thinking_note",
				title: "Tool server unavailable",
				body: `The MCP server "${server.name}" could not be reached (${server.reason}); its tools are unavailable for this run.`,
				elapsedSec: 0,
			});
		await persist(job);
	}
	return Object.fromEntries(
		Object.entries(toolset.tools).map(([name, tool]) => [name, traced(name, tool)]),
	);
}
