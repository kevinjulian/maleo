/* Content-state leaf — the slide and post artifacts (`slide_deck`, `post_thread`)
 * that legacy image and text projects carry. No run produces them any more; a
 * job's wire shape still reports them, empty for every video run. */
import { postThreadArtifact, slideDeckArtifact } from "@maleo/shared";
import type { AgentJob, AgentPost, AgentSlide } from "./model.ts";
import { jobArtifactsOfKind } from "./artifact-store.ts";

export function slidesOf(job: AgentJob): AgentSlide[] {
	return structuredClone(jobArtifactsOfKind(job, slideDeckArtifact)[0]?.payload.slides ?? []);
}

/** Kinds the storyboard document already carries as its own fields (`slides`,
 *  `posts`). Persistence writes them there and not again in the document's
 *  artifact list, so the document holds one copy. */
export const DOCUMENT_FIELD_KINDS: ReadonlySet<string> = new Set([
	slideDeckArtifact.kind,
	postThreadArtifact.kind,
]);

export function postsOf(job: AgentJob): AgentPost[] {
	return structuredClone(jobArtifactsOfKind(job, postThreadArtifact)[0]?.payload.posts ?? []);
}
