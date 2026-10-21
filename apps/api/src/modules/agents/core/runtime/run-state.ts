/* The run's loop state — instruction, ask budget, whether it has built — kept on
 * the AgentJob, the product record, so it survives every resume. */
import type { AgentJob } from "../model.ts";
import { setOutcomeIntent } from "../outcome.ts";

export type RunState = NonNullable<AgentJob["run"]>;

/** The run's loop state, created on first use. */
export function runState(job: AgentJob): RunState {
	job.run ??= {
		instruction: "",
		transcript: "",
		step: 0,
		builtSomething: false,
		finishRejected: false,
		asks: 0,
	};
	return job.run;
}

/** The Mastra run that executes this job now: started, resumed and answered by this id. */
export function executionId(job: AgentJob): string {
	return job.run?.executionId ?? job.id;
}

/** The step a tool call runs under: its own for the life of the run, a new one per call. */
export function stepForToolCall(job: AgentJob, toolCallId: string | undefined): number {
	const state = runState(job);
	const steps = (state.toolCallSteps ??= {});
	const known = toolCallId === undefined ? undefined : steps[toolCallId];
	if (known !== undefined) return known;
	const next = Object.keys(steps).length;
	if (toolCallId !== undefined) steps[toolCallId] = next;
	return next;
}

/* A run is a build once it changes the project: a building tool succeeded
 * (design decision 7 replaced the intent classifier with this). Both readers of
 * "build" follow from here — the finish gate (`builtSomething`) and the outcome
 * evaluator, which holds content, visual, duration and evidence findings to a
 * build intent. Video has one build intent, as it did under the classifier.
 * Returns whether the run just became a build. */
export function markBuilt(job: AgentJob): boolean {
	const state = runState(job);
	if (state.builtSomething) return false;
	state.builtSomething = true;
	setOutcomeIntent(job, job.contentType === "video" ? "build_story" : "build_short");
	return true;
}
