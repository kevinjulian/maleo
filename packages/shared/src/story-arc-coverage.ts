/* Narrative coverage over a drafted plan — the arc's counterpart to
 * `story-beat-coverage.ts`.
 *
 * Five checks, each a count, a set comparison, or an arithmetic position. Nothing
 * here asks a model whether the story works; it asks whether the plan matches the
 * arc it claims. The `engagement` spine used to be written once and never read
 * against the sections meant to deliver it — that is the gap this closes.
 *
 * The SEVERITY differs from beat coverage, deliberately. A duplicate or uncast
 * image wastes a provider call and ships a visible defect, so beat coverage
 * hard-fails before submission. A midpoint at 0.62 of runtime is a pacing opinion.
 * These violations are REPORTED: nothing here marks a section failed, blocks
 * approval, or prevents image generation. */
import { oneOf } from "./one-of.ts";
import {
	documentArtifactList,
	documentArtifacts,
	storyPlanArtifactOf,
} from "./pipeline-artifact-kinds.ts";
import { STORY_ARCS, storyArcFunctionSlots, storyArcSpec, type StoryArc } from "./story-arc.ts";

export type StoryArcInvariant =
	| "functions_present"
	| "functions_ordered"
	| "midpoint_position"
	| "turn_fulfilled"
	| "emotion_not_flat";

export interface StoryArcCoverageViolation {
	invariant: StoryArcInvariant;
	/** Human-facing, and specific enough to act on without opening the run. */
	detail: string;
}

export interface StoryArcCoverageSection {
	chapterFunction?: string;
	emotion?: string;
	/** Estimated seconds, so a position is a fraction of runtime rather than of
	 *  section count. Absent everywhere → sections are weighted equally. */
	estimatedDurationSec?: number;
	narration?: string;
}

export interface StoryArcCoverageInput {
	/** Absent for a plan drafted before arcs existed. Yields no signals. */
	arc?: StoryArc;
	sections: readonly StoryArcCoverageSection[];
	/** The story spine. Only its `turn` participates in a countable check. */
	engagement?: { turn?: string };
	/** Which section the plan says delivers the engagement turn, when the draft
	 *  named one. Absent means the check falls back to the turn-function section. */
	turnSectionIndex?: number;
}

/** How many distinct emotions a plan needs before its music arc stops being flat. */
const MIN_DISTINCT_EMOTIONS = 3;

/* Where each section starts and ends as a fraction of total runtime. Estimated
 * durations when the plan has them, equal weight when it does not — a plan whose
 * sections are all unmeasured still has an order, and an order is enough to say
 * whether the midpoint sits near the middle. */
function sectionSpans(
	sections: readonly StoryArcCoverageSection[],
): Array<{ start: number; end: number }> {
	const weights = sections.map((section) =>
		(section.estimatedDurationSec ?? 0) > 0 ? section.estimatedDurationSec! : 0,
	);
	const total = weights.reduce((sum, weight) => sum + weight, 0);
	const even = total <= 0;
	const spans: Array<{ start: number; end: number }> = [];
	let at = 0;
	for (const weight of weights) {
		const share = even ? 1 / sections.length : weight / total;
		spans.push({ start: at, end: at + share });
		at += share;
	}
	return spans;
}

export function storyArcCoverageViolations(
	input: StoryArcCoverageInput,
): StoryArcCoverageViolation[] {
	const { arc, sections } = input;
	if (!arc || sections.length === 0) return [];
	const spec = storyArcSpec(arc);
	const order = spec.functions.map((fn) => fn.key);
	const violations: StoryArcCoverageViolation[] = [];

	/* 1. Every function the plan's own section count called for is present.
	 *
	 * Checked against the slots the skeleton derives for THIS section count, not
	 * against the whole arc: a four-section plan on a nine-function arc compresses
	 * by design, and demanding all nine would report a violation the plan could not
	 * have avoided. */
	const expected = [...new Set(storyArcFunctionSlots(arc, sections.length).map((fn) => fn.key))];
	const present = new Set(sections.map((section) => section.chapterFunction).filter(Boolean));
	const missing = expected.filter((key) => !present.has(key));
	if (missing.length) {
		violations.push({
			invariant: "functions_present",
			detail: `${spec.label} arc function(s) never assigned to a section: ${missing.join(", ")}`,
		});
	}

	/* 2. Functions appear in the arc's canonical order.
	 *
	 * Sections carrying no function are skipped rather than failing — an undrafted
	 * slot has no opinion about order. An unknown function is reported here too,
	 * because a section claiming a function this arc does not have is exactly the
	 * drift the vocabulary-from-the-arc rule exists to prevent. */
	const outOfOrder: string[] = [];
	const unknown: string[] = [];
	let highest = -1;
	for (const [index, section] of sections.entries()) {
		const key = section.chapterFunction;
		if (!key) continue;
		const at = order.indexOf(key);
		if (at < 0) {
			unknown.push(`${index + 1}:${key}`);
			continue;
		}
		if (at < highest) outOfOrder.push(`${index + 1}:${key}`);
		else highest = at;
	}
	if (unknown.length) {
		violations.push({
			invariant: "functions_ordered",
			detail: `section(s) ${unknown.join(", ")} carry a function the ${spec.label} arc does not define`,
		});
	}
	if (outOfOrder.length) {
		violations.push({
			invariant: "functions_ordered",
			detail: `section(s) ${outOfOrder.join(", ")} come after a later ${spec.label} function; canonical order is ${order.join(" → ")}`,
		});
	}

	// 3. The midpoint function sits inside its position window.
	const midpointAt = sections.findIndex((section) => section.chapterFunction === spec.midpointKey);
	const midpointFn = spec.functions.find((fn) => fn.key === spec.midpointKey);
	if (midpointAt >= 0 && midpointFn) {
		const span = sectionSpans(sections)[midpointAt]!;
		const observed = (span.start + span.end) / 2;
		const { start, end } = midpointFn.positionWindow;
		if (observed < start || observed > end) {
			violations.push({
				invariant: "midpoint_position",
				detail: `"${spec.midpointKey}" sits at ${observed.toFixed(2)} of estimated runtime (section ${midpointAt + 1}); its window is ${start.toFixed(2)}–${end.toFixed(2)}`,
			});
		}
	}

	/* 4. The engagement turn maps to the section carrying the arc's turn function.
	 *
	 * Only checkable when the plan actually wrote a turn. Comparing the prose of
	 * `engagement.turn` against narration would need a similarity score, which is
	 * where a quality signal goes to die; what is countable is WHICH section the
	 * plan says delivers it, and whether that section was ever drafted. */
	const turn = input.engagement?.turn?.trim();
	if (turn) {
		const turnAt = sections.findIndex((section) => section.chapterFunction === spec.turnKey);
		if (turnAt < 0) {
			violations.push({
				invariant: "turn_fulfilled",
				detail: `the plan states a turn but no section carries the ${spec.label} turn function "${spec.turnKey}"`,
			});
		} else if (input.turnSectionIndex != null && input.turnSectionIndex !== turnAt) {
			violations.push({
				invariant: "turn_fulfilled",
				detail: `the turn is mapped to section ${input.turnSectionIndex + 1}, but "${spec.turnKey}" is on section ${turnAt + 1}`,
			});
		} else if (!sections[turnAt]!.narration?.trim()) {
			violations.push({
				invariant: "turn_fulfilled",
				detail: `section ${turnAt + 1} carries "${spec.turnKey}" but has no narration, so the turn is never delivered`,
			});
		}
	}

	/* 5. The emotional arc is not flat.
	 *
	 * `emotion` selects each section's background music, so one repeated value is a
	 * flat score under a story that is supposed to move. Skipped below three
	 * sections, where three distinct emotions is arithmetic rather than craft. */
	if (sections.length >= MIN_DISTINCT_EMOTIONS) {
		const distinct = new Set(sections.map((section) => section.emotion).filter(Boolean));
		if (distinct.size < MIN_DISTINCT_EMOTIONS) {
			violations.push({
				invariant: "emotion_not_flat",
				detail: `${distinct.size} distinct emotion(s) across ${sections.length} sections (${[...distinct].join(", ") || "none"}); the music arc needs at least ${MIN_DISTINCT_EMOTIONS}`,
			});
		}
	}

	return violations;
}

/** One line naming every violated invariant, for a plan-level advisory note. */
export function storyArcCoverageNote(violations: readonly StoryArcCoverageViolation[]): string {
	return violations.map((violation) => `${violation.invariant}: ${violation.detail}`).join("; ");
}

/* The same five checks as countable figures, for the project quality report.
 *
 * The violations above are prose an operator reads while reviewing one plan; these
 * are numbers a report records beside the visual beat signals. Both derive from
 * the same pass, so a project's recorded structural health and the warning shown
 * on its plan cannot disagree. */
export interface StoryArcCoverageSignals {
	arc: StoryArc;
	sections: number;
	missingFunctions: string[];
	functionsOrdered: boolean;
	/** Observed midpoint as a fraction of estimated runtime. Absent when no section
	 *  carries the midpoint function — never a passing value. */
	midpointPosition: number | null;
	/** Absent when the plan states no turn, so there is nothing to fulfil. */
	turnFulfilled: boolean | null;
	distinctEmotions: number;
}

/** A plan carrying no arc yields `null` — no signals rather than a failed report. */
export function storyArcCoverageSignals(
	input: StoryArcCoverageInput,
): StoryArcCoverageSignals | null {
	const { arc, sections } = input;
	if (!arc || sections.length === 0) return null;
	const spec = storyArcSpec(arc);
	const violations = storyArcCoverageViolations(input);
	const midpointAt = sections.findIndex((section) => section.chapterFunction === spec.midpointKey);
	const span = midpointAt >= 0 ? sectionSpans(sections)[midpointAt]! : undefined;
	const expected = [...new Set(storyArcFunctionSlots(arc, sections.length).map((fn) => fn.key))];
	const present = new Set(sections.map((section) => section.chapterFunction).filter(Boolean));
	return {
		arc,
		sections: sections.length,
		missingFunctions: expected.filter((key) => !present.has(key)),
		functionsOrdered: !violations.some((violation) => violation.invariant === "functions_ordered"),
		midpointPosition: span ? Math.round(((span.start + span.end) / 2) * 100) / 100 : null,
		turnFulfilled: input.engagement?.turn?.trim()
			? !violations.some((violation) => violation.invariant === "turn_fulfilled")
			: null,
		distinctEmotions: new Set(sections.map((section) => section.emotion).filter(Boolean)).size,
	};
}

/* The arc coverage input as persisted inside a storyboard document.
 *
 * Structural and defensive, the same posture `storyPlanVisualSections` takes: a
 * document with no story plan, or one written before arcs existed, simply yields
 * nothing rather than failing the report it feeds. */
export function storyPlanArcCoverageInput(storyboard: unknown): StoryArcCoverageInput | null {
	const plan = storyPlanArtifactOf(documentArtifacts(documentArtifactList(storyboard)))?.payload;
	if (!plan) return null;
	// `oneOf` narrows against the closed list, so an arc this build does not know
	// reads as no arc — the same answer a pre-arc document gets.
	const arc = oneOf(plan.arc, STORY_ARCS);
	if (!arc) return null;
	return {
		arc,
		sections: plan.sections,
		engagement: plan.engagement ? { turn: plan.engagement.turn } : undefined,
	};
}
