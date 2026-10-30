/* The tool registry as the internal agent's Mastra tools.
 *
 * One Mastra tool per registry entry, built once at module load. A tool finds
 * the run it acts on through the request context rather than a captured job: a
 * durable run can resume in another process, where a closure over the job would
 * be gone (adopt-mastra-internal-agent 1.3). Every call runs through the agent's
 * own executor, so input validation, approval gates, effect replay, artifact
 * application and tracing are exactly the existing ones; Mastra only chooses and
 * calls (design decision 2).
 *
 * `ask_user` and `finish` are not domain tools here: asking and finishing are
 * the runtime's guardrails (task 2.2). */
import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { TOOLS, toolsForContentType } from "../../registry.ts";
import { getAgentJob } from "../../session-store.ts";
import { runValidatedTool } from "../../tool-executor.ts";
import { emitToolCall } from "../../trace.ts";
import { persist } from "../../persistence.ts";
import { markBuilt, runState, stepForToolCall } from "../run-state.ts";
import { decideGate } from "../gates.ts";
import { preconditionFor } from "./preconditions.ts";
import type { AgentJob } from "../../model.ts";
import type { AnyToolDef, ContentType, ToolArgs } from "../../types.ts";
import { withGenerationScope } from "../../../../../lib/generation/generation-scope.ts";
import { assertCapturedTextSelection } from "../../../../../lib/text-selection-scope.ts";

/** What every agent call carries: the run it advances and that run's project. */
export interface AgentRunContext {
	runId: string;
	projectId: string;
	contentType: ContentType;
	textSelection?: import("@maleo/shared").CapturedTextSelection;
}

/* Registry entries the agent does not call directly: asking and finishing are
 * the runtime's own (guardrails.ts), and `generate_story_assets` runs inside the
 * story assets workflow. Planning and the one-shot build are workflow definitions
 * on the engine, offered as their own tools (runtime/agent.ts). */
export const RUNTIME_TOOL_NAMES: ReadonlySet<string> = new Set([
	"ask_user",
	"finish",
	"generate_story_assets",
]);

/** A call that names a run it may not act on. */
export class ToolScopeError extends Error {}

export async function runFor(
	context: RequestContext<AgentRunContext> | undefined,
): Promise<AgentJob> {
	const runId = context?.get("runId");
	const projectId = context?.get("projectId");
	if (!runId || !projectId) throw new ToolScopeError("tool called outside an agent run");
	const job = await getAgentJob(runId);
	if (!job || job.projectId !== projectId)
		throw new ToolScopeError("this run does not belong to the project");
	/* Every effect passes here, so a run the user stopped — or the system
	 * abandoned — makes no further change, on whichever worker it is still running. */
	if (job.status !== "running")
		throw new ToolScopeError(`this run is ${job.status}: it makes no further changes`);
	await assertCapturedTextSelection(job.textSelection);
	return job;
}

function agentTool(def: AnyToolDef) {
	return createTool({
		id: def.name,
		description: def.description,
		inputSchema: def.input,
		execute: async (input, context) => {
			// SAFETY: the agent passes the request context it was called with, typed by AgentRunContext.
			const job = await runFor(
				context?.requestContext as RequestContext<AgentRunContext> | undefined,
			);
			// SAFETY: every registry input is a zod object schema, so validated input is a plain record.
			const args = input as ToolArgs;
			const gate = preconditionFor(job, def.name, args);
			if (gate?.kind === "refuse") return { refused: true, note: gate.note };
			if (gate?.kind === "approve") {
				// SAFETY: a resumed approval carries the user's answer ({ answer }), as ask_user's does.
				const answer = (context?.agent?.resumeData as { answer?: string } | undefined)?.answer;
				const decided = await decideGate(job, gate.summary, gate.label, answer);
				if (decided === "suspend") {
					await context?.agent?.suspend({ question: gate.summary, actionId: job.pendingActionId });
					return { suspended: true };
				}
				if (decided === "reject")
					return { declined: true, note: `Not changed — not approved: ${gate.summary}` };
				const refusal = await gate.onApprove(job, decided);
				if (refusal) return { refused: true, note: refusal };
			}
			const toolCallId = context?.agent?.toolCallId;
			runState(job).step = stepForToolCall(job, toolCallId);
			// Reported like every tool call: chat events, the trace row, and a failure as its message.
			// The model's call id is stable across a durable retry, so the call's generations are keyed to it (generation-scope.ts).
			const call = (traceId: string) => runValidatedTool(job, def.name, args, traceId);
			const { note, ok } = await emitToolCall(job, def.name, args, (traceId) =>
				toolCallId
					? withGenerationScope(`${job.id}:tool:${toolCallId}`, () => call(traceId))
					: call(traceId),
			);
			if (!ok) {
				await persist(job);
				return { error: true, note };
			}
			// A building tool that succeeded makes this a build run (guardrails.ts).
			if (def.builds) markBuilt(job);
			await persist(job);
			return { note };
		},
	});
}

const AGENT_TOOLS = new Map(
	TOOLS.filter((def) => !RUNTIME_TOOL_NAMES.has(def.name)).map((def) => [def.name, agentTool(def)]),
);

/** The tools an agent run on a project of this content type may call. */
export function agentTools(contentType: ContentType): Record<string, ReturnType<typeof agentTool>> {
	return Object.fromEntries(
		toolsForContentType(contentType)
			.filter((def) => !RUNTIME_TOOL_NAMES.has(def.name))
			.map((def) => [def.name, AGENT_TOOLS.get(def.name)!]),
	);
}

/** The agent's `tools`, resolved per call from the run's content type. */
export function agentToolsFor({
	requestContext,
}: {
	requestContext: RequestContext<AgentRunContext>;
}) {
	return agentTools(requestContext.get("contentType"));
}
