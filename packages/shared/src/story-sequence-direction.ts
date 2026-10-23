import { z } from "zod";
import { PRESENTATION_CATEGORIES } from "./video-presentation.ts";
import { storyPlannedReferenceSchema } from "./story-plan.ts";
import {
	storyPlannedShotDirectionSchema,
	storyReferenceAliasSchema,
} from "./story-visual-direction.ts";

export const STORY_EDITORIAL_PURPOSES = [
	"establish",
	"explain",
	"contrast",
	"reveal",
	"consequence",
	"resolve",
] as const;
export type StoryEditorialPurpose = (typeof STORY_EDITORIAL_PURPOSES)[number];

/* Plans stored before infographics were removed may carry the `infographic`
 * presentation and a `motionGraphic` decision. The read keeps the beat: the
 * presentation reads as `narrative` and the motion graphic is dropped. */
function dropStoredInfographicDecision(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
	const rest = Object.fromEntries(Object.entries(value).filter(([key]) => key !== "motionGraphic"));
	return rest.presentation === "infographic" ? { ...rest, presentation: "narrative" } : rest;
}

export const storyEditorialDecisionSchema = z.preprocess(
	dropStoredInfographicDecision,
	z
		.object({
			purpose: z.enum(STORY_EDITORIAL_PURPOSES),
			presentation: z.enum(PRESENTATION_CATEGORIES),
			visualConcept: z.string().trim().min(1).max(500),
			noveltyKey: z.string().trim().min(1).max(120),
			onScreenText: z.string().trim().min(1).max(160).optional(),
			sfxCue: z.string().trim().min(1).max(160).nullable().default(null),
			/* Per planned shot: what it shows and which references it binds. Optional
			 * because plans persisted before visual direction carry none, and a read must
			 * not invent them. New canonical plans require it (see storyVisualDirection). */
			shots: z.array(storyPlannedShotDirectionSchema).optional(),
		})
		.strict(),
);
export type StoryEditorialDecision = z.infer<typeof storyEditorialDecisionSchema>;

export const storySequenceDirectionSchema = z
	.object({
		beats: z.array(
			z
				.object({
					beatId: z.string().min(1),
					editorial: storyEditorialDecisionSchema,
				})
				.strict(),
		),
		/* Optional at the read boundary for persisted/legacy direction. New canonical
		 * planning requires both and validates them before approval. */
		plannedReferences: z.array(storyPlannedReferenceSchema).max(12).optional(),
		referenceAliases: z.array(storyReferenceAliasSchema).optional(),
	})
	.strict();
export type StorySequenceDirection = z.infer<typeof storySequenceDirectionSchema>;

export type StorySequenceDirectionInvariant =
	| "missing_direction"
	| "repeated_treatment"
	| "repeated_sfx"
	| "native_text_in_image";

export interface StorySequenceDirectionViolation {
	invariant: StorySequenceDirectionInvariant;
	beatIds: string[];
	detail: string;
}

export interface DirectedStoryBeat {
	id: string;
	editorial?: StoryEditorialDecision;
}

function normalized(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/** Exact structural checks only. All-absent input is legacy unless direction is required. */
export function storySequenceDirectionViolations(
	beats: readonly DirectedStoryBeat[],
	options: { requireDirection?: boolean } = {},
): StorySequenceDirectionViolation[] {
	const directed = beats.filter((beat) => beat.editorial).length;
	if (!options.requireDirection && directed === 0) return [];
	const violations: StorySequenceDirectionViolation[] = [];
	for (const beat of beats) {
		if (!beat.editorial)
			violations.push({
				invariant: "missing_direction",
				beatIds: [beat.id],
				detail: `beat ${beat.id} has no editorial direction`,
			});
	}
	for (let index = 0; index < beats.length; index++) {
		const beat = beats[index]!;
		const editorial = beat.editorial;
		if (!editorial) continue;
		if (editorial.onScreenText) {
			const text = normalized(editorial.onScreenText);
			if (text && normalized(editorial.visualConcept).includes(text))
				violations.push({
					invariant: "native_text_in_image",
					beatIds: [beat.id],
					detail: `${beat.id}: native on-screen text is repeated in image concept`,
				});
		}
		if (index === 0) continue;
		const previous = beats[index - 1]!;
		const prior = previous.editorial;
		if (!prior) continue;
		if (
			prior.presentation === editorial.presentation &&
			normalized(prior.noveltyKey) === normalized(editorial.noveltyKey)
		) {
			violations.push({
				invariant: "repeated_treatment",
				beatIds: [previous.id, beat.id],
				detail: `${previous.id}/${beat.id}: adjacent presentation and novelty repeat`,
			});
		}
		if (
			prior.sfxCue &&
			editorial.sfxCue &&
			normalized(prior.sfxCue) === normalized(editorial.sfxCue)
		) {
			violations.push({
				invariant: "repeated_sfx",
				beatIds: [previous.id, beat.id],
				detail: `${previous.id}/${beat.id}: adjacent SFX cue repeats`,
			});
		}
	}
	return violations;
}

/** True when every recorded error is an `invalid_infographic` error. Plans stored
 *  before infographics were removed may carry only those; the read maps their
 *  beats to `narrative`, so approval lets them through and generation re-checks
 *  the plan before any provider spend. */
export function onlyStoredInfographicDirectionErrors(
	errors: readonly string[] | undefined,
): boolean {
	return !!errors?.length && errors.every((error) => error.startsWith("invalid_infographic:"));
}

export function storySequenceDirectionError(
	violations: readonly StorySequenceDirectionViolation[],
): string {
	return violations.map((violation) => `${violation.invariant}: ${violation.detail}`).join("; ");
}
