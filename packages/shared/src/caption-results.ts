import type { CaptionDeletedRange, CaptionSourceBinding } from "./caption-cues.ts";
import type { Clip, TimelineDoc } from "./timeline-doc.ts";
import type { TrackFlags } from "./timeline-model.ts";
import { z } from "zod";
import {
	CaptionClipSchema,
	CaptionDeletedRangeSchema,
	CaptionSourceBindingSchema,
} from "./caption-cues.ts";

// Snapshot payloads are retained structurally; Rust compares audible fields before apply.
const sourceClipSchema: z.ZodType<Clip> = z
	.object({
		id: z.string().min(1),
		type: z.enum(["audio", "video", "image"]),
		startSec: z.number().finite().nonnegative(),
		durationSec: z.number().finite().positive(),
		track: z.number().finite(),
	})
	.passthrough();
export const CaptionApplyContextSchema = z
	.object({
		startSec: z.number().finite().nonnegative(),
		endSec: z.number().finite().positive(),
		sources: z.array(CaptionSourceBindingSchema),
		ids: z.array(z.string().min(1)),
		snapshot: z.object({
			sourceClips: z.array(sourceClipSchema),
			cues: z.array(CaptionClipSchema),
			trackFlags: z
				.record(
					z.object({
						muted: z.boolean().optional(),
						hidden: z.boolean().optional(),
						locked: z.boolean().optional(),
					}),
				)
				.optional(),
			deletedRanges: z.array(CaptionDeletedRangeSchema),
			language: z.string().optional(),
			detectedLanguage: z.string().optional(),
		}),
		replaceEdited: z.boolean(),
	})
	.strict();
export type CaptionApplyContext = z.infer<typeof CaptionApplyContextSchema>;

export interface CaptionRegenerationRange {
	startSec: number;
	endSec: number;
	sources: CaptionSourceBinding[];
}
export interface CaptionResultSnapshot {
	sourceClips: Clip[];
	trackFlags?: TrackFlags;
	cues: Clip[];
	deletedRanges: CaptionDeletedRange[];
	language?: string;
	detectedLanguage?: string;
}

const overlaps = (start: number, end: number, left: number, right: number) =>
	start < right && left < end;
function inScope(
	start: number,
	end: number,
	sources: CaptionSourceBinding[],
	range: CaptionRegenerationRange,
): boolean {
	if (sources.length && range.sources.length)
		return sources.some((source) =>
			range.sources.some(
				(selected) =>
					source.clipId === selected.clipId &&
					source.visualId === selected.visualId &&
					source.mediaId === selected.mediaId &&
					source.mediaRevision === selected.mediaRevision &&
					overlaps(
						source.sourceStartSec,
						source.sourceEndSec,
						selected.sourceStartSec,
						selected.sourceEndSec,
					),
			),
		);
	return overlaps(start, end, range.startSec, range.endSec);
}

/** Capture affected evidence only; unrelated edits do not invalidate a ready result. */
export function captureCaptionResult(
	doc: TimelineDoc & { trackFlags?: TrackFlags },
	range: CaptionRegenerationRange,
): CaptionRegenerationRange & { ids: string[]; snapshot: CaptionResultSnapshot } {
	if (
		!Number.isFinite(range.startSec) ||
		!Number.isFinite(range.endSec) ||
		range.startSec < 0 ||
		range.endSec <= range.startSec
	)
		throw new Error("Invalid caption regeneration range");
	const sourceIds = new Set(range.sources.map((source) => source.clipId));
	const cues = doc.clips.filter(
		(clip) =>
			clip.type === "caption" &&
			clip.caption &&
			inScope(clip.startSec, clip.startSec + clip.durationSec, clip.caption.sources, range),
	);
	return structuredClone({
		...range,
		ids: cues.map((cue) => cue.id),
		snapshot: {
			sourceClips: doc.clips.filter((clip) => sourceIds.has(clip.id)),
			...(doc.trackFlags ? { trackFlags: doc.trackFlags } : {}),
			cues,
			deletedRanges: (doc.captionSet?.deletedRanges ?? []).filter((deleted) =>
				inScope(deleted.startSec, deleted.endSec, deleted.sources, range),
			),
			...(doc.captionSet ? { language: doc.captionSet.language } : {}),
			...(doc.captionSet?.detectedLanguage
				? { detectedLanguage: doc.captionSet.detectedLanguage }
				: {}),
		},
	});
}
