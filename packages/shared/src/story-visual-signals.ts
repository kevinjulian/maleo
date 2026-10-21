/* Story visual-beat signals — counted, never thresholded.
 *
 * One authored visual per measured narration beat is the contract. These count
 * how far a set of generated sections is from it: how many beats each planned
 * shot had to cover, how many adjacent beats show the same picture, and how many
 * beat→shot steps ran backwards in the reconciliation layer that used to exist.
 *
 * Every figure here is a count or a ratio of counts. There is no similarity
 * threshold, because "these two are 71% alike" needs a tunable number and a
 * tunable number is where a quality signal goes to die. */
import { sameBeatVisual, type BeatVisualIntent } from "./beat-visual-intent.ts";
import {
	documentArtifactList,
	documentArtifacts,
	storyPlanArtifactOf,
} from "./pipeline-artifact-kinds.ts";

/** Style and timeline-guidance layers are appended per shot and carry no
 *  per-beat content, so they are cut before comparing. Boilerplate phrases every
 *  prompt repeats are dropped for the same reason. */
const STORY_PROMPT_BOILERPLATE_RE =
	/\b(?:no humans?|no human hands?|no text|cinematic documentary illustration|macro documentary illustration|storybook hand drawing with bright tone)\b/gi;

/* Prompts written before per-beat authoring carry a `Final visual beat N/M:`
 * label and a canned `composition:` rotation appended after the planned prompt.
 * Both differ per beat regardless of whether the visual content is identical,
 * which is exactly why the duplicate check could never fire. Cutting the label
 * and everything after it recovers the authored (then: planned) visual, so a
 * legacy row and a freshly authored one are measured the same way. */
const LEGACY_BEAT_LABEL_RE = /,?\s*Final visual beat\s*\d+\s*\/\s*\d+\s*:[\s\S]*$/i;

/** The authored visual a prompt carries, with the legacy per-beat suffix removed. */
export function authoredStoryVisualText(prompt: string): string {
	return (prompt || "").replace(LEGACY_BEAT_LABEL_RE, "").trim();
}

export function normalizeStoryImagePromptForDuplicateCheck(prompt: string): string {
	return prompt
		.toLocaleLowerCase()
		.replace(/style:\s*[\s\S]*$/i, "")
		.replace(/timeline guidance:\s*[\s\S]*$/i, "")
		.replace(STORY_PROMPT_BOILERPLATE_RE, "")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function adjacentDuplicateStoryImagePromptIndexes(prompts: readonly string[]): number[] {
	const duplicates: number[] = [];
	for (let index = 1; index < prompts.length; index++) {
		const prev = normalizeStoryImagePromptForDuplicateCheck(prompts[index - 1] ?? "");
		const next = normalizeStoryImagePromptForDuplicateCheck(prompts[index] ?? "");
		if (prev && prev === next) duplicates.push(index);
	}
	return duplicates;
}

/** The shape the signals read. Deliberately structural: the scan reads persisted
 *  storyboard JSON and the quality report reads a live plan, and neither should
 *  have to agree on anything but these fields. */
export interface StoryVisualBeatSection {
	visualPrompts?: readonly string[];
	visualSegments?: ReadonlyArray<{ visualPrompt: string; intent?: BeatVisualIntent }>;
}

/* Two adjacent beats that would render the same picture.
 *
 * Structured when both beats carry intent, prose when either does not. The
 * fallback is not a nicety: every storyboard written before this change carries
 * prose alone, and a signal that silently reported 0% reuse for them would be
 * worse than one that keeps measuring them the old way.
 *
 * This is the SAME predicate the pre-submission gate uses, so a project's recorded
 * reuse figure and its generation-time duplicate check cannot disagree — they did
 * once, when one ran on composed strings and the other on authored text. */
function beatsRepeat(
	previous: { visualPrompt: string; intent?: BeatVisualIntent },
	next: { visualPrompt: string; intent?: BeatVisualIntent },
): boolean {
	if (previous.intent && next.intent) return sameBeatVisual(previous.intent, next.intent);
	const a = normalizeStoryImagePromptForDuplicateCheck(
		authoredStoryVisualText(previous.visualPrompt),
	);
	const b = normalizeStoryImagePromptForDuplicateCheck(authoredStoryVisualText(next.visualPrompt));
	return Boolean(a) && a === b;
}

/** The story plan's sections as persisted inside a storyboard document, for the
 *  two readers that measure them: the repeatable scan over `content_storyboards`
 *  and the project quality report. Structural and defensive — a document without
 *  a story plan simply yields nothing. */
export function storyPlanVisualSections(storyboard: unknown): StoryVisualBeatSection[] {
	return (
		storyPlanArtifactOf(documentArtifacts(documentArtifactList(storyboard)))?.payload.sections ?? []
	);
}

export interface StoryVisualBeatSignals {
	/** Sections carrying generated visual beats. Everything below counts over these. */
	sections: number;
	beats: number;
	plannedShots: number;
	/** Adjacent beat pairs considered, and how many of those repeat a visual. */
	adjacentPairs: number;
	adjacentReuse: number;
	/** Absent (null) when there is nothing to count, never a passing value. */
	beatsPerPlannedShot: number | null;
	visualBeatReusePct: number | null;
	/** Beat→shot steps running backwards — zero once assignment stops existing. */
	nonMonotonicSteps: number;
}

const EMPTY: StoryVisualBeatSignals = {
	sections: 0,
	beats: 0,
	plannedShots: 0,
	adjacentPairs: 0,
	adjacentReuse: 0,
	beatsPerPlannedShot: null,
	visualBeatReusePct: null,
	nonMonotonicSteps: 0,
};

function round(value: number, places: number): number {
	const factor = 10 ** places;
	return Math.round(value * factor) / factor;
}

export function storyVisualBeatSignals(
	sections: readonly StoryVisualBeatSection[],
): StoryVisualBeatSignals {
	const generated = sections.filter((section) => (section.visualSegments?.length ?? 0) > 0);
	if (!generated.length) return EMPTY;
	let beats = 0;
	let plannedShots = 0;
	let adjacentPairs = 0;
	let adjacentReuse = 0;
	let nonMonotonicSteps = 0;
	for (const section of generated) {
		const segments = section.visualSegments ?? [];
		const planned = (section.visualPrompts?.length ? section.visualPrompts : []).map((prompt) =>
			normalizeStoryImagePromptForDuplicateCheck(authoredStoryVisualText(prompt)),
		);
		beats += segments.length;
		plannedShots += planned.length || 1;
		const normalized = segments.map((segment) =>
			normalizeStoryImagePromptForDuplicateCheck(authoredStoryVisualText(segment.visualPrompt)),
		);
		for (let index = 1; index < segments.length; index++) {
			adjacentPairs++;
			if (beatsRepeat(segments[index - 1]!, segments[index]!)) adjacentReuse++;
		}
		// Which planned shot each beat ended up showing. A step backwards means the
		// beat→shot assignment ran the images out of narration order.
		const assigned = normalized.map((text) => planned.indexOf(text));
		for (let index = 1; index < assigned.length; index++) {
			const prev = assigned[index - 1]!;
			const next = assigned[index]!;
			if (prev >= 0 && next >= 0 && next < prev) nonMonotonicSteps++;
		}
	}
	return {
		sections: generated.length,
		beats,
		plannedShots,
		adjacentPairs,
		adjacentReuse,
		beatsPerPlannedShot: plannedShots > 0 ? round(beats / plannedShots, 2) : null,
		visualBeatReusePct: adjacentPairs > 0 ? round((adjacentReuse / adjacentPairs) * 100, 1) : null,
		nonMonotonicSteps,
	};
}
