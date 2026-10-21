/* Test fixtures: artifacts built through the real write path, so a fixture has a
 * valid revision and content hash exactly like a run-written one. */
import {
	pipelineArtifactKinds,
	storyPlanArtifact,
	storyPlanArtifactOf,
	writeArtifact,
	type PipelineArtifact,
} from "@maleo/shared";
import type { AgentJob, StoryPlanPayload } from "./model.ts";
import { putJobArtifact, stageProducer } from "./artifact-store.ts";

export function fixtureArtifacts(
	projectId: string,
	entries: ReadonlyArray<{ kind: string; payload: unknown }>,
	runId = "run-fixture",
): PipelineArtifact[] {
	return entries.reduce<PipelineArtifact[]>(
		(artifacts, entry) =>
			writeArtifact(pipelineArtifactKinds, artifacts, {
				...entry,
				producer: { type: "stage", stage: "plan", runId },
				projectId,
			}).artifacts,
		[],
	);
}

/** Rewrite a job's story plan through the write path, the way a test edits it. */
export function rewritePlan(
	job: AgentJob,
	update: (plan: StoryPlanPayload) => StoryPlanPayload,
): void {
	const plan = storyPlanArtifactOf(job.artifacts)?.payload;
	if (!plan) throw new Error("missing story plan");
	putJobArtifact(job, storyPlanArtifact.kind, update(plan), stageProducer(job, "plan"));
}
