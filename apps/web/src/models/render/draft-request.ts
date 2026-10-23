/* The fast-draft payload, assembled from the editor's document.
 *
 * Pure, in the shape the draft renderer already uses, so "what does the draft
 * renderer actually receive" has an answer that does not require
 * clicking Export and watching an MP4 come out.
 *
 * The visibility rule is the reason this is worth extracting rather than
 * inlining. A hidden track must drop out of the draft exactly as it drops out
 * of the server render; the two paths used to spell the predicate out
 * separately, and a change to what "hidden" means moved them apart. Both read
 * `trackVisibility` now, and this assembles the draft's half of it once.
 */
import {
	renderCaptionClips,
	captionOutputBlockers,
	trackVisibility,
	type Clip,
	type TrackFlags,
} from "@maleo/shared";
import type { AudioOverlay, Scene, CaptionConfig } from "@maleo/shared";
import type { DraftExportInput } from "./export.ts";

/* The scene and audio shapes are `export.ts`'s own — this assembles the input
 * that renderer takes, so restating them here would be a second source of truth
 * for the same contract. */
export type DraftRequest = Pick<DraftExportInput, "scenes" | "audio" | "captionCues" | "totalSec">;

export interface DraftRequestInput {
	clips: Clip[];
	scenes: Scene[];
	audioOverlays: AudioOverlay[];
	captions: CaptionConfig;
	trackFlags: TrackFlags;
	/** A scene's effective start, from its clip on the document. */
	sceneStart: (id: number) => number;
}

/** Timeline length: the furthest clip end. Transitions are excluded — they
 *  annotate a boundary, they do not extend the reel. */
export function timelineTotalSec(clips: Clip[]): number {
	return Math.max(
		1,
		...clips.filter((c) => c.type !== "transition").map((c) => c.startSec + c.durationSec),
		0,
	);
}

/** Whether there is anything a render could contain. */
export function hasRenderableVisual(clips: Clip[]): boolean {
	return clips.some((c) => c.type === "image" || c.type === "video" || c.type === "text");
}

export function buildDraftRequest(input: DraftRequestInput): DraftRequest {
	const visible = trackVisibility(input.trackFlags);
	const blockers = captionOutputBlockers(input.clips, input.captions, input.trackFlags);
	if (blockers.length) throw new Error(blockers.join(" "));
	return {
		scenes: input.scenes
			.filter(() => !visible.baseHidden)
			.map((s) => ({
				src: s.src ?? undefined,
				start: input.sceneStart(s.id),
				dur: Math.max(1, s.dur),
				move: s.move,
			})),
		audio: input.audioOverlays
			.filter((a) => visible.audible(a.track))
			.map((a) => ({
				url: a.url,
				start: a.start,
				dur: a.dur,
				volume: a.volume,
				fadeIn: a.fadeIn,
				fadeOut: a.fadeOut,
				mediaStartSec: a.mediaStartSec,
			})),
		captionCues: renderCaptionClips(input.clips, input.captions, input.trackFlags),
		totalSec: timelineTotalSec(input.clips),
	};
}
