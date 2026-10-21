/* What one measured narration beat shows — and nothing about how the story looks.
 *
 * The omissions are the design. There is no medium, realism, treatment, lighting,
 * palette or negative field here, so a model authoring a beat cannot restate the
 * story's constants: it has nowhere to put them, and a result that carries them
 * fails parsing rather than quietly winning over the bible. Those constants live
 * in `StoryBible` and are rendered identically into every beat.
 *
 * `subjectIds` and `locationId` are drawn from the bible's closed id lists. Free
 * text there would push the story→image link back onto string matching, which is
 * exactly the mechanism whose failure this change exists to correct. */
import { z } from "zod";
import { storyReferenceBindingSchema } from "./story-visual-direction.ts";

const optionalText = z.preprocess(
	(value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
	z.string().min(1).optional(),
);

export const beatVisualIntentSchema = z
	.object({
		beatIndex: z.coerce.number().int().min(0),
		/** Bible subject ids appearing in this beat. */
		subjectIds: z.array(z.string().min(1)).default([]),
		/** Bible location id this beat happens in. */
		locationId: z.string().min(1).optional(),
		/** What the frame shows. The one required field: a beat with no moment has no picture. */
		visualMoment: z.string().min(1),
		action: optionalText,
		/** Where the beat leaves things — fed to the NEXT beat as continuity. */
		endState: optionalText,
		shotType: optionalText,
		cameraAngle: optionalText,
		framing: optionalText,
		mustInclude: z.array(z.string().min(1)).default([]),
		mustAvoid: z.array(z.string().min(1)).default([]),
		/** What makes this beat unlike its neighbours, in the planner's own terms. */
		noveltyKey: optionalText,
		/** Overrides the bible's default mood for this beat only. */
		mood: optionalText,
		/** Ordered approved logical references selected for this measured beat. */
		referenceBindings: z.array(storyReferenceBindingSchema).optional(),
	})
	.strict();

export type BeatVisualIntent = z.infer<typeof beatVisualIntentSchema>;

/** The fields two adjacent beats are compared on.
 *
 *  Structured, because the previous check normalized a composed string — and the
 *  rendered style block is identical across a story's beats by design, so a string
 *  comparison now measures mostly the constant. */
export interface BeatVisualIdentity {
	visualMoment: string;
	shotType: string;
	cameraAngle: string;
	locationId: string;
	subjectIds: string;
}

function normalize(value: string | undefined): string {
	return (value ?? "")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

export function beatVisualIdentity(beat: BeatVisualIntent): BeatVisualIdentity {
	return {
		visualMoment: normalize(beat.visualMoment),
		shotType: normalize(beat.shotType),
		cameraAngle: normalize(beat.cameraAngle),
		locationId: normalize(beat.locationId),
		subjectIds: [...beat.subjectIds].sort().join("|").toLocaleLowerCase(),
	};
}

/** Two beats that would render the same picture: equal on every compared field. */
export function sameBeatVisual(a: BeatVisualIntent, b: BeatVisualIntent): boolean {
	const left = beatVisualIdentity(a);
	const right = beatVisualIdentity(b);
	return (
		left.visualMoment === right.visualMoment &&
		left.shotType === right.shotType &&
		left.cameraAngle === right.cameraAngle &&
		left.locationId === right.locationId &&
		left.subjectIds === right.subjectIds
	);
}

/** Adjacent pairs that match. Returns the lower index of each pair. */
export function adjacentDuplicateBeatIndexes(beats: readonly BeatVisualIntent[]): number[] {
	const duplicates: number[] = [];
	for (let i = 1; i < beats.length; i++) {
		if (sameBeatVisual(beats[i - 1]!, beats[i]!)) duplicates.push(i - 1);
	}
	return duplicates;
}
