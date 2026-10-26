/* The loop's guardrails, as agent configuration and tool contracts
 * (design decision 8).
 *
 *  - Step limit: the agent's `maxSteps`. A run that uses every step is finalized
 *    by `finalizeExhaustedRun`, outcome evaluation included, so an exhausted
 *    build with blocking findings never reports success.
 *  - Finish gate: a completion scorer. When a build run answers while the outcome
 *    evaluation still has blocking findings, the answer is rejected and the
 *    findings go back to the model as the instruction to fix them.
 *  - Ask budget: `ask_user` is a tool that suspends for the user's answer and
 *    enforces the budget itself; the story-brief checkpoint keeps its exemption.
 *  - Finish: the model's final answer becomes the run's final event.
 *
 * "Build" means the run changed the project: a building tool (`builds` in the
 * registry) succeeded. The intent classifier that used to decide it is gone
 * (decision 7).
 *
 * Everything here is module-level and reads the run through the request
 * context, so a run resumed in another process gets the same guardrails. */
import { createScorer } from "@mastra/core/evals";
import { createTool } from "@mastra/core/tools";
import type { RequestContext } from "@mastra/core/request-context";
import { emitStoryboardTable, suspendForQuestion } from "../approval.ts";
import { askUserInput } from "../tools/ask-user.ts";
import { evaluateOutcome, recordOutcomeEvaluation } from "../outcome.ts";
import { persist } from "../persistence.ts";
import { getAgentJob } from "../session-store.ts";
import { claimStoryClarificationSlot, storyClarificationEligible } from "../story-clarification.ts";
import type { AgentJob } from "../model.ts";
import { runState } from "./run-state.ts";
import { runFor, type AgentRunContext } from "./tools/registry-tools.ts";

/** Model steps a generation may take before it is settled as exhausted. */
export const MAX_STEPS = 24;
/** Clarifying questions per run, so asking cannot replace acting. */
export const ASK_LIMIT = 3;

/* A run that used every step ends with what it built. A build whose outcome
 * still has blocking findings needs attention; anything else is done, with a
 * note that more can be asked for. */
export async function finalizeExhaustedRun(job: AgentJob, buildIntent: boolean): Promise<void> {
	if (job.contentType === "video") emitStoryboardTable(job);
	const evaluation = recordOutcomeEvaluation(job);
	const blocked = buildIntent && evaluation.status === "failed";
	job.events.push({
		kind: "final",
		text: blocked
			? "Outcome needs attention — blocking findings remain. Use the listed fix actions, then continue."
			: "Paused after a long run — the storyboard is updated; send another message to keep going.",
	});
	job.status = blocked ? "needs_attention" : "done";
	await persist(job);
}

function blockers(job: AgentJob): string[] {
	return evaluateOutcome(job)
		.findings.filter((finding) => finding.severity === "blocker")
		.map((finding) => finding.message);
}

/** The blocking findings that keep a build run from finishing; none for a run that
 *  built nothing, and none for a single-tool run, which did exactly what was asked
 *  (runtime/direct-call.ts) and has no agent to finish the rest. */
export function finishBlockers(job: AgentJob): string[] {
	return runState(job).builtSomething && !job.run?.directCall ? blockers(job) : [];
}

async function jobOf(run: { requestContext?: unknown }): Promise<AgentJob | undefined> {
	// SAFETY: a completion scorer receives the request context as the plain record the run was called with (AgentRunContext).
	const runId = (run.requestContext as Partial<AgentRunContext> | undefined)?.runId;
	return runId ? await getAgentJob(runId) : undefined;
}

/** Rejects a build run's answer while blocking findings remain. */
export const outcomeGate = createScorer({
	id: "outcome-gate",
	description: "A build run may finish only without blocking outcome findings.",
})
	.generateScore(async ({ run }) => {
		const job = await jobOf(run);
		if (!job || !finishBlockers(job).length) return 1;
		runState(job).finishRejected = true;
		await persist(job);
		return 0;
	})
	.generateReason(async ({ run, score }) => {
		if (score === 1) return "No blocking findings.";
		const job = await jobOf(run);
		return `Finish rejected by the outcome gate: ${job ? finishBlockers(job).join(" | ") : "blocking findings remain"}. Apply the smallest scoped fixes, then finish again.`;
	});

/** `ask_user`: suspends the run for the user's answer, within the ask budget. */
export const askUserTool = createTool({
	id: "ask_user",
	description:
		'Ask the user ONE question when the request is genuinely ambiguous and no sensible default exists. Give 2-4 concrete options (value = the exact answer text). Set purpose to "story_brief" only for the pre-research clarification of a NEW story build that has no plan yet. The run pauses until the user answers.',
	inputSchema: askUserInput,
	outputSchema: undefined,
	execute: async (input, context) => {
		// SAFETY: a resumed ask carries the answer the run was resumed with ({ answer }), per the required-action contract.
		const answered = context?.agent?.resumeData as { answer?: string } | undefined;
		if (answered) return { answer: answered.answer ?? "" };
		// SAFETY: the agent passes the request context it was called with, typed by AgentRunContext.
		const job = await runFor(
			context?.requestContext as RequestContext<AgentRunContext> | undefined,
		);
		const state = runState(job);
		/* The story-brief checkpoint is exempt from the budget, and the exemption is
		 * earned from run state, never from the claim: a video project with no plan,
		 * no batch yet and no bypass. Asking it is itself the start of a story build. */
		const storyBrief =
			input.purpose === "story_brief" &&
			storyClarificationEligible(job, { buildIntent: true, instruction: state.instruction });
		if (storyBrief) claimStoryClarificationSlot(job);
		else if (state.asks >= ASK_LIMIT) {
			return {
				skipped: true,
				note: `Already asked ${state.asks} times — pick the best default and proceed without asking.`,
			};
		} else state.asks += 1;
		await suspendForQuestion(job, input);
		await context?.agent?.suspend({ question: input.question, actionId: job.pendingActionId });
		return { suspended: true };
	},
});

/** What one agent call ended as, in the terms settlement needs. */
export interface AgentOutcome {
	finishReason?: string;
	steps: ReadonlyArray<{ text?: string; finishReason?: string }>;
}

/** Turn the agent's last answer into the run's final state. */
export async function settleRun(job: AgentJob, outcome: AgentOutcome): Promise<void> {
	if (outcome.finishReason === "suspended" || job.status === "awaiting_input") return;
	// Mastra invokes this hook before throwing provider errors to the host's failure handler.
	if (outcome.finishReason === "error") return;
	const last = outcome.steps.at(-1);
	if (!last) {
		job.status = "error";
		job.error = `Text provider returned no completed model step (finish reason: ${outcome.finishReason ?? "unknown"}). Check the provider response and API logs.`;
		await persist(job);
		return;
	}
	const answered = last?.finishReason === "stop" && !finishBlockers(job).length;
	if (!answered) {
		await finalizeExhaustedRun(job, runState(job).builtSomething);
		return;
	}
	if (job.contentType === "video") emitStoryboardTable(job);
	job.events.push({ kind: "final", text: last?.text?.trim() || "Done." });
	job.status = "done";
	await persist(job);
}
