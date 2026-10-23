/* Re-direct an existing plan's sections, for whoever is about to approve it.
 *
 * Chat repaired stale direction before approving and the editor did not, so the
 * same plan approved in one surface and dead-ended in the other. The repair is
 * one call with no store in it: it takes sections and direction inputs, returns
 * directed sections or the blocker that stopped it, and leaves persistence to
 * the caller — the two callers write to different places (a run's plan, a
 * project document) and that is the only thing that differs between them. */
import {
	directStorySequence,
	type StoryDirectionOptions,
} from "../../../../lib/story/creative-director.ts";
import type { StorySection } from "../../../../lib/story.ts";

/** The reference fields direction itself produces — taken from its own return
 *  type so this module never re-declares a shape it does not own. */
type Directed = Awaited<ReturnType<typeof directStorySequence>>;

/** The direction inputs, minus the two this call always decides for itself. */
export type DirectionRepairOptions = Omit<StoryDirectionOptions, "authoritativeReferences">;

export type DirectionRepairResult =
	| {
			ok: true;
			sections: StorySection[];
			plannedReferences: Directed["plannedReferences"];
			referenceAliases: Directed["referenceAliases"];
	  }
	| {
			ok: false;
			plannedReferences: Directed["plannedReferences"];
			referenceAliases: Directed["referenceAliases"];
			directionBlocked?: boolean;
			directionErrors: string[];
	  };

export async function redirectStorySections(
	sections: readonly StorySection[],
	options: DirectionRepairOptions,
): Promise<DirectionRepairResult> {
	const draft = sections.map((section) => ({
		id: section.sectionId ?? section.id,
		semanticBeatId: section.semanticBeatId ?? section.id,
		title: section.title,
		narration: section.narration,
		visualPrompt: section.visualPrompt,
		shots: section.visualPrompts,
		requiredReferences: section.requiredReferences,
		sourceEvidence: section.sourceEvidence,
	}));
	const directed = await directStorySequence(draft, { ...options, authoritativeReferences: true });
	if (directed.needsDirection) {
		return {
			ok: false,
			plannedReferences: directed.plannedReferences,
			referenceAliases: directed.referenceAliases,
			directionBlocked: directed.directionBlocked,
			directionErrors: directed.directionErrors ?? [],
		};
	}
	const editorial = new Map(
		directed.sections.map((section) => [section.semanticBeatId, section.editorial]),
	);
	return {
		ok: true,
		sections: sections.map((section) => ({
			...section,
			editorial: editorial.get(section.semanticBeatId ?? section.id),
		})),
		plannedReferences: directed.plannedReferences,
		referenceAliases: directed.referenceAliases,
	};
}
