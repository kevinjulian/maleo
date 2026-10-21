/* Run one pipeline stage as one workflow step.
 *
 * Stages move into workflow steps unchanged in behavior (design decision 7): a
 * step runs its stage through the same runner, restricted to that one stage, so
 * input resolution, the stage's contract scope, context snapshots and the
 * completion of its outputs are exactly the runner's. Ordering and pauses are the
 * workflow's; the runner never gates here (`auto`), because a gate is a workflow
 * step of its own. */
import { createStageRegistry, runPipeline, type PipelineRun, type Stage } from "../../pipeline.ts";
import { pipelineProfile, type PipelineName } from "../../pipeline-definitions.ts";
import { snapshotDeclaredContext } from "../../pipeline-context.ts";
import { traceDeclaredContext } from "../../pipeline-stages.ts";
import { persist } from "../../persistence.ts";
import { RetryableStageError } from "../../stage-failure.ts";
import type { AgentJob } from "../../model.ts";
import { withGenerationScope } from "../../../../../lib/generation/generation-scope.ts";
import { runState } from "../run-state.ts";

/** What a step hands the next: whether the pipeline may continue, and what to say. */
export interface StepOutcome {
	ok: boolean;
	note: string;
	/** The stage parked for the user; re-run it once they answer. */
	suspended?: true;
}

/* Our database and the workflow's snapshot are two stores. A stage's outputs and
 * its outcome are saved together, keyed by the workflow step, so a step retried
 * after that save — the process died before the workflow recorded the step — is
 * answered from the record and the stage neither repeats nor is lost. A parked
 * stage records nothing: it is meant to run again with the answer. */
export async function runStage(
	job: AgentJob,
	pipeline: PipelineName,
	stage: Stage<AgentJob>,
	stepKey: string,
): Promise<StepOutcome> {
	const state = runState(job);
	const recorded = state.stepOutcomes?.[stepKey];
	if (recorded) return recorded;
	// The stage's generations are keyed to this step, so a retry resumes them (generation-scope.ts).
	const outcome = await withGenerationScope(stepKey, () => runStageOnce(job, pipeline, stage));
	if (!outcome.suspended)
		state.stepOutcomes = {
			...state.stepOutcomes,
			[stepKey]: { ok: outcome.ok, note: outcome.note },
		};
	await persist(job);
	return outcome;
}

async function runStageOnce(
	job: AgentJob,
	pipeline: PipelineName,
	stage: Stage<AgentJob>,
): Promise<StepOutcome> {
	const profile = {
		...pipelineProfile(pipeline, {
			contentType: job.contentType,
			targetSec: job.targetDurationSec,
		}),
		stages: [stage.id],
	};
	const run: PipelineRun = { profile, cursor: stage.id, mode: "auto", status: "running" };
	const result = await runPipeline(
		job,
		createStageRegistry([stage]),
		run,
		traceDeclaredContext(job),
		snapshotDeclaredContext,
	);
	if (result.status === "failed") {
		// A retryable failure is the durable host's to re-enter: the step throws and is retried.
		if (result.error.retryable) throw new RetryableStageError(result.error);
		return { ok: false, note: result.error.message };
	}
	// `auto` never gates, so a parked stage here means the runner's contract changed.
	if (result.status === "awaiting_approval")
		throw new Error(`stage ${stage.id} parked in auto mode`);
	if (result.status === "suspended") return { ok: true, note: result.note, suspended: true };
	return { ok: true, note: result.notes.join(" ").trim() };
}
