import { PROMPT_FRAGMENTS } from "./image-director-prompt-definitions.ts";
import { renderPromptParts } from "@maleo/shared";
import { z } from "zod";
import {
	adjacentDuplicateBeatIndexes,
	beatVisualIntentSchema,
	bibleLocationIds,
	bibleSubjectIds,
	bindingIdentity,
	type BeatVisualIntent,
	type PovShot,
	type StoryBible,
	type StoryEditorialDecision,
	type StoryReferenceBinding,
} from "@maleo/shared";
import { runPrompt } from "../text-runner.ts";
import {
	lockedConstraintBlock,
	parseJson,
	type LockedVisualConstraints,
} from "./authoring-utils.ts";

/** One measured narration beat: the exact text the beat's image illustrates. */
export interface StoryBeatInput {
	text: string;
	durationSec?: number;
	povShot?: PovShot;
}

/** What the authoring call is told about the section the beats belong to. */
export interface StoryBeatSectionInput {
	title: string;
	narration: string;
}

export interface StoryBeatVisualOpts {
	/** Operator-approved planned shots — visual intent, not the provider prompt. */
	plannedShots?: readonly string[];
	/** Closed approved logical-reference set measured beats may select from. */
	approvedBindings?: readonly StoryReferenceBinding[];
	/** Approved whole-sequence decision for this semantic beat. */
	editorial?: StoryEditorialDecision;
	locked?: LockedVisualConstraints;
	/** Project Visual direction. */
	visual?: string;
	/** Rules materials — hard constraints, never softened by adaptation. */
	rules?: string;
	/** The locked style bible, as prose. Context for the author, never copied into
	 *  a beat: the style reaches the provider from `bible` at compile time. */
	style?: string;
	/** The story's visual constants, and the closed id lists a beat picks from. */
	bible?: StoryBible;
	/** Where the preceding beat left things, so this section continues from it.
	 *  Absent for the first beat of the first section. */
	previousEndState?: string;
	/** Narration language, so beat text is read in the language it was written. */
	language?: string;
}

const storyBeatVisualsSchema = z.object({
	visuals: z.array(beatVisualIntentSchema).min(1),
});
export type StoryBeatVisual = BeatVisualIntent;

type StoryBeatVisualAuthor = (
	section: StoryBeatSectionInput,
	beats: readonly StoryBeatInput[],
	opts?: StoryBeatVisualOpts,
) => Promise<unknown>;
let storyBeatVisualAuthorOverride: StoryBeatVisualAuthor | null = null;
export function setStoryBeatVisualAuthorForTests(fn: StoryBeatVisualAuthor | null): void {
	storyBeatVisualAuthorOverride = fn;
}

function asStoryBeatVisuals(result: unknown): StoryBeatVisual[] {
	return storyBeatVisualsSchema.parse(Array.isArray(result) ? { visuals: result } : result).visuals;
}

/** The counted invariants. Returns the violation's name, or undefined when the
 *  result is usable. Nothing here is tunable — every branch is a count or a set
 *  comparison. */
function storyBeatVisualViolation(
	visuals: readonly StoryBeatVisual[],
	beatCount: number,
	bible: StoryBible | undefined,
	approvedBindings: readonly StoryReferenceBinding[] | undefined,
): string | undefined {
	if (visuals.length !== beatCount)
		return `expected one visual per beat (${beatCount}), received ${visuals.length}`;
	const indexes = new Set(visuals.map((entry) => entry.beatIndex));
	if (indexes.size !== beatCount || visuals.some((entry) => entry.beatIndex >= beatCount)) {
		return `every beat index 0..${beatCount - 1} must appear exactly once, received ${[...indexes].sort((a, b) => a - b).join(",")}`;
	}
	const ordered = [...visuals].sort((a, b) => a.beatIndex - b.beatIndex);
	if (approvedBindings) {
		const approved = new Set(approvedBindings.map(bindingIdentity));
		const unknown = [
			...new Set(
				ordered
					.flatMap((beat) => (beat.referenceBindings ?? []).map(bindingIdentity))
					.filter((identity) => !approved.has(identity)),
			),
		];
		if (unknown.length)
			return `reference binding(s) not approved for this section: ${unknown.join(", ")}`;
	}
	/* Cast comes from a closed list. Without a bible there is no list to check. */
	if (bible) {
		const known = new Set(bibleSubjectIds(bible));
		const unknown = [
			...new Set(ordered.flatMap((beat) => beat.subjectIds.filter((id) => !known.has(id)))),
		];
		if (unknown.length) return `subject id(s) not in the story bible: ${unknown.join(", ")}`;
		const knownLocations = new Set(bibleLocationIds(bible));
		const strayLocations = [
			...new Set(
				ordered
					.map((beat) => beat.locationId)
					.filter((id): id is string => Boolean(id) && !knownLocations.has(id!)),
			),
		];
		if (strayLocations.length)
			return `location id(s) not in the story bible: ${strayLocations.join(", ")}`;
	}
	const duplicates = adjacentDuplicateBeatIndexes(ordered);
	if (duplicates.length)
		return `adjacent beats ${duplicates.map((index) => `${index}/${index + 1}`).join(", ")} repeat the same visual`;
	return undefined;
}

function closedListBlock(bible: StoryBible | undefined): string {
	if (!bible) return "";
	const subjects = bible.subjects
		.map((subject) =>
			renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment0.parts, [
				subject.id,
				subject.label,
				subject.descriptors.length
					? renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment1.parts, [
							subject.descriptors.join(PROMPT_FRAGMENTS.closedListBlockFragment2.parts[0]),
						])
					: "",
			]),
		)
		.join(PROMPT_FRAGMENTS.closedListBlockFragment3.parts[0]);
	const locations = bible.locations
		.map((location) =>
			renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment4.parts, [
				location.id,
				location.label,
				location.descriptors.length
					? renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment5.parts, [
							location.descriptors.join(PROMPT_FRAGMENTS.closedListBlockFragment6.parts[0]),
						])
					: "",
			]),
		)
		.join(PROMPT_FRAGMENTS.closedListBlockFragment7.parts[0]);
	return renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment8.parts, [
		subjects || PROMPT_FRAGMENTS.closedListBlockFragment9.parts[0],
		locations
			? renderPromptParts(PROMPT_FRAGMENTS.closedListBlockFragment10.parts, [locations])
			: "",
	]);
}

export function storyBeatVisualPrompt(
	section: StoryBeatSectionInput,
	beats: readonly StoryBeatInput[],
	opts: StoryBeatVisualOpts | undefined,
): string {
	const beatLines = beats
		.map((beat, index) => {
			const pov = beat.povShot
				? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment0.parts, [
						[
							beat.povShot.cameraRole
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment1.parts, [
										beat.povShot.cameraRole,
									])
								: "",
							beat.povShot.location
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment2.parts, [
										beat.povShot.location,
									])
								: "",
							beat.povShot.bodyAction
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment3.parts, [
										beat.povShot.bodyAction,
									])
								: "",
							beat.povShot.propFocus
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment4.parts, [
										beat.povShot.propFocus,
									])
								: "",
							beat.povShot.emotionalPressure
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment5.parts, [
										beat.povShot.emotionalPressure,
									])
								: "",
							beat.povShot.noveltyKey
								? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment6.parts, [
										beat.povShot.noveltyKey,
									])
								: "",
						]
							.filter(Boolean)
							.join(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment7.parts[0]),
					])
				: "";
			return renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment8.parts, [
				index,
				(beat.durationSec ?? 0).toFixed(1),
				beat.text.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment9.parts[0]).trim(),
				pov,
			]);
		})
		.join(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment10.parts[0]);
	const intent = (opts?.plannedShots ?? [])
		.filter((shot) => shot.trim())
		.map((shot, index) =>
			renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment11.parts, [
				index + 1,
				shot.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment12.parts[0]).trim(),
			]),
		)
		.join(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment13.parts[0]);
	const approvedBindings = opts?.approvedBindings?.length
		? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment14.parts, [
				JSON.stringify(opts.approvedBindings),
			])
		: "";
	const editorial = opts?.editorial;
	const editorialBlock = editorial
		? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment15.parts, [
				editorial.purpose,
				editorial.presentation,
				editorial.visualConcept,
				editorial.noveltyKey,
				editorial.onScreenText ?? PROMPT_FRAGMENTS.storyBeatVisualPromptFragment16.parts[0],
				editorial.sfxCue ?? PROMPT_FRAGMENTS.storyBeatVisualPromptFragment17.parts[0],
			])
		: "";
	return renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment18.parts, [
		beats.length,
		section.title,
		opts?.language
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment19.parts, [opts.language])
			: "",
		section.narration
			.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment20.parts[0])
			.trim(),
		beatLines,
		editorialBlock,
		approvedBindings,
		opts?.previousEndState?.trim()
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment21.parts, [
					opts.previousEndState
						.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment22.parts[0])
						.trim(),
				])
			: "",
		closedListBlock(opts?.bible),
		intent
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment23.parts, [intent])
			: "",
		opts?.style?.trim()
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment24.parts, [
					opts.style
						.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment25.parts[0])
						.trim(),
				])
			: "",
		opts?.visual?.trim()
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment26.parts, [
					opts.visual
						.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment27.parts[0])
						.trim(),
				])
			: "",
		opts?.rules?.trim()
			? renderPromptParts(PROMPT_FRAGMENTS.storyBeatVisualPromptFragment28.parts, [
					opts.rules
						.replace(/\s+/g, PROMPT_FRAGMENTS.storyBeatVisualPromptFragment29.parts[0])
						.trim(),
				])
			: "",
		lockedConstraintBlock(opts?.locked),
		beats.length,
		beats.length - 1,
	]);
}

/** Author one structured visual intent per measured narration beat.
 *
 *  Throws — never degrades. The caller marks the section failed and retryable;
 *  reusing another beat's prompt is exactly the behaviour this replaced. */
export async function authorStoryBeatVisuals(
	section: StoryBeatSectionInput,
	beats: readonly StoryBeatInput[],
	opts?: StoryBeatVisualOpts,
): Promise<StoryBeatVisual[]> {
	if (!beats.length) return [];
	const attempt = async (): Promise<StoryBeatVisual[]> => {
		if (storyBeatVisualAuthorOverride)
			return asStoryBeatVisuals(await storyBeatVisualAuthorOverride(section, beats, opts));
		const { stdout } = await runPrompt(storyBeatVisualPrompt(section, beats, opts), {
			timeoutMs: 180_000,
		});
		return asStoryBeatVisuals(parseJson(stdout));
	};
	let violation: string | undefined;
	// One retry, then loud. A second wrong answer is a signal, not a rounding error.
	for (let tries = 0; tries < 2; tries++) {
		let visuals: StoryBeatVisual[];
		try {
			visuals = await attempt();
		} catch (err) {
			violation = err instanceof Error ? err.message : String(err);
			continue;
		}
		violation = storyBeatVisualViolation(
			visuals,
			beats.length,
			opts?.bible,
			opts?.approvedBindings,
		);
		if (!violation) return [...visuals].sort((a, b) => a.beatIndex - b.beatIndex);
	}
	throw new Error(`Per-beat visual authoring failed for "${section.title}": ${violation}`);
}
