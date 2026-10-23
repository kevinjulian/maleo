/* Shared strict Zod input contracts. Every tool is validated before dispatch;
 * unknown keys are rejected so planner/handler drift is visible, not silently
 * ignored. Coercion is limited to JSON scalar shapes models commonly emit. */
import type { EditorCommand } from "@maleo/shared/editor";
import { z } from "zod";
import { STORY_ARCS, VIDEO_PLAN_KINDS, storyEditorialDecisionSchema } from "@maleo/shared";

const text = z.coerce.string();
const number = z.coerce.number().finite();
const layout = z
	.object({
		xPct: number.optional(),
		yPct: number.optional(),
		widthPct: number.optional(),
		heightPct: number.optional(),
		fit: z.enum(["contain", "cover", "stretch"]).optional(),
		opacity: number.optional(),
		rotationDeg: number.optional(),
	})
	.strict();

export const emptyArgs = z.object({}).strict();
export const finishArgs = z.object({ say: text.optional() }).strict();
export const indexArgs = z.object({ index: z.coerce.number().int().min(0) }).strict();
export const indexWithTextArgs = z
	.object({ index: z.coerce.number().int().min(0), text: text.optional(), voice: text.optional() })
	.strict();
export const outlineArgs = z.object({ title: text.optional(), body: text.optional() }).strict();
/* Models reach for the plain-English word for a structure ("sections", "beats")
 * rather than the enum token. Those name the same two structures, so map them
 * instead of failing a whole plan call on vocabulary. */
const STRUCTURE_ALIASES: Record<string, "beat" | "narration_section"> = {
	beat: "beat",
	beats: "beat",
	beat_driven: "beat",
	section: "narration_section",
	sections: "narration_section",
	narration: "narration_section",
	narration_section: "narration_section",
	narration_sections: "narration_section",
};
const structureRequest = z.preprocess(
	(value) =>
		typeof value === "string" ? (STRUCTURE_ALIASES[value.trim().toLowerCase()] ?? value) : value,
	z.enum(["auto", "beat", "narration_section"]),
);

export const planStoryArgs = z
	.object({
		brief: text.optional(),
		targetDurationSec: number.positive().optional(),
		structure: structureRequest.optional(),
		planKind: z.enum(["auto", ...VIDEO_PLAN_KINDS]).optional(),
		/* The story arc, on the same terms as planKind: a supported name requests it
		 * explicitly, `auto` or omission defers to inference. Arc and plan kind resolve
		 * independently — requesting one does not constrain the other. */
		arc: z.enum(["auto", ...STORY_ARCS]).optional(),
		sectionCount: z.coerce.number().int().positive().optional(),
	})
	.strict();
export const createLongformArgs = z
	.object({
		brief: text.optional(),
		targetDurationSec: number.positive().optional(),
		voice: text.optional(),
	})
	.strict();
export const researchTopicArgs = z
	.object({
		topic: text.min(1),
		questions: z.array(text).optional(),
		maxSources: z.coerce.number().int().positive().optional(),
	})
	.strict();
export const searchWebArgs = z
	.object({ query: text.min(1), maxResults: z.coerce.number().int().positive().optional() })
	.strict();
export const readWebPageArgs = z.object({ url: text.url() }).strict();
export const generateVoiceArgs = z.object({ text: text.min(1), voice: text.optional() }).strict();
export const voiceoverClipArgs = z
	.object({
		text: text.min(1),
		startSec: number.nonnegative().optional(),
		durationSec: number.positive().optional(),
		voice: text.optional(),
	})
	.strict();
export const addAudioArgs = z
	.object({
		kind: z.enum(["sfx", "ambient", "accent_hit", "music"]),
		content: text.min(1),
		startSec: number.nonnegative(),
		durationSec: number.positive(),
		url: text.optional(),
	})
	.strict();
export const addTextArgs = z
	.object({
		content: text.min(1),
		startSec: number.nonnegative(),
		durationSec: number.positive(),
		preset: z
			.enum([
				"title",
				"subtitle",
				"lower-third",
				"stat",
				"quote",
				"location",
				"timeline",
				"chapter",
			])
			.optional(),
	})
	.strict();
export const setLayoutArgs = z
	.object({
		target: z.enum(["scene", "video", "text"]),
		index: z.coerce.number().int().min(0),
		xPct: number.optional(),
		yPct: number.optional(),
		widthPct: number.optional(),
		heightPct: number.optional(),
		fit: z.enum(["contain", "cover", "stretch"]).optional(),
		opacity: number.optional(),
		rotationDeg: number.optional(),
	})
	.strict();
export const overlayArgs = z
	.object({
		prompt: text.optional(),
		url: text.optional(),
		kind: z.enum(["image", "video"]).optional(),
		startSec: number.nonnegative(),
		durationSec: number.positive(),
		track: z.coerce.number().int().nonnegative().optional(),
		label: text.optional(),
		layout: layout.optional(),
	})
	.strict()
	.refine((value) => Boolean(value.prompt?.trim() || value.url?.trim()), {
		message: "prompt or url is required",
	});
export const characterArgs = z.object({ name: text.min(1), description: text.min(1) }).strict();
export const styleArgs = z.object({ brief: text.optional() }).strict();

const sceneFields = {
	name: text.optional(),
	visual: text.optional(),
	voiceover: text.optional(),
	durationSec: number.positive().optional(),
	shot: text.optional(),
	move: text.optional(),
	transition: text.optional(),
	action: text.optional(),
	sfx: text.optional(),
	beat: text.optional(),
	emotion: text.optional(),
	intent: text.optional(),
	question: text.optional(),
	claim: text.optional(),
	evidence: text.optional(),
	analogy: text.optional(),
	visualType: text.optional(),
	onScreenText: text.optional(),
	// Cast ids (from the project roster) that appear in this scene. Validated
	// against the roster in the handler; unknown ids are dropped.
	refIds: z.array(text).optional(),
};
export const addSceneArgs = z.object(sceneFields).strict();
export const updateSceneArgs = z
	.object({ index: z.coerce.number().int().min(0), ...sceneFields })
	.strict();
export const updateSectionArgs = z
	.object({
		index: z.coerce.number().int().min(0).optional(),
		sectionId: text.min(1).optional(),
		title: text.optional(),
		narration: text.optional(),
		visualPrompt: text.optional(),
		editorial: storyEditorialDecisionSchema.optional(),
	})
	.strict()
	.refine((value) => value.index !== undefined || Boolean(value.sectionId), {
		message: "sectionId or legacy index is required",
	})
	.describe("sectionId or legacy index is required");

const replay = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("scene_frame"),
			index: z.number().int().min(0),
			url: z.string().min(1),
		})
		.strict(),
	z
		.object({
			kind: z.literal("edit"),
			commands: z.array(
				z.custom<EditorCommand>(
					(value) =>
						typeof value === "object" &&
						value !== null &&
						"type" in value &&
						typeof value.type === "string",
				),
			),
		})
		.strict(),
]);
export const toolResultSchema = z
	.object({
		note: z.string(),
		thumbs: z.array(z.string().min(1)).optional(),
		artifacts: z
			.array(
				z
					.object({
						kind: z.enum(["image", "audio", "video"]),
						url: z.string().min(1),
						logicalRef: z.string().min(1),
						metadata: z
							.object({
								providerId: z.string().optional(),
								providerSource: z.string().optional(),
								model: z.string().optional(),
								cost: z.number().optional(),
								latencyMs: z.number().optional(),
							})
							.strict()
							.optional(),
					})
					.strict(),
			)
			.optional(),
		effect: z.enum(["note", "patch", "asset", "proposal", "await"]).optional(),
		replay: replay.optional(),
		// The tool parked mid-execution and holds a resumable second phase (ToolResult).
		suspended: z.literal(true).optional(),
	})
	.strict();

export const requiresIndex = indexArgs;
