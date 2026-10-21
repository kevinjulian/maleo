import { z } from "zod";
import { EMOTIONS } from "./video-style.ts";
import { oneOf } from "./one-of.ts";
import {
	POV_CHAPTER_FUNCTIONS,
	POV_LIFECYCLE_STAGES,
	type PovChapterFunction,
	type PovLifecycleStage,
} from "./story-arc.ts";

/* The POV lifecycle vocabulary now lives in the story arc library, as the
 * `pov_lifecycle` arc's functions — it was one arc all along, hardcoded behind a
 * topic-word regex. Re-exported from here so every existing importer keeps
 * compiling against the module that used to declare it. */
export {
	POV_CHAPTER_FUNCTIONS,
	POV_LIFECYCLE_STAGES,
	type PovChapterFunction,
	type PovLifecycleStage,
} from "./story-arc.ts";

export const STORY_STRUCTURES = ["beat", "narration_section"] as const;
export const VIDEO_PLAN_KINDS = [
	"story",
	"explainer",
	"product",
	"tutorial",
	"documentary",
	"listicle",
	"comparison",
] as const;
export const EXPLAINER_TEACHING_MOVES = [
	"define",
	"compare",
	"demonstrate",
	"apply",
	"recap",
	"transition",
] as const;
export const POV_CAMERA_ROLES = [
	"first_person_hands",
	"body_detail",
	"object_closeup",
	"environment_establishing",
	"companion_view",
	"reflection_shadow",
	"threat_pov",
	"over_shoulder",
	"system_view",
] as const;
const STORY_REFERENCE_ROLES = ["character", "location", "product", "prop"] as const;
const STORY_REFERENCE_VISIBILITY = [
	"face",
	"hands_body",
	"reflection",
	"silhouette",
	"companion_view",
	"object",
	"environment",
] as const;
const STORY_REFERENCE_STATUS = ["planned", "generated", "materialized", "failed"] as const;

/** The one duration threshold separating beat structure from narration-section
 *  structure. Both the code that resolves the structure and the code that records
 *  it read this, so a plan's recorded structure cannot disagree with the routing
 *  that produced it — the two thresholds in the previous revision drifted. */
export const NARRATION_MIN_SEC = 60;

export type StoryStructure = (typeof STORY_STRUCTURES)[number];
export type VideoPlanKind = (typeof VIDEO_PLAN_KINDS)[number];
export type VideoPlanKindRequest = VideoPlanKind | "auto";
export type ExplainerTeachingMove = (typeof EXPLAINER_TEACHING_MOVES)[number];
export type PovCameraRole = (typeof POV_CAMERA_ROLES)[number];
/** What a caller may ask for: a structure, or `auto` to let duration decide. */
export type StoryStructureRequest = StoryStructure | "auto";
export type StoryReferenceRole = (typeof STORY_REFERENCE_ROLES)[number];
export type StoryReferenceVisibility = (typeof STORY_REFERENCE_VISIBILITY)[number];
export type StoryReferenceStatus = (typeof STORY_REFERENCE_STATUS)[number];

export function normalizeVideoPlanKind(
	value: VideoPlanKindRequest | undefined,
): VideoPlanKind | undefined {
	return value && value !== "auto" ? value : undefined;
}

/** Resolve the structure a story plan is built with. An explicit request wins at
 *  any duration — a two-minute beat-driven video is a legitimate ask, and the
 *  duration threshold must not quietly override it. */
export function resolveStoryStructure(
	request: StoryStructureRequest | undefined,
	targetSec: number,
): StoryStructure {
	if (request && request !== "auto") return request;
	return targetSec >= NARRATION_MIN_SEC ? "narration_section" : "beat";
}

/* How the narration's own prose style spends part of the runtime.
 *
 * Synthesis inserts a breath at every sentence boundary, so a second of video is
 * not a second of speech: it is speech plus the silence the sentences earned. Two
 * styles writing the same word count at different sentence densities therefore run
 * for different lengths, and a word budget computed from a flat words-per-second
 * rate is systematically wrong for any style that is not the rate's own.
 *
 * `sentencePauseSec` comes from the timeline template, which owns that number —
 * this stays pure and is told it. */
export interface NarrationBreathRate {
	sentencesPerHundredWords: number;
	sentencePauseSec: number;
}

/* The words-per-second a rate really buys once its breaths are paid for.
 *
 * For W words at density d and pause p: T = W/rate + (W·d/100)·p, so the effective
 * rate is rate / (1 + rate·d·p/100). Denser prose buys fewer words per second
 * because more of each second is silence.
 *
 * A zero or negative density or pause leaves the rate untouched, so a caller that
 * has no writer style — or a template with no sentence pause — gets exactly the
 * number it would have got before breaths were modelled. */
export function wordsPerSecWithBreaths(
	wordsPerSec: number,
	breath: NarrationBreathRate | undefined,
): number {
	if (!breath) return wordsPerSec;
	const { sentencesPerHundredWords, sentencePauseSec } = breath;
	if (!(sentencesPerHundredWords > 0) || !(sentencePauseSec > 0)) return wordsPerSec;
	return wordsPerSec / (1 + (wordsPerSec * sentencesPerHundredWords * sentencePauseSec) / 100);
}

/** Planning density for a structure: how many sections and how many spoken words
 *  a target duration earns. This is the whole difference between a fifteen-second
 *  beat video and a two-minute narrated one — data, not a second planning flow.
 *  Beat structure is visual-led, so it buys more, shorter sections and a thinner
 *  word budget than narration, which is paced by what the voice can say.
 *
 *  `breath` is the narration style's sentence density. Omitted — the case for every
 *  caller without a writer style — the returned `wordsPerSec` is unchanged. */
export function storyDensityFor(
	structure: StoryStructure,
	targetSec: number,
	breath?: NarrationBreathRate,
): { sectionCount: number; wordsPerSec: number } {
	return structure === "beat"
		? {
				sectionCount: Math.max(2, Math.min(12, Math.round(targetSec / 4))),
				wordsPerSec: wordsPerSecWithBreaths(1.6, breath),
			}
		: {
				sectionCount: Math.max(4, Math.min(24, Math.round((targetSec / 60) * 2))),
				wordsPerSec: wordsPerSecWithBreaths(2.6, breath),
			};
}

function normalizedEmotion(value: unknown) {
	if (typeof value !== "string") return value;
	const normalized = value
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "_")
		.replace(/^_+|_+$/g, "");
	const emotion = oneOf(normalized, EMOTIONS);
	if (emotion) return emotion;
	switch (normalized) {
		case "anticipation":
			return "suspense";
		case "anxious":
		case "tense":
			return "tension";
		case "focused":
		case "purposeful":
		case "wonder":
			return "curiosity";
		case "reflective":
			return "calm";
		case "tender":
		case "warm":
			return "hope";
		default:
			return value;
	}
}

const storyEmotionSchema = z.preprocess(normalizedEmotion, z.enum(EMOTIONS));

export const storyEngagementSchema = z.object({
	premise: z.string().default(""),
	hook: z.string().default(""),
	tension: z.string().default(""),
	escalation: z.string().default(""),
	turn: z.string().default(""),
	resolution: z.string().default(""),
	emotionalArc: z.array(storyEmotionSchema).default([]),
	visualMotif: z.string().default(""),
});
export type StoryEngagement = z.infer<typeof storyEngagementSchema>;

/* Whether a plan's claims need grounding in retrieved sources, and what research
 * should ask.
 *
 * This is the frame's job because the frame is already a model call over the
 * brief. What it replaces was a keyword regex (`looksFactual`) plus a fixed
 * four-query template phrased for historical topics — the same shape as the POV
 * topic-word regex this repo already promoted into a selectable arc. `questions`
 * may be empty: research then runs on the topic alone rather than on a template
 * that does not fit the subject. */
export const storyGroundingSchema = z.object({
	needed: z.boolean().default(false),
	questions: z.array(z.string().min(1)).max(5).default([]),
});
export type StoryGrounding = z.infer<typeof storyGroundingSchema>;

/* The floor when the frame produced nothing usable — a degraded frame falls back
 * to defaults, never to a scan of the brief.
 *
 * True for the kinds whose whole contract is a claim about the world: a
 * documentary reports, an explainer teaches a mechanism, a comparison asserts a
 * difference. A story, a product demo, a tutorial and a listicle are shaped by
 * the operator's own material, so grounding them by default would research
 * subjects nobody asked about. */
const DEFAULT_GROUNDING: Record<VideoPlanKind, boolean> = {
	story: false,
	explainer: true,
	product: false,
	tutorial: false,
	documentary: true,
	listicle: false,
	comparison: true,
};

export function defaultGroundingFor(planKind: VideoPlanKind | undefined): boolean {
	return planKind ? DEFAULT_GROUNDING[planKind] : false;
}

export const explainerContractSchema = z.object({
	learningObjective: z.string().min(1),
	coreQuestion: z.string().min(1),
	misconception: z.string().min(1),
	conceptLadder: z.array(z.string().min(1)).min(2),
	evidenceMoment: z.string().min(1),
	transferTakeaway: z.string().min(1),
	visualGrammar: z.string().min(1),
});
export type ExplainerContract = z.infer<typeof explainerContractSchema>;

const optionalNonEmptyString = z.preprocess(
	(value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
	z.string().min(1).optional(),
);

const POV_LIFECYCLE_KEYS = [
	"viewerRole",
	"worldSystem",
	"socialOrder",
	"bodyConstraints",
	"sensoryModel",
	"agencyLimits",
	"survivalGoal",
	"coreFear",
	"tabooCost",
	"transformationArc",
	"endingFate",
] as const;
const POV_STAGE_KEYS = [
	"statusShift",
	"survivalProblem",
	"bodyCost",
	"sensoryAnchor",
	"irreversibleConsequence",
] as const;
type PovLifecycleTextKey = (typeof POV_LIFECYCLE_KEYS)[number];
type PovStageTextKey = (typeof POV_STAGE_KEYS)[number];

function compactText(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const trimmed = value.replace(/\s+/g, " ").trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function keyFromLabel<T extends string>(label: string, keys: readonly T[]): T | undefined {
	const normalized = label.toLocaleLowerCase().replace(/[^a-z0-9]+/g, "");
	return keys.find((key) => key.toLocaleLowerCase() === normalized);
}

function mergeLabelledText<T extends string>(
	target: Partial<Record<T, string>>,
	text: string,
	keys: readonly T[],
): boolean {
	const match = text.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{1,40})\s*[:=-]\s*(.+)$/);
	if (!match) return false;
	const key = keyFromLabel(match[1]!, keys);
	const value = compactText(match[2]);
	if (!key || !value) return false;
	target[key] = value;
	return true;
}

function isObjectValue(value: unknown): value is object {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coercePovLifecycle(value: unknown) {
	if (isObjectValue(value)) return value;
	const entries = Array.isArray(value) ? value : [value];
	const lifecycle: Partial<Record<PovLifecycleTextKey, string>> = {};
	const unlabelled: string[] = [];
	for (const entry of entries) {
		if (isObjectValue(entry)) continue;
		const text = compactText(entry);
		if (!text) continue;
		if (!mergeLabelledText(lifecycle, text, POV_LIFECYCLE_KEYS)) unlabelled.push(text);
	}
	if (unlabelled.length > 0) lifecycle.transformationArc = unlabelled.join("; ");
	return Object.keys(lifecycle).length > 0 ? lifecycle : value;
}

function coercePovStage(value: unknown) {
	if (isObjectValue(value)) return value;
	const text = compactText(value);
	if (!text) return value;
	const stage: Partial<Record<PovStageTextKey, string>> & {
		stage?: PovLifecycleStage;
		chapterFunction?: PovChapterFunction;
	} = {};
	const lifecycleStage = oneOf(text, POV_LIFECYCLE_STAGES);
	const chapterFunction = oneOf(text, POV_CHAPTER_FUNCTIONS);
	if (lifecycleStage) stage.stage = lifecycleStage;
	else if (chapterFunction) stage.chapterFunction = chapterFunction;
	else if (!mergeLabelledText(stage, text, POV_STAGE_KEYS)) stage.statusShift = text;
	return stage;
}

function coercePovShot(value: unknown) {
	if (isObjectValue(value)) return value;
	const text = compactText(value);
	if (!text) return value;
	const cameraRole = oneOf(text, POV_CAMERA_ROLES);
	if (cameraRole) return { cameraRole };
	return { noveltyKey: text };
}

const povLifecycleObjectSchema = z.object({
	viewerRole: optionalNonEmptyString,
	worldSystem: optionalNonEmptyString,
	socialOrder: optionalNonEmptyString,
	bodyConstraints: optionalNonEmptyString,
	sensoryModel: optionalNonEmptyString,
	agencyLimits: optionalNonEmptyString,
	survivalGoal: optionalNonEmptyString,
	coreFear: optionalNonEmptyString,
	tabooCost: optionalNonEmptyString,
	transformationArc: optionalNonEmptyString,
	endingFate: optionalNonEmptyString,
});
export const povLifecycleSchema = z.preprocess(coercePovLifecycle, povLifecycleObjectSchema);
export type PovLifecycle = z.infer<typeof povLifecycleSchema>;

const povStageObjectSchema = z.object({
	stage: z.enum(POV_LIFECYCLE_STAGES).optional(),
	chapterFunction: z.enum(POV_CHAPTER_FUNCTIONS).optional(),
	statusShift: optionalNonEmptyString,
	survivalProblem: optionalNonEmptyString,
	bodyCost: optionalNonEmptyString,
	sensoryAnchor: optionalNonEmptyString,
	irreversibleConsequence: optionalNonEmptyString,
});
export const povStageSchema = z.preprocess(coercePovStage, povStageObjectSchema);
export type PovStage = z.infer<typeof povStageSchema>;

const povShotObjectSchema = z.object({
	cameraRole: z.enum(POV_CAMERA_ROLES).optional(),
	location: optionalNonEmptyString,
	bodyAction: optionalNonEmptyString,
	propFocus: optionalNonEmptyString,
	emotionalPressure: optionalNonEmptyString,
	noveltyKey: optionalNonEmptyString,
});
export const povShotSchema = z.preprocess(coercePovShot, povShotObjectSchema);
export type PovShot = z.infer<typeof povShotSchema>;

function normalizedNoveltyPart(value: string | undefined): string {
	return (value ?? "")
		.toLocaleLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim()
		.replace(/\s+/g, " ");
}

export function povShotNoveltyKey(
	shot: Pick<PovShot, "cameraRole" | "location" | "bodyAction">,
): string {
	return [
		shot.cameraRole ?? "",
		normalizedNoveltyPart(shot.location),
		normalizedNoveltyPart(shot.bodyAction),
	].join("|");
}

export function repeatedAdjacentPovShotIndexes(shots: readonly PovShot[]): number[] {
	const repeated: number[] = [];
	for (let i = 1; i < shots.length; i++) {
		const prev = shots[i - 1];
		const next = shots[i];
		if (!prev?.cameraRole || !next?.cameraRole) continue;
		if (povShotNoveltyKey(prev) === povShotNoveltyKey(next)) repeated.push(i);
	}
	return repeated;
}

export function povCameraRoleSpread(shots: readonly PovShot[]) {
	const roles = new Set(shots.map((shot) => shot.cameraRole).filter(Boolean));
	const detailFocuses = new Set(
		shots.map((shot) => normalizedNoveltyPart(shot.propFocus)).filter(Boolean),
	);
	return { distinctRoles: roles.size, hasDistinctDetailFocus: detailFocuses.size >= 2 };
}

export function hasEnoughPovShotDiversity(shots: readonly PovShot[]): boolean {
	if (shots.length < 2) return true;
	if (repeatedAdjacentPovShotIndexes(shots).length > 0) return false;
	if (shots.length < 4) return true;
	const spread = povCameraRoleSpread(shots);
	return spread.distinctRoles >= 3 || (spread.distinctRoles >= 2 && spread.hasDistinctDetailFocus);
}

export const storyPlannedReferenceSchema = z.object({
	key: z.string().min(1),
	role: z.preprocess(
		(value) => (value === "environment" ? "location" : value),
		z.enum(STORY_REFERENCE_ROLES),
	),
	label: z.string().min(1),
	description: z.string().min(1),
	visibilityMode: z.enum(STORY_REFERENCE_VISIBILITY).optional(),
	sectionIds: z.array(z.coerce.string().min(1)).optional(),
	entityId: z.string().min(1).optional(),
	status: z.enum(STORY_REFERENCE_STATUS).default("planned"),
	error: z.string().optional(),
});
export type StoryPlannedReference = z.infer<typeof storyPlannedReferenceSchema>;

/* What the operator approved about a planned reference: its identity and how it
 * looks, with no `entityId` or `status`. Those describe materialization, which
 * happens after approval and must not be able to reach into the frozen snapshot. */
export const storyPlannedReferenceDefinitionSchema = storyPlannedReferenceSchema.pick({
	key: true,
	role: true,
	label: true,
	description: true,
	visibilityMode: true,
	sectionIds: true,
});
export type StoryPlannedReferenceDefinition = z.infer<typeof storyPlannedReferenceDefinitionSchema>;
