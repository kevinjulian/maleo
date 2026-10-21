/* What the story services consume, named.
 *
 * A story service — plan, redraft, edit a section, generate, regenerate — takes
 * the outputs of earlier stages as arguments instead of reading them off the job.
 * The one place they are read is the service's entry point (`storyInputsOf`), the
 * tool handler that both a ReAct step and a stage commit call; inside a stage
 * commit that read is scoped to the stage's contract.
 *
 * What a service writes and then re-reads while it works — the plan's sections as
 * generation settles them — is its own output in progress, and it keeps reading
 * that from the run. */
import {
	approvedPlanArtifact,
	payloadOfKind,
	researchBundleArtifact,
	storyPlanArtifact,
	type PipelineArtifact,
	type StoryApprovedSnapshot,
} from "@maleo/shared";
import type { AgentJob, StoryPlanPayload } from "./model.ts";
import type { ResearchBundle } from "../../../lib/web-research.ts";
import { jobArtifactsOfKind } from "./artifact-store.ts";
import { bundleOf, researchOf } from "./research-state.ts";
import type { StageInputs } from "./pipeline.ts";

export interface StoryInputs {
	/** The plan an earlier stage drafted, or none yet. */
	plan: StoryPlanPayload | null;
	/** The recorded approval, when there is one. */
	approved?: PipelineArtifact<StoryApprovedSnapshot>;
	/** The research the run holds, when there is any. */
	research?: ResearchBundle;
}

/** Read a story service's inputs at its entry point — only the ones it consumes,
 *  so a service inside a stage reads nothing outside the stage's contract. */
export function storyInputsOf(
	job: AgentJob,
	needs: ReadonlyArray<"approved" | "research"> = ["research"],
): StoryInputs {
	const plan = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.payload;
	return {
		plan: plan ? { ...plan, planKind: plan.planKind ?? "story" } : null,
		...(needs.includes("approved")
			? { approved: jobArtifactsOfKind(job, approvedPlanArtifact)[0] }
			: {}),
		...(needs.includes("research") ? { research: researchOf(job) } : {}),
	};
}

/** A stage's story inputs, from what the runner resolved for it. The stage
 *  produces its own approval, so none is passed in. */
export function storyInputsFrom(inputs: StageInputs): StoryInputs {
	const plan = payloadOfKind(inputs.get(storyPlanArtifact.kind), storyPlanArtifact);
	const research = payloadOfKind(inputs.get(researchBundleArtifact.kind), researchBundleArtifact);
	return {
		plan: plan ? { ...plan, planKind: plan.planKind ?? "story" } : null,
		research: research ? bundleOf(research) : undefined,
	};
}

/** The approval generation may consume: the recorded one, only when it is the
 *  approval this plan holds. */
export function approvalFor(
	inputs: Pick<StoryInputs, "approved">,
	plan: Pick<StoryPlanPayload, "generationState"> | null,
): PipelineArtifact<StoryApprovedSnapshot> | undefined {
	const current = plan?.generationState?.approvedSnapshot?.revisionId;
	return inputs.approved && current && inputs.approved.payload.revisionId === current
		? inputs.approved
		: undefined;
}
