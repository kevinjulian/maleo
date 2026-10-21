/* Story arcs — narrative structure as data.
 *
 * A plan used to have a spine (`engagement`) that nothing read and sections that
 * were structurally identical, so pacing was whatever the planner felt like. Two
 * real structures already existed in the codebase, both hardcoded and both gated:
 * the POV lifecycle stages behind a topic-word regex, and the explainer's concept
 * ladder behind one plan kind. This generalizes the move the code already made
 * twice rather than adding a third special case.
 *
 * The library is DATA, not prompt prose, for the same reason `storyDensityFor` is
 * a table rather than a second planning flow: guidance re-authored per run is
 * re-interpreted per run. An arc read from here shapes section slots by
 * computation, before any narration exists.
 *
 * `pov_lifecycle` is the promoted version of `POV_LIFECYCLE_STAGES` /
 * `POV_CHAPTER_FUNCTIONS`. Those two arrays are now DERIVED from this arc, so the
 * vocabulary has one declaration. */
import { EMOTIONS, type Emotion } from "./video-style.ts";
import { oneOf } from "./one-of.ts";
import type { VideoPlanKind } from "./story-plan.ts";

export const STORY_ARCS = [
	"three_act",
	"story_circle",
	"seven_point",
	"fichtean",
	"pov_lifecycle",
] as const;
export type StoryArc = (typeof STORY_ARCS)[number];
/** What a caller may ask for: an arc, or `auto` to let the planner choose. */
export type StoryArcRequest = StoryArc | "auto";

/* Where a function is allowed to sit, as a fraction of estimated runtime.
 *
 * CALIBRATION. Windows are sized against the section counts real targets actually
 * produce, via `storyDensityFor`, not against feature-film act proportions:
 *
 *   ~20s beat plan   → 5 sections  → slot centers 0.10 0.30 0.50 0.70 0.90
 *   ~90s narration   → 4 sections  → slot centers 0.125 0.375 0.625 0.875
 *   ~8min narration  → 16 sections → slot centers 0.031 … 0.969 (step 0.0625)
 *
 * The coarsest grid is the 4-section one, whose neighbouring centers are 0.25
 * apart. A window narrower than that can fall between two slots and be
 * unsatisfiable at 90s while being fine at 8min — a check that fails on arithmetic
 * rather than on the plan. So every window below is at least 0.25 wide, and the
 * midpoint and turn windows are wider still because those are the two the coverage
 * report actually acts on. */
export interface StoryArcPositionWindow {
	start: number;
	end: number;
}

export interface StoryArcFunction {
	/** The value a section's `chapterFunction` carries. */
	key: string;
	/** What this part of the story must DO, given to the drafter verbatim. */
	obligation: string;
	positionWindow: StoryArcPositionWindow;
	/** The section emotion this function defaults to, so the music arc follows the
	 *  story arc rather than being free-picked per section. */
	defaultEmotion: Emotion;
	/** The POV lifecycle stage this function corresponds to. `pov_lifecycle` only —
	 *  it is the one arc whose sections carry a second, parallel vocabulary. */
	povStage?: string;
}

export interface StoryArcSpec {
	key: StoryArc;
	label: string;
	/** One line, compiled into the frame prompt so the planner can choose. */
	fits: string;
	functions: readonly StoryArcFunction[];
	/** The function whose position the coverage report checks. */
	midpointKey: string;
	/** The function the engagement `turn` must land on. */
	turnKey: string;
}

/* The POV lifecycle, as one arc's functions.
 *
 * Declared `as const` so both the chapter-function union and the stage union are
 * inferred from it — the property that stops the two lists from drifting apart the
 * way two hand-maintained parallel arrays did. Every member of the previous
 * `POV_LIFECYCLE_STAGES` and `POV_CHAPTER_FUNCTIONS` appears exactly once; only
 * their pairing and order are now stated rather than left to array position. */
const POV_LIFECYCLE_FUNCTIONS = [
	{
		key: "birth_trap",
		povStage: "origin",
		obligation:
			"Wake inside the role. The viewer's body and its first obligation exist before any choice does.",
		positionWindow: { start: 0, end: 0.25 },
		defaultEmotion: "curiosity",
	},
	{
		key: "rule_learning",
		povStage: "assigned_role",
		obligation: "Learn the system's rules by obeying them. Show what is not permitted.",
		positionWindow: { start: 0.05, end: 0.35 },
		defaultEmotion: "calm",
	},
	{
		key: "body_cost",
		povStage: "training",
		obligation: "The body pays for competence. Name the physical price of the role.",
		positionWindow: { start: 0.15, end: 0.45 },
		defaultEmotion: "tension",
	},
	{
		key: "first_work",
		povStage: "work",
		obligation: "Do the role's real work for the first time, and show what it costs.",
		positionWindow: { start: 0.25, end: 0.55 },
		defaultEmotion: "hope",
	},
	{
		key: "first_test",
		povStage: "first_competence",
		obligation: "Face the first thing that can end the life. Competence is proven or not.",
		positionWindow: { start: 0.35, end: 0.68 },
		defaultEmotion: "suspense",
	},
	{
		key: "betrayal_or_threat",
		povStage: "danger",
		obligation: "The system turns. What protected the viewer becomes what endangers them.",
		positionWindow: { start: 0.45, end: 0.78 },
		defaultEmotion: "shock",
	},
	{
		key: "system_power",
		povStage: "peak_service",
		obligation: "Peak usefulness to the system, and the clearest view of who the system serves.",
		positionWindow: { start: 0.6, end: 0.88 },
		defaultEmotion: "tension",
	},
	{
		key: "exhaustion",
		povStage: "decay",
		obligation: "The body fails while the obligation does not. Decay is irreversible.",
		positionWindow: { start: 0.7, end: 0.95 },
		defaultEmotion: "sadness",
	},
	{
		key: "erasure",
		povStage: "ending_fate",
		obligation: "The ending fate, and the system continuing without the viewer in it.",
		positionWindow: { start: 0.72, end: 1 },
		defaultEmotion: "relief",
	},
] as const satisfies readonly StoryArcFunction[];

export type PovChapterFunction = (typeof POV_LIFECYCLE_FUNCTIONS)[number]["key"];
export type PovLifecycleStage = (typeof POV_LIFECYCLE_FUNCTIONS)[number]["povStage"];

/* The POV vocabularies as `z.enum` needs to see them: non-empty tuples of literals.
 *
 * `.map` over the arc would erase the tuple shape and force a type assertion, so
 * these are spelled out and CHECKED against the arc with `satisfies` instead. That
 * is the property that matters — reorder, rename or drop a function above and
 * these stop compiling. A runtime `.map` could not have caught that at all. */
type Pluck<T extends readonly object[], K extends keyof T[number]> = {
	[I in keyof T]: T[I] extends Record<K, infer V> ? V : never;
};

export const POV_CHAPTER_FUNCTIONS = [
	"birth_trap",
	"rule_learning",
	"body_cost",
	"first_work",
	"first_test",
	"betrayal_or_threat",
	"system_power",
	"exhaustion",
	"erasure",
] as const satisfies Pluck<typeof POV_LIFECYCLE_FUNCTIONS, "key">;

export const POV_LIFECYCLE_STAGES = [
	"origin",
	"assigned_role",
	"training",
	"work",
	"first_competence",
	"danger",
	"peak_service",
	"decay",
	"ending_fate",
] as const satisfies Pluck<typeof POV_LIFECYCLE_FUNCTIONS, "povStage">;

const SPECS: Record<StoryArc, StoryArcSpec> = {
	three_act: {
		key: "three_act",
		label: "Three act",
		fits: "the universal default: a subject with a beginning, a complication, and a consequence.",
		midpointKey: "midpoint_turn",
		turnKey: "midpoint_turn",
		functions: [
			{
				key: "setup",
				obligation:
					"Establish the world and what is normal in it, concretely enough that a change will register.",
				positionWindow: { start: 0, end: 0.25 },
				defaultEmotion: "curiosity",
			},
			{
				key: "inciting_incident",
				obligation: "Break the normal. State the specific thing that makes the rest necessary.",
				positionWindow: { start: 0.08, end: 0.4 },
				defaultEmotion: "suspense",
			},
			{
				key: "rising_action",
				obligation: "Raise the cost. Each step must be harder than the one before it.",
				positionWindow: { start: 0.2, end: 0.58 },
				defaultEmotion: "tension",
			},
			{
				key: "midpoint_turn",
				obligation: "Reframe what came before. The viewer now reads earlier sections differently.",
				positionWindow: { start: 0.35, end: 0.7 },
				defaultEmotion: "shock",
			},
			{
				key: "climax",
				obligation: "The confrontation the whole story was arranging. No new information.",
				positionWindow: { start: 0.6, end: 0.92 },
				defaultEmotion: "tension",
			},
			{
				key: "resolution",
				obligation: "What the viewer is left understanding, stated once and not restated.",
				positionWindow: { start: 0.75, end: 1 },
				defaultEmotion: "relief",
			},
		],
	},
	story_circle: {
		key: "story_circle",
		label: "Story circle",
		fits: "a character or viewer who leaves a comfortable state, pays for what they wanted, and returns changed.",
		midpointKey: "find",
		turnKey: "take",
		functions: [
			{
				key: "comfort_zone",
				obligation: "Show the ordinary state, including what is wrong with it.",
				positionWindow: { start: 0, end: 0.25 },
				defaultEmotion: "calm",
			},
			{
				key: "need",
				obligation: "Name the want that makes staying impossible.",
				positionWindow: { start: 0.05, end: 0.32 },
				defaultEmotion: "curiosity",
			},
			{
				key: "go",
				obligation: "Cross into unfamiliar territory. The old rules stop applying.",
				positionWindow: { start: 0.15, end: 0.45 },
				defaultEmotion: "suspense",
			},
			{
				key: "search",
				obligation: "Adapt. Show the cost of learning the new rules.",
				positionWindow: { start: 0.25, end: 0.58 },
				defaultEmotion: "tension",
			},
			{
				key: "find",
				obligation: "Get the thing that was wanted, at the midpoint, and show it is not enough.",
				positionWindow: { start: 0.35, end: 0.7 },
				defaultEmotion: "hope",
			},
			{
				key: "take",
				obligation: "Pay the heavy price. This is the section that reframes the want.",
				positionWindow: { start: 0.5, end: 0.82 },
				defaultEmotion: "shock",
			},
			{
				key: "return",
				obligation: "Come back to the original situation carrying what was paid.",
				positionWindow: { start: 0.65, end: 0.92 },
				defaultEmotion: "sadness",
			},
			{
				key: "change",
				obligation: "Show the changed state — the same world, read differently.",
				positionWindow: { start: 0.72, end: 1 },
				defaultEmotion: "relief",
			},
		],
	},
	seven_point: {
		key: "seven_point",
		label: "Seven point",
		fits: "an anchored structure that tolerates variable section counts — good when the section count is unusual.",
		midpointKey: "midpoint",
		turnKey: "plot_turn_2",
		functions: [
			{
				key: "hook",
				obligation:
					"Open on the state that the ending will invert. Make the starting position legible.",
				positionWindow: { start: 0, end: 0.25 },
				defaultEmotion: "curiosity",
			},
			{
				key: "plot_turn_1",
				obligation: "Introduce the force that starts the story and removes the option of stopping.",
				positionWindow: { start: 0.1, end: 0.4 },
				defaultEmotion: "suspense",
			},
			{
				key: "pinch_1",
				obligation: "Apply the first real pressure. Show the opposing force doing something.",
				positionWindow: { start: 0.2, end: 0.5 },
				defaultEmotion: "tension",
			},
			{
				key: "midpoint",
				obligation: "Turn from reacting to acting. This is the structural center.",
				positionWindow: { start: 0.35, end: 0.68 },
				defaultEmotion: "shock",
			},
			{
				key: "pinch_2",
				obligation: "Apply the pressure that removes the last easy option.",
				positionWindow: { start: 0.5, end: 0.8 },
				defaultEmotion: "tension",
			},
			{
				key: "plot_turn_2",
				obligation: "Deliver the last missing piece. Everything needed to finish is now present.",
				positionWindow: { start: 0.62, end: 0.9 },
				defaultEmotion: "hope",
			},
			{
				key: "resolution",
				obligation: "Invert the hook. State the ending position against the opening one.",
				positionWindow: { start: 0.75, end: 1 },
				defaultEmotion: "victory",
			},
		],
	},
	fichtean: {
		key: "fichtean",
		label: "Fichtean curve",
		fits: "a crisis ladder with no gentle setup — documentary, investigation, and survival subjects.",
		midpointKey: "complication",
		turnKey: "reversal",
		functions: [
			{
				key: "inciting_crisis",
				obligation: "Open inside trouble. No preamble, no scene-setting before the problem.",
				positionWindow: { start: 0, end: 0.25 },
				defaultEmotion: "shock",
			},
			{
				key: "escalating_crisis",
				obligation: "Make it worse in a way the first crisis caused.",
				positionWindow: { start: 0.1, end: 0.42 },
				defaultEmotion: "tension",
			},
			{
				key: "complication",
				obligation: "Add the factor that rules out the obvious solution.",
				positionWindow: { start: 0.3, end: 0.66 },
				defaultEmotion: "suspense",
			},
			{
				key: "reversal",
				obligation: "Turn the situation over. What looked like the problem was a symptom.",
				positionWindow: { start: 0.45, end: 0.8 },
				defaultEmotion: "shock",
			},
			{
				key: "climax",
				obligation: "The highest crisis. Everything the ladder was building resolves here.",
				positionWindow: { start: 0.62, end: 0.92 },
				defaultEmotion: "chaos",
			},
			{
				key: "aftermath",
				obligation: "The short consequence. What is left standing, briefly.",
				positionWindow: { start: 0.72, end: 1 },
				defaultEmotion: "sadness",
			},
		],
	},
	pov_lifecycle: {
		key: "pov_lifecycle",
		label: "Embodied POV lifecycle",
		fits: "the viewer inhabits a role, body, organism, object, creature, worker, survivor, or social position for a whole life.",
		midpointKey: "first_test",
		turnKey: "betrayal_or_threat",
		functions: POV_LIFECYCLE_FUNCTIONS,
	},
};

/** Every arc, in library order. */
export function storyArcSpecs(): readonly StoryArcSpec[] {
	return STORY_ARCS.map((key) => SPECS[key]);
}

export function storyArcSpec(arc: StoryArc): StoryArcSpec {
	return SPECS[arc];
}

/* Each plan kind's default arc, used only when nothing usable was inferred.
 *
 * Most kinds default to `three_act` deliberately: it is the structure that fits a
 * subject with a beginning, a complication and a consequence, which is most of
 * them. `documentary` differs because a documentary opens inside its problem
 * rather than setting one up. A near-uniform table is the honest answer here — the
 * arc is meant to be chosen from the brief, and this is only the floor. */
const DEFAULT_ARC: Record<VideoPlanKind, StoryArc> = {
	story: "three_act",
	explainer: "three_act",
	product: "three_act",
	tutorial: "three_act",
	documentary: "fichtean",
	listicle: "three_act",
	comparison: "three_act",
};

export function defaultStoryArcFor(planKind: VideoPlanKind | undefined): StoryArc {
	return planKind ? DEFAULT_ARC[planKind] : "three_act";
}

/* Resolve the arc a plan is built with.
 *
 * The same posture `resolveStoryStructure` and `planKind` already use: an explicit
 * request wins at any duration and against any inference, `auto` (or nothing)
 * defers to what the planner inferred, and a plan kind's default is the floor when
 * inference produced nothing usable. Unknown strings from a model degrade to
 * "nothing inferred" rather than throwing — the frame stage is retried, not
 * trusted. */
export function resolveStoryArc(
	request: StoryArcRequest | undefined,
	planKind: VideoPlanKind | undefined,
	inferred?: string,
): StoryArc {
	if (request && request !== "auto") return request;
	return oneOf(inferred, STORY_ARCS) ?? defaultStoryArcFor(planKind);
}

export function normalizeStoryArc(value: StoryArcRequest | undefined): StoryArc | undefined {
	return value && value !== "auto" ? value : undefined;
}

/* Map N section slots onto an arc's functions, in canonical order.
 *
 * `round(i·(F-1)/(N-1))` is monotonic non-decreasing and pins slot 0 to the first
 * function and slot N-1 to the last, so a plan always opens and closes on the arc
 * whatever its section count. More slots than functions repeats a function across
 * neighbours; fewer COMPRESSES by skipping — the arc is never dropped, which is
 * the answer the POV lifecycle already gave for short beat videos.
 *
 * Compression can skip the turn, and the turn is the one function the coverage
 * report acts on, so it is forced back in when the plain mapping missed it — onto
 * the LAST slot that currently holds an earlier function, never the middle one.
 * The middle slot may already hold a function that comes after the turn, and
 * writing the turn there would make the slots run backwards. Below three slots
 * there is nowhere to put it that is not the opening or the ending, and a
 * two-section video genuinely has no turn. */
export function storyArcFunctionSlots(arc: StoryArc, sectionCount: number): StoryArcFunction[] {
	const functions = SPECS[arc].functions;
	const count = Math.max(1, Math.floor(sectionCount));
	if (count === 1) return [functions[0]!];
	const last = functions.length - 1;
	const mapped = Array.from({ length: count }, (_, index) =>
		Math.round((index * last) / (count - 1)),
	);
	const turnAt = functions.findIndex((fn) => fn.key === SPECS[arc].turnKey);
	if (count >= 3 && turnAt >= 0 && !mapped.includes(turnAt)) {
		let at = -1;
		for (const [slot, index] of mapped.entries()) if (index < turnAt) at = slot;
		if (at >= 1 && at <= count - 2) mapped[at] = turnAt;
	}
	return mapped.map((index) => functions[index]!);
}

/** The emotion a slot defaults to. Exported so the draft stage can tell a
 *  deliberate override from an emotion it merely echoed back. */
export function arcFunctionEmotion(fn: StoryArcFunction | undefined): Emotion | undefined {
	return fn ? (oneOf(fn.defaultEmotion, EMOTIONS) ?? undefined) : undefined;
}
