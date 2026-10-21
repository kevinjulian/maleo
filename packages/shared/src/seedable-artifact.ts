/* Which agent artifacts a new run carries forward from saved storyboards.
 *
 * Two owners read this rule: the agent seeds a run from the newest saved carrier
 * of each kind, and storyboard retention must never prune that carrier. They
 * disagreeing is how a retained history silently drops the live plan, so the rule
 * lives here once. */
import type { PipelineArtifact } from "./pipeline-artifact.ts";

/** The artifact kinds a new run may be seeded with. */
export const SEEDABLE_ARTIFACT_KINDS = [
	"story_plan",
	"approved_plan",
	"knowledge",
	"media",
	"style_bible",
	"research_bundle",
] as const;
export type SeedableArtifactKind = (typeof SEEDABLE_ARTIFACT_KINDS)[number];

/** The seedable kind of a parsed artifact, or null. */
export function seedableArtifactKind(artifact: PipelineArtifact): SeedableArtifactKind | null {
	return SEEDABLE_ARTIFACT_KINDS.find((kind) => kind === artifact.kind) ?? null;
}
