/* Research-state leaf — the run's research lives in one place, the
 * `research_bundle` artifact. There is no second copy on the job: the bundle
 * shape the planner and evidence checks read is rebuilt from the artifact, and
 * claims are derived from source excerpts exactly as retrieval derives them.
 *
 * Two questions, two readers:
 *  - `researchOf`: what research this run holds now — what a draft, a redraft or
 *    "research again" works from.
 *  - `groundedResearch`: what the current plan was grounded in — resolved through
 *    the plan's own input reference, so research revised after the plan was
 *    drafted is not mistaken for the evidence it cites. */
import {
	artifactRefOf,
	payloadOfKind,
	researchBundleArtifact,
	resolveArtifactRef,
	storyPlanArtifact,
	type ArtifactRef,
	type PipelineArtifact,
} from "@maleo/shared";
import type { ResearchBundlePayload } from "@maleo/shared/agent-wire";
import type { AgentJob } from "./model.ts";
import type { ResearchBundle } from "../../../lib/web-research.ts";
import {
	currentProducer,
	jobArtifactById,
	jobArtifactsOfKind,
	putJobArtifact,
} from "./artifact-store.ts";
import { fingerprintBrief } from "./services/util.ts";
import type { StageContract } from "./stage-contracts.ts";

function researchArtifactOf(
	job: Pick<AgentJob, "artifacts">,
): PipelineArtifact<ResearchBundlePayload> | undefined {
	return jobArtifactsOfKind(job, researchBundleArtifact)[0];
}

/** The planner's bundle shape, rebuilt from a research artifact's payload. */
export function bundleOf(payload: ResearchBundlePayload): ResearchBundle {
	return {
		topic: payload.topic,
		queries: payload.queries ?? [],
		sources: payload.sources,
		claims: payload.sources.map((source) => ({ text: source.excerpt, sourceUrls: [source.url] })),
	};
}

/** The research this run holds now. */
export function researchOf(job: Pick<AgentJob, "artifacts">): ResearchBundle | undefined {
	const artifact = researchArtifactOf(job);
	return artifact ? bundleOf(artifact.payload) : undefined;
}

/** Write the run's research, replacing what it held. */
export function setResearch(job: AgentJob, bundle: ResearchBundle): PipelineArtifact {
	return putJobArtifact(
		job,
		researchBundleArtifact.kind,
		{
			topic: bundle.topic,
			sources: bundle.sources,
			claimCount: bundle.claims.length,
			briefKey: fingerprintBrief(bundle.topic),
			queries: bundle.queries,
		},
		currentProducer(job),
	);
}

/** The reference a plan records when it is grounded in this run's research under
 *  `researchKey`, or none when the research does not match that key. */
export function researchRefFor(
	job: Pick<AgentJob, "artifacts">,
	researchKey: string | undefined,
): ArtifactRef[] {
	const artifact = researchArtifactOf(job);
	if (!artifact || !researchKey || !artifact.payload.sources.length) return [];
	return fingerprintBrief(artifact.payload.topic) === researchKey ? [artifactRefOf(artifact)] : [];
}

/** What the current plan was grounded in: the exact research revision its input
 *  reference names, or nothing when it names none or that content has changed. */
export function groundedResearch(job: Pick<AgentJob, "artifacts">): ResearchBundle | undefined {
	const ref = jobArtifactsOfKind(job, storyPlanArtifact)[0]?.inputRefs.find(
		(input) => input.kind === researchBundleArtifact.kind,
	);
	if (!ref) return undefined;
	const resolved = resolveArtifactRef(ref, (id) => jobArtifactById(job, id));
	const payload = resolved.ok
		? payloadOfKind(resolved.artifact, researchBundleArtifact)
		: undefined;
	return payload ? bundleOf(payload) : undefined;
}

/** The artifacts of the kinds a stage's contract names — what it requires and
 *  what it produces — and no others. */
export function declaredArtifacts(
	job: Pick<AgentJob, "artifacts">,
	contract: StageContract,
): PipelineArtifact[] {
	const kinds = new Set([...contract.requires, ...contract.produces].map((entry) => entry.kind));
	return job.artifacts.filter((artifact) => kinds.has(artifact.kind));
}
