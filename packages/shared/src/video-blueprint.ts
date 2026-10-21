// Short-form Video Blueprint: the plan-first artifact the Director produces
// BEFORE any asset generation — the short-form equivalent of the story plan.
//
// A blueprint captures the *intent* of a video (sections, story arc, section
// vibe, and semantic information) without committing to rendered assets. New
// plans use the section-first hierarchy; the legacy flat schema remains only at
// this compatibility boundary and is normalized before downstream use.

import { z } from "zod";
import { type StoryBeat } from "./video-style.ts";
import { fieldOf } from "./object-keys.ts";
import { oneOf } from "./one-of.ts";

const STORY_BEATS = ["hook", "setup", "conflict", "twist", "resolution", "cta"] as const;
export const VISUAL_TYPES = [
	"scene",
	"contrast",
	"timeline",
	"map",
	"diagram",
	"evidence",
	"metaphor",
	"joke",
	"reveal",
] as const;
const MOTION_GRAPHIC_KINDS = [
	"none",
	"stat_reveal",
	"bar_chart",
	"table_build",
	"price_tag",
] as const;
const MOTION_GRAPHIC_PURPOSES = [
	"clarify",
	"prove",
	"orient",
	"emphasize",
	"compare",
	"none",
] as const;
const SECTION_TRANSITION_TYPES = [
	"question_card",
	"timeline_advance",
	"evidence_stamp",
	"diagram_wipe",
	"match_cut",
	"chapter_card",
] as const;
const SECTION_TRANSITION_MOTIONS = [
	"line_draw",
	"paper_wipe",
	"stamp",
	"push",
	"zoom_cut",
	"none",
] as const;
export const MIN_SHORTFORM_SCENE_SEC = 1;
// Per-clip render cap. Image-to-video providers animate at most ~5s per frame,
// so a single generated clip may never exceed this.
export const MAX_SHORTFORM_SCENE_SEC = 5;
// A narrative beat may INTEND to run longer than one clip. When it does, the
// builder splits it into several ≤MAX_SHORTFORM_SCENE_SEC frames rather than
// truncating the beat — this cap just bounds how long any one beat may ask for.
export const MAX_SHORTFORM_BEAT_SEC = 30;

export type ExplainerVisualType = (typeof VISUAL_TYPES)[number];

/** Entry-sound cue per motion-graphic kind. Free-text stock-library queries (like
 *  a section transition's `sfx` cue), kept here so every build path (shortform
 *  blueprint, story assemble) cues the same sound for the same graphic. */
export type MotionGraphicKind = (typeof MOTION_GRAPHIC_KINDS)[number];

export const MOTION_GRAPHIC_SFX_CUES = {
	stat_reveal: "soft pop reveal",
	bar_chart: "short whoosh sweep",
	table_build: "typewriter click",
	price_tag: "cash register chime",
} satisfies Readonly<Record<Exclude<MotionGraphicKind, "none">, string>>;

/** The stock-audio cue for a motion-graphic (or infographic payload) kind, or
 *  null when the kind has no entry sound ("none" / unknown / absent). */
export function motionGraphicSfxCue(kind: string | undefined | null): string | null {
	const cue = fieldOf(MOTION_GRAPHIC_SFX_CUES, kind ?? "");
	return typeof cue === "string" ? cue : null;
}

function normalizeMotionGraphicPurpose(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const clean = value.trim().toLowerCase();
	if (!clean) return "none";
	const known = oneOf(clean, MOTION_GRAPHIC_PURPOSES);
	if (known) return known;
	if (/(banding|compare|perbandingan|kontras|versus|vs\b)/i.test(clean)) return "compare";
	if (/(bukti|prove|evidence|valid|data|source|sumber)/i.test(clean)) return "prove";
	if (/(tegas|negas|emphas|highlight|cta|ringkas|summary|utama|penting|prioritas)/i.test(clean))
		return "emphasize";
	if (
		/(orient|arah|urutan|struktur|daftar|timeline|tahap|langkah|klasifikasi|kategori)/i.test(clean)
	)
		return "orient";
	if (/(jelas|clarif|explain|menjelaskan|memperjelas|menunjukkan|membuat|menampilkan)/i.test(clean))
		return "clarify";
	return "clarify";
}

/* An unrecognised motion-graphic kind degrades to "none" rather than rejecting the
 * beat that carries it.
 *
 * `kind` is a closed vocabulary of renderers, so a model that answers with a
 * description of the graphic it imagined — "dance-to-vector mapping" — names
 * nothing this product can draw. Rejecting it used to fail the whole sequence
 * direction pass, which is graded per draft, so one invented kind discarded an
 * entire validated plan and stopped it at the gate with `needsDirection`.
 *
 * A motion graphic is an optional embellishment: a selected Video Template may
 * disable every one of them, and the beat still stands. Degrading an unknown kind
 * therefore loses nothing a reader would miss, and it keeps the failure
 * proportionate to what actually went wrong. Substitution is not attempted — a
 * guessed renderer would draw data the model never chose. */
function normalizeMotionGraphicKind(value: unknown): unknown {
	if (typeof value !== "string") return value;
	const clean = value
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, "_");
	if (!clean) return "none";
	return oneOf(clean, MOTION_GRAPHIC_KINDS) ?? "none";
}

function trimString(max: number): (value: unknown) => unknown {
	return (value: unknown): unknown =>
		typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : value;
}

// Truncate an over-long array to `max` instead of rejecting the whole beat — the
// LLM occasionally returns extra rows/columns; keep the first N rather than fail.
function clampArray(max: number): (value: unknown) => unknown {
	return (value: unknown): unknown => (Array.isArray(value) ? value.slice(0, max) : value);
}

export const motionGraphicSchema = z
	.object({
		needed: z.boolean().default(false),
		kind: z.preprocess(normalizeMotionGraphicKind, z.enum(MOTION_GRAPHIC_KINDS)).default("none"),
		purpose: z
			.preprocess(normalizeMotionGraphicPurpose, z.enum(MOTION_GRAPHIC_PURPOSES))
			.default("none"),
		reason: z.preprocess(trimString(140), z.string().max(140)).default(""),
		title: z.preprocess(trimString(72), z.string().max(72)).optional(),
		value: z.preprocess(trimString(32), z.string().max(32)).optional(),
		unit: z.preprocess(trimString(16), z.string().max(16)).optional(),
		// price_tag: the anchor/original price shown struck through next to `value`.
		compareAt: z.preprocess(trimString(32), z.string().max(32)).optional(),
		rows: z
			.preprocess(
				clampArray(5),
				z
					.array(
						z.object({
							label: z.string().max(40),
							value: z.number(),
							color: z.string().optional(),
						}),
					)
					.max(5),
			)
			.optional(),
		columns: z.preprocess(clampArray(4), z.array(z.string().max(32)).max(4)).optional(),
		tableRows: z.preprocess(clampArray(5), z.array(z.array(z.string().max(80))).max(5)).optional(),
	})
	.default({ needed: false, kind: "none", purpose: "none", reason: "" });
export type MotionGraphicDecision = z.infer<typeof motionGraphicSchema>;

const INFORMATION_FUNCTIONS = [
	"none",
	"stat",
	"comparison",
	"list",
	"process",
	"evidence",
	"price",
] as const;

/** Semantic information supplied by planning. It describes meaning/data, not
 * renderer choice. The deterministic editorial engine later chooses motion,
 * infographic, and paired SFX from this structure. */
export const sceneInformationSchema = z
	.object({
		function: z.enum(INFORMATION_FUNCTIONS).catch("none").default("none"),
		title: z.preprocess(trimString(72), z.string().max(72)).optional(),
		value: z.preprocess(trimString(32), z.string().max(32)).optional(),
		unit: z.preprocess(trimString(16), z.string().max(16)).optional(),
		compareAt: z.preprocess(trimString(32), z.string().max(32)).optional(),
		dataPoints: z
			.preprocess(
				clampArray(5),
				z
					.array(
						z.object({
							label: z.string().max(40),
							value: z.number(),
							color: z.string().optional(),
						}),
					)
					.max(5),
			)
			.optional(),
		items: z.preprocess(clampArray(5), z.array(z.string().max(80)).max(5)).optional(),
	})
	.default({ function: "none" });
export type SceneInformation = z.infer<typeof sceneInformationSchema>;

export const sectionTransitionSchema = z.object({
	type: z.enum(SECTION_TRANSITION_TYPES).catch("question_card").default("question_card"),
	plateId: z.string().default("thread"),
	text: z.string().max(80).catch("").default(""),
	motion: z.enum(SECTION_TRANSITION_MOTIONS).catch("line_draw").default("line_draw"),
	durationSec: z.number().min(0.4).max(1.5).default(0.9),
	plateImageUrl: z.string().optional(),
	sfx: z.string().optional(),
});
export type SectionTransition = z.infer<typeof sectionTransitionSchema>;

const BEAT_ARC: StoryBeat[] = [...STORY_BEATS];

export function inferBeat(index: number, total: number): StoryBeat {
	if (total <= 1 || index === 0) return "hook";
	if (index === total - 1) return "cta";
	const inner = BEAT_ARC.slice(1, BEAT_ARC.length - 1);
	const pos = (index - 1) / Math.max(1, total - 2);
	return inner[Math.min(inner.length - 1, Math.floor(pos * inner.length))]!;
}
