/* An agent run's lifecycle on the Mastra runtime (design decision 6).
 *
 * The AgentJob is the product record: the conversation's events, the run's
 * status, the pending action and the result live there and survive a reload.
 * Mastra's run and workflow state is execution state only, keyed by the same id
 * as the job, so a run needs no mapping to resume.
 *
 *  - start   — the instruction runs as one agent generation for the run's project.
 *  - answer  — the answer to a pending action resumes the suspended generation.
 *              Only the action the run is waiting on is accepted: a stale or
 *              duplicate answer resumes nothing (Mastra would replay the tool).
 *  - stop    — the run ends at once on the product record; anything still
 *              executing makes no further change (every effect checks the run).
 *  - abandon — a run that waited on the user past the input timeout ends.
 *
 * Settlement — the final answer, the status, the terminal checkpoint — happens
 * where the generation finishes (runtime/settle.ts), not here. */
import { RequestContext } from "@mastra/core/request-context";
import { listWorkflowRunIdsAwaitingSince } from "@maleo/db/workflow-run-db";
import { recordAgentSessionEvent } from "../../../lib/agent-trace.ts";
import { classifyAgentError } from "@maleo/shared/agent-errors";
import { persist } from "./persistence.ts";
import { markRunAbandoned, resolveRequiredActions } from "./run-repository.ts";
import { chatContextPrompt } from "./context-prompt.ts";
import { getAgentJob, JOBS } from "./session-store.ts";
import type { AgentJob } from "./model.ts";
import { executionId, runState } from "./runtime/run-state.ts";
import type { DirectCall } from "./runtime/direct-call.ts";
import { endAgentRun, failAgentRun } from "./runtime/settle.ts";
import type { AgentRunContext } from "./runtime/tools/registry-tools.ts";
import { assertCapturedTextSelection } from "../../../lib/text-selection-scope.ts";

/** How long a run may wait on the user before it is abandoned. */
export const INPUT_WAIT_MS = 24 * 60 * 60 * 1000;

/** Where a run's generations execute: in this process, or on the durable host. */
export interface RunHost {
	start(
		job: AgentJob,
		message: string,
		requestContext: RequestContext<AgentRunContext>,
	): Promise<void>;
	resume(
		job: AgentJob,
		answer: string,
		requestContext: RequestContext<AgentRunContext>,
	): Promise<void>;
}

/** The slice of a Mastra agent the in-process host drives. */
export interface GeneratingAgent {
	generate(
		message: string,
		options: { runId: string; requestContext: RequestContext<AgentRunContext> },
	): Promise<unknown>;
	resumeGenerate(
		resumeData: { answer: string },
		options: { runId: string; requestContext: RequestContext<AgentRunContext> },
	): Promise<unknown>;
}

/** Runs each generation to its end, or its next question, in this process. */
export function inProcessHost(agent: GeneratingAgent): RunHost {
	return {
		start: async (job, message, requestContext) => {
			await agent.generate(message, { runId: executionId(job), requestContext });
		},
		resume: async (job, answer, requestContext) => {
			await agent.resumeGenerate({ answer }, { runId: executionId(job), requestContext });
		},
	};
}

/** What an answer did: resumed the run, or nothing because the run was not waiting on it. */
export type AnswerOutcome = "resumed" | "stale";

export function runContext(job: AgentJob): RequestContext<AgentRunContext> {
	return new RequestContext<AgentRunContext>([
		["runId", job.id],
		["projectId", job.projectId],
		["contentType", job.contentType],
		["textSelection", job.textSelection],
	]);
}

/** The user's message, with the brief and the chat context the run was started with. */
function messageFor(job: AgentJob, instruction: string): string {
	const context = chatContextPrompt(job.context);
	const brief = job.brief.trim();
	return [
		instruction.trim(),
		brief && brief !== instruction.trim() ? `Project brief: ${brief}` : "",
		context,
	]
		.filter(Boolean)
		.join("\n\n");
}

/** How a caller waits: for the whole generation (tests, the host's own worker), or
 *  only until the run's record has changed, leaving the generation to the host
 *  (an HTTP request, which answers at once and is followed by polling). */
export interface RunCallOptions {
	background?: boolean;
}

/** Hand a generation to the host; a failure settles the run either way. */
async function onHost(
	runId: string,
	generation: () => Promise<void>,
	options: RunCallOptions,
): Promise<void> {
	const settled = generation().catch((error: unknown) => failAgentRun(runId, error));
	if (!options.background) await settled;
}

/** Start an instruction on the host. */
export async function startAgentRun(
	host: RunHost,
	job: AgentJob,
	instruction: string,
	options: RunCallOptions = {},
): Promise<void> {
	// One object for the whole run in this process: every tool reads and writes this job.
	await assertCapturedTextSelection(job.textSelection);
	JOBS.set(job.id, job);
	const state = runState(job);
	state.instruction = instruction;
	state.runtime = "agent";
	job.status = "running";
	await persist(job);
	await recordAgentSessionEvent(job, "started", instruction);
	await onHost(
		job.id,
		() => host.start(job, messageFor(job, instruction), runContext(job)),
		options,
	);
}

/** Start a single-tool run: the one registry tool call an MCP client asked for,
 *  as a run in the project chat (runtime/direct-call.ts). */
export async function startDirectRun(
	host: RunHost,
	job: AgentJob,
	call: DirectCall,
	options: RunCallOptions = {},
): Promise<void> {
	runState(job).directCall = call;
	await startAgentRun(host, job, `${call.tool} ${JSON.stringify(call.args)}`, options);
}

/** Whether the run waits on exactly this action: the only answer that resumes it. */
export function awaitsAction(job: AgentJob | undefined, actionId: string | undefined): boolean {
	return Boolean(
		job &&
		job.status === "awaiting_input" &&
		job.pendingActionId &&
		job.pendingActionId === actionId,
	);
}

/** Resume a run with the answer to the action it is waiting on. */
export async function answerAgentRun(
	host: RunHost,
	runId: string,
	actionId: string | undefined,
	answer: string,
	options: RunCallOptions = {},
): Promise<AnswerOutcome> {
	const job = await getAgentJob(runId);
	if (!job || !awaitsAction(job, actionId)) return "stale";
	await assertCapturedTextSelection(job.textSelection);
	JOBS.set(job.id, job);
	job.status = "running";
	job.pendingActionId = undefined;
	job.pendingQuestion = undefined;
	await resolveRequiredActions(job.id);
	await persist(job);
	await recordAgentSessionEvent(job, "started", "answer");
	await onHost(job.id, () => host.resume(job, answer, runContext(job)), options);
	return "resumed";
}

/** Stop a run now. Returns the status the run ended in, or its existing end. */
export async function cancelAgentRun(runId: string): Promise<AgentJob["status"] | undefined> {
	const job = await getAgentJob(runId);
	if (!job) return undefined;
	if (job.status !== "running" && job.status !== "awaiting_input") return job.status;
	job.status = "error";
	job.error = "Run stopped by user.";
	job.pendingQuestion = undefined;
	job.pendingActionId = undefined;
	job.events.push({ kind: "error", message: job.error, errorInfo: classifyAgentError(job.error) });
	job.events.push({ kind: "final", text: "Stopped." });
	await resolveRequiredActions(job.id);
	await persist(job);
	await endAgentRun(job);
	return job.status;
}

/** Abandon every run that has waited on the user since before the input timeout. */
export async function abandonStaleWaits(
	now = Date.now(),
	maxWaitMs = INPUT_WAIT_MS,
): Promise<string[]> {
	const ids = await listWorkflowRunIdsAwaitingSince(now - maxWaitMs);
	for (const id of ids) {
		await markRunAbandoned(id, "timed out awaiting input");
		JOBS.delete(id);
	}
	return ids;
}
