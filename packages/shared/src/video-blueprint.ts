// Short-form Video Blueprint: the plan-first artifact the Director produces
// BEFORE any asset generation — the short-form equivalent of the story plan.
//
// A blueprint captures the *intent* of a video (sections, story arc, section
// vibe, and semantic information) without committing to rendered assets. New
// plans use the section-first hierarchy; the legacy flat schema remains only at
// this compatibility boundary and is normalized before downstream use.

import { z } from "zod";
import { type StoryBeat } from "./video-style.ts";

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

function trimString(max: number): (value: unknown) => unknown {
	return (value: unknown): unknown =>
		typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max).trim() : value;
}

// Truncate an over-long array to `max` instead of rejecting the whole beat — the
// LLM occasionally returns extra rows/columns; keep the first N rather than fail.
function clampArray(max: number): (value: unknown) => unknown {
	return (value: unknown): unknown => (Array.isArray(value) ? value.slice(0, max) : value);
}

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
 * renderer choice. The deterministic editorial engine later chooses motion and
 * paired SFX from this structure. */
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
