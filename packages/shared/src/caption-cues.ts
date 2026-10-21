import { z } from "zod";
import { DEFAULT_CAPTIONS, type CaptionConfig } from "./caption-config.ts";
import { fingerprintValue } from "./entity-fingerprint.ts";
import type * as Engine from "./editor/engine-types.generated.ts";
import type { Clip } from "./timeline-doc.ts";
import type { TrackFlags } from "./timeline-model.ts";

/** Reuse the caption lane after its last cue is deleted. */
export function captionTrackFor(doc: { clips: readonly Clip[]; trackFlags?: TrackFlags }): number {
	const existing = doc.clips.find((clip) => clip.type === "caption");
	if (existing) return existing.track;
	const declared = Object.entries(doc.trackFlags ?? {}).find(
		([, flags]) => flags.group === "caption",
	);
	if (declared) return Number(declared[0]);
	return (
		Math.max(
			-1,
			...doc.clips.map((clip) => clip.track),
			...Object.keys(doc.trackFlags ?? {}).map(Number),
		) + 1
	);
}

/** Persistence compares saved content, because exact undo can restore older edit revisions. */
export function captionStateFingerprint(doc: {
	clips: Clip[];
	captionSet?: CaptionSet | null;
	captions?: CaptionConfig | null;
}): string {
	return fingerprintValue({
		set: doc.captionSet ?? null,
		clips: doc.clips.filter((clip) => clip.type === "caption"),
		style: { ...DEFAULT_CAPTIONS, ...doc.captions },
	});
}

export type CaptionTimingOrigin = Engine.CaptionTimingOrigin;
export type CaptionCueWord = Engine.CaptionCueWord;
export type CaptionSourceBinding = Engine.CaptionSourceBinding;
export type CaptionProtection = Engine.CaptionProtection;
export type CaptionProvenance = Engine.CaptionProvenance;
export type CaptionStatus = Engine.CaptionStatus;
export type CaptionDeletedRange = Engine.CaptionDeletedRange;
export type CaptionSet = Engine.CaptionSet;
export interface CaptionCue extends Omit<Engine.CaptionCue, "style"> {
	style?: Partial<CaptionConfig>;
}

const id = z.string().refine((value) => value.trim().length > 0, "Value is empty");
const seconds = z.number().finite().nonnegative();
const revision = z.number().int().min(0).max(0xffffffff);
const origin = z.enum(["recognized", "script-assisted", "estimated", "imported", "manual"]);
export const CaptionProvenanceSchema: z.ZodType<CaptionProvenance> = z.object({
	origin,
	wordTimingOrigin: origin,
	engine: id.optional(),
	model: id.optional(),
	runId: id.optional(),
});
const sourceFields = z.object({
	clipId: id,
	visualId: id.optional(),
	mediaId: id,
	mediaRevision: id,
	sourceStartSec: seconds,
	sourceEndSec: seconds,
});
export const CaptionSourceBindingSchema: z.ZodType<CaptionSourceBinding> = sourceFields.refine(
	(value) => value.sourceEndSec > value.sourceStartSec,
	"Source interval must have positive duration",
);

/** Appearance uses the existing global configuration vocabulary. */
export const CaptionStyleOverrideSchema = z
	.object({
		enabled: z.boolean(),
		fontFamily: id,
		fontSize: z.number().finite().positive(),
		weight: id,
		italic: z.boolean(),
		allCaps: z.boolean(),
		style: id,
		lines: z.enum(["Single Line", "Two Lines"]),
		chunkDuration: id,
		maxWords: z.number().int().positive(),
		maxChars: z.number().int().positive(),
		maxPauseMs: seconds,
		verticalPosition: seconds.max(100),
		maxWidth: z.number().finite().positive().max(100),
		fill: z.string(),
		activeColor: z.string(),
		stroke: z.string(),
		background: z.string(),
		shadow: z.string(),
		shadowOpacity: seconds.max(100),
		shadowBlur: seconds,
		shadowDistance: seconds,
		shadowAngle: z.number().finite(),
		inactiveOpacity: seconds.max(100),
		motion: z.enum(["None", "Fade", "Pop", "Slide Up"]),
		preset: z.enum([
			"standard",
			"yellow",
			"highlight",
			"blackOnWhite",
			"documentary",
			"tiktokPunch",
			"education",
			"karaoke",
		]),
	})
	.partial()
	.strict() satisfies z.ZodType<Partial<CaptionConfig>>;

const wordSchema: z.ZodType<CaptionCueWord> = z
	.object({
		text: id,
		startSec: seconds,
		endSec: seconds,
	})
	.refine((word) => word.endSec > word.startSec, "Word interval must have positive duration");
export const CaptionCueSchema: z.ZodType<CaptionCue> = z.object({
	text: z.string().refine((text) => text.trim().length > 0, "Caption text is empty"),
	words: z.array(wordSchema),
	provenance: CaptionProvenanceSchema,
	sources: z.array(CaptionSourceBindingSchema),
	protection: z.object({
		text: z.boolean(),
		timing: z.boolean(),
		segmentation: z.boolean(),
		style: z.boolean(),
	}),
	revision,
	groupId: id,
	status: z.enum(["current", "needs-refresh"]),
	style: CaptionStyleOverrideSchema.optional(),
});

export const CaptionDeletedRangeSchema: z.ZodType<CaptionDeletedRange> = z
	.object({
		id,
		groupId: id,
		startSec: seconds,
		endSec: seconds,
		sources: z.array(CaptionSourceBindingSchema),
	})
	.refine((range) => range.endSec > range.startSec, "Deleted range must have positive duration");
export const CaptionSetSchema: z.ZodType<CaptionSet> = z.object({
	initialized: z.literal(true),
	language: id,
	detectedLanguage: id.optional(),
	revision,
	deletedRanges: z.array(CaptionDeletedRangeSchema),
	appliedRunIds: z.array(id),
});

/** Validate a cue at ingress. Word text follows authored text; word times remain cue-local. */
export const CaptionClipSchema = z
	.object({
		id,
		type: z.literal("caption"),
		startSec: seconds,
		durationSec: z.number().finite().positive(),
		track: z.number().int().nonnegative(),
		caption: CaptionCueSchema,
	})
	.passthrough()
	.superRefine((clip, context) => {
		if (
			!Number.isFinite(clip.startSec + clip.durationSec) ||
			clip.startSec + clip.durationSec <= clip.startSec
		)
			context.addIssue({ code: "custom", message: "Cue end must be finite and after its start" });
		let previousEnd = 0;
		for (const word of clip.caption.words) {
			if (word.startSec < previousEnd || word.endSec > clip.durationSec)
				context.addIssue({ code: "custom", message: "Words must be ordered inside cue duration" });
			previousEnd = word.endSec;
		}
		const withoutSpace = (text: string) => text.replace(/\s/gu, "");
		if (
			clip.caption.words.length &&
			withoutSpace(clip.caption.words.map((word) => word.text).join("")) !==
				withoutSpace(clip.caption.text)
		)
			context.addIssue({ code: "custom", message: "Words must reference authored cue text" });
	});

/** Current bindings must name live audio/video instances; stale bindings retain source evidence. */
export function captionSourceReferencesValid(cue: CaptionCue, clips: readonly Clip[]): boolean {
	return (
		cue.status === "needs-refresh" ||
		cue.sources.every((binding) => {
			const source = clips.find((clip) => clip.id === binding.clipId);
			if (!source) return false;
			if (!binding.visualId) return source.type === "audio" || source.type === "video";
			const visual =
				source.vis?.vclip.id === binding.visualId
					? source.vis.vclip
					: source.scene?.visualClips?.find((item) => item.id === binding.visualId);
			return visual?.kind === "video";
		})
	);
}
