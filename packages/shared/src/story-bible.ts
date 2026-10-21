/* The Story Bible — a story's visual constants, recorded once at plan time.
 *
 * This exists because the constants used to be re-authored per beat. A section's
 * four consecutive beats each spelled the same style lock differently ("Simple
 * hand-drawn sketch and watercolor on pure #FFFFFF white background", "Simple
 * hand-drawn watercolor sketch on #FFFFFF", …), and composition then appended the
 * whole lock a second time in the plan's own language. A style described four ways
 * across four shots renders four slightly different worlds.
 *
 * So the constants live here and nowhere else: beat authoring has no field to put
 * them in (see `beatVisualIntentSchema`), and compilation renders them identically
 * into every beat of the story. What varies beat to beat is the subject, the
 * moment, and the camera — nothing more.
 *
 * `summary` is the prose the planner used to store in `visualStyle`, kept for the
 * plan table and script view. It is display only; nothing compiles from it. */
import { z } from "zod";

const optionalText = z.preprocess(
	(value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
	z.string().min(1).optional(),
);

/* A recurring subject. `aliases` are the names the NARRATION uses for it, which is
 * what makes the story→image link checkable by counting rather than by a model: an
 * alias present in a beat's narration must appear in that beat's subject ids.
 *
 * `refKey` links to a planned reference when one exists. The resolved reference
 * description stays the locked identity (generation-prompt-composition already says
 * so); these descriptors are additive detail, not a competing definition. */
export const storyBibleSubjectSchema = z
	.object({
		id: z.string().min(1),
		label: z.string().min(1),
		aliases: z.array(z.string().min(1)).default([]),
		descriptors: z.array(z.string().min(1)).default([]),
		mustAvoid: z.array(z.string().min(1)).default([]),
		refKey: z.string().min(1).optional(),
		/** Set instead of `refKey` when direction bound an existing roster entity. A
		 *  subject carries at most one of the two; neither means it is descriptive. */
		entityId: z.string().min(1).optional(),
	})
	.strict()
	.refine((subject) => !(subject.refKey && subject.entityId), {
		message: "a bible subject links to one reference, not two",
	});
export type StoryBibleSubject = z.infer<typeof storyBibleSubjectSchema>;

export const storyBibleLocationSchema = z
	.object({
		id: z.string().min(1),
		label: z.string().min(1),
		descriptors: z.array(z.string().min(1)).default([]),
		refKey: z.string().min(1).optional(),
		entityId: z.string().min(1).optional(),
	})
	.strict()
	.refine((location) => !(location.refKey && location.entityId), {
		message: "a bible location links to one reference, not two",
	});
export type StoryBibleLocation = z.infer<typeof storyBibleLocationSchema>;

/* Free text, deliberately. The closed vocabulary lives on `PovShot.cameraRole`,
 * where it already earns its keep; a second closed set here would have to agree
 * with it forever. */
export const storyBibleCameraLanguageSchema = z
	.object({
		defaultShot: optionalText,
		angleVocabulary: z.array(z.string().min(1)).default([]),
	})
	.strict();

export const storyBibleSchema = z
	.object({
		subjects: z.array(storyBibleSubjectSchema).default([]),
		locations: z.array(storyBibleLocationSchema).default([]),
		medium: optionalText,
		realism: optionalText,
		visualTreatment: optionalText,
		lighting: optionalText,
		palette: optionalText,
		moodDefault: optionalText,
		cameraLanguage: storyBibleCameraLanguageSchema.optional(),
		negatives: z.array(z.string().min(1)).default([]),
		/** The prose form, for plan review. Never compiled from. */
		summary: optionalText,
	})
	.strict();
export type StoryBible = z.infer<typeof storyBibleSchema>;

/** The closed id list beat authoring picks subjects from. */
export function bibleSubjectIds(bible: StoryBible | undefined): string[] {
	return (bible?.subjects ?? []).map((subject) => subject.id);
}

/** The closed id list beat authoring picks a location from. */
export function bibleLocationIds(bible: StoryBible | undefined): string[] {
	return (bible?.locations ?? []).map((location) => location.id);
}

function normalizeAlias(value: string): string {
	return value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

/* Subjects whose narration aliases appear in this beat's text.
 *
 * Word-boundary matched on a normalized copy of both sides, so an alias is found
 * regardless of case or surrounding punctuation but "bee" does not match "been".
 * Aliases are planner-authored precisely so this stays a set membership test and
 * never becomes a similarity score. */
export function bibleSubjectsNamedIn(bible: StoryBible | undefined, narration: string): string[] {
	const haystack = ` ${normalizeAlias(narration)} `;
	return (bible?.subjects ?? [])
		.filter((subject) =>
			[subject.label, ...subject.aliases]
				.map(normalizeAlias)
				.filter(Boolean)
				.some((alias) => haystack.includes(` ${alias} `)),
		)
		.map((subject) => subject.id);
}
