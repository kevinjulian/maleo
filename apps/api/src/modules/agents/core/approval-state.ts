/* Approval-state leaf — the approved plan as an artifact.
 *
 * Approving freezes one plan revision. That frozen snapshot is written as an
 * `approved_plan` artifact which references the exact plan revision it froze,
 * and generation consumes that artifact rather than reading the live plan: what
 * assets are made from is a named, hashed record, and everything a generation
 * pass produces can reference it.
 *
 * The plan's own `generationState` still says which revision is approved (the
 * editor and the storyboard commands read it). Generation requires the two to
 * agree, so a replanned draft that nobody approved can never generate against an
 * older approval. */
import {
	approvedPlanArtifact,
	artifactRefOf,
	storyPlanArtifact,
	type PipelineArtifact,
	type StoryApprovedSnapshot,
} from "@maleo/shared";
import type { AgentJob, StoryPlanPayload } from "./model.ts";
import { currentProducer, jobArtifactsOfKind, putJobArtifact } from "./artifact-store.ts";

/** The refusal generation has always given without an approved revision. */
export const NOT_APPROVED_NOTE =
	"Story plan is not approved. Approve current draft before generating assets.";

/** Record an approval: the frozen snapshot, referencing the plan revision it froze. */
export function recordApprovedPlan(
	job: AgentJob,
	snapshot: StoryApprovedSnapshot,
): PipelineArtifact {
	const plan = jobArtifactsOfKind(job, storyPlanArtifact)[0];
	return putJobArtifact(job, approvedPlanArtifact.kind, snapshot, currentProducer(job), {
		inputRefs: plan ? [artifactRefOf(plan)] : [],
	});
}

/** The approved plan generation may consume: the approval artifact, only when it
 *  is the approval the plan currently holds. */
export function approvedPlanFor(
	job: Pick<AgentJob, "artifacts">,
	plan: Pick<StoryPlanPayload, "generationState"> | null,
): PipelineArtifact<StoryApprovedSnapshot> | undefined {
	const approved = jobArtifactsOfKind(job, approvedPlanArtifact)[0];
	const current = plan?.generationState?.approvedSnapshot?.revisionId;
	return approved && current && approved.payload.revisionId === current ? approved : undefined;
}
