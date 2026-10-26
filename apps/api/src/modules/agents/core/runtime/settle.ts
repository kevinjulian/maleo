/* How an agent run ends on the product record, wherever it ends.
 *
 * On the durable host a run's segments execute on whichever worker Inngest
 * picks, and the caller that started it may be gone. So settlement is an output
 * processor of the agent definition — present in every process — that receives
 * the finished generation with the run's request context and settles the
 * AgentJob there. A suspension does not reach it: the tool or step that parked
 * has already recorded the pending action. */
import {
	forgetAgentTrace,
	recordAgentSessionEvent,
	recordPipelineCheckpoint,
} from "../../../../lib/agent-trace.ts";
import { persist } from "../persistence.ts";
import { getAgentJob } from "../session-store.ts";
import type { AgentJob } from "../model.ts";
import { settleRun, type AgentOutcome } from "./guardrails.ts";
import type { AgentRunContext } from "./tools/registry-tools.ts";

/* A run that parked left an "awaiting input" checkpoint in the project's event
 * log, which a reload reads as the active run. Ending the run records where it
 * ended, so that checkpoint is no longer the latest. */
export async function endAgentRun(job: AgentJob): Promise<void> {
	await recordPipelineCheckpoint(job, {
		label: "agent run",
		status: job.status === "done" ? "done" : "needs_attention",
	});
	await recordAgentSessionEvent(job, "ended");
	forgetAgentTrace(job.id);
}

/** Whether the run is parked on the user, read after settlement changed it. */
function parked(job: AgentJob): boolean {
	return job.status === "awaiting_input";
}

/** Settle a finished generation. A run that is no longer running — stopped by the user, abandoned — keeps its state. */
export async function settleAgentRun(runId: string, outcome: AgentOutcome): Promise<void> {
	const job = await getAgentJob(runId);
	if (!job || job.status !== "running") return;
	if (outcome.finishReason === "error") return;
	await settleRun(job, outcome);
	if (!parked(job)) await endAgentRun(job);
}

/** A run whose generation failed ends `error` with the reason. */
export async function failAgentRun(runId: string, error: unknown): Promise<void> {
	const job = await getAgentJob(runId);
	if (!job || job.status !== "running") return;
	job.status = "error";
	job.error = error instanceof Error ? error.message : String(error);
	await persist(job);
	await endAgentRun(job);
}

interface SettleArgs {
	result: AgentOutcome;
	requestContext?: { get(key: keyof AgentRunContext): unknown };
	messages: unknown[];
}

/** The agent's settlement hook: runs where the generation finishes. */
export const settleProcessor = {
	id: "maleo-settle",
	processOutputResult: async ({ result, requestContext, messages }: SettleArgs) => {
		const runId = requestContext?.get("runId");
		if (typeof runId === "string") await settleAgentRun(runId, result);
		return messages;
	},
};
