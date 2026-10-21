/* A workflow definition as an agent tool: the engine runs inside the tool call.
 *
 * Suspension is the agent's own: the engine saves its cursor, the tool calls
 * `context.agent.suspend`, and Mastra records only that the call is suspended.
 * The resumed call re-enters here with `resumeData`, and the engine continues at
 * the saved node with the answer. Generations are keyed to the tool-call id,
 * which is stable across durable retries. */
import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import type { z } from "zod";
import { runToolFlow } from "../../engine/host.ts";
import type { EngineHost } from "../../engine/engine.ts";
import type { EngineRegistry } from "../../engine/registry.ts";
import type { AgentJob } from "../../model.ts";
import { markBuilt, runState, stepForToolCall } from "../run-state.ts";
import { persist } from "../../persistence.ts";
import { emitToolCall } from "../../trace.ts";
import { WorkflowNodeError, type EngineResult } from "../../engine/engine.ts";
import { runFor, type AgentRunContext } from "./registry-tools.ts";

export interface WorkflowToolOptions<S extends z.ZodTypeAny> {
	id: string;
	description: string;
	inputSchema: S;
	workflow: string;
	registry: () => EngineRegistry;
	/** The workflow input built from the validated tool arguments. */
	input?(args: z.output<S>, job: AgentJob): unknown;
	/** Report the call as this tool's chat card and trace row. */
	report?: string;
	/** A completed run changed the project: the run is a build (guardrails.ts). */
	builds?: boolean;
	/** The stage-contract host for the run, when the definition calls under a contract. */
	contract?(job: AgentJob): EngineHost["contract"];
}

export function workflowTool<S extends z.ZodTypeAny>(options: WorkflowToolOptions<S>) {
	return createTool({
		id: options.id,
		description: options.description,
		inputSchema: options.inputSchema,
		execute: async (args, context) => {
			// SAFETY: the agent passes the request context it was called with, typed by AgentRunContext.
			const job = await runFor(
				context?.requestContext as RequestContext<AgentRunContext> | undefined,
			);
			const toolCallId = context?.agent?.toolCallId;
			if (!toolCallId)
				throw new Error(`${options.id} needs an agent tool-call id to key its flow record`);
			runState(job).step = stepForToolCall(job, toolCallId);
			// SAFETY: a resumed call carries the answer it was resumed with ({ answer }), per the required-action contract.
			const answer = (context?.agent?.resumeData as { answer?: string } | undefined)?.answer;
			const flow = () =>
				runToolFlow({
					registry: options.registry(),
					job,
					toolCallId,
					workflow: options.workflow,
					input: options.input ? options.input(args, job) : args,
					answer,
					contract: options.contract?.(job),
				});
			const result = options.report
				? await reported(job, options.report, args, flow)
				: await flow();
			if (options.builds && result.status === "completed" && result.outcome.ok) markBuilt(job);
			if (result.status === "suspended") {
				await context?.agent?.suspend(result.question);
				return { suspended: true };
			}
			if (result.status === "cancelled")
				return { ok: false, note: "This run was stopped; no further step ran." };
			return result.outcome;
		},
	});
}

/* The call as a tool card: opened when the segment starts, closed with its note
 * (awaiting on a suspension), and the run marked as changing the job. A failed
 * node becomes the card's failure and an unsuccessful outcome for the agent. */
async function reported(
	job: AgentJob,
	tool: string,
	args: unknown,
	flow: () => Promise<EngineResult>,
): Promise<EngineResult> {
	runState(job).jobWrites = true;
	let result: EngineResult | undefined;
	const card = await emitToolCall(
		job,
		tool,
		args !== null && typeof args === "object" ? { ...args } : {},
		async () => {
			try {
				result = await flow();
			} catch (error) {
				throw error instanceof WorkflowNodeError && error.cause instanceof Error
					? error.cause
					: error;
			}
			if (result.status === "suspended")
				return {
					note: result.question.note ?? result.question.question,
					effect: "await" as const,
					suspended: true as const,
				};
			if (result.status === "cancelled") return { note: "This run was stopped." };
			if (!result.outcome.ok) throw new Error(result.outcome.note);
			return { note: result.outcome.note, thumbs: result.outcome.thumbs, effect: "asset" as const };
		},
	);
	await persist(job);
	return card.ok && result
		? result
		: { status: "completed", outcome: { ok: false, note: card.note } };
}
