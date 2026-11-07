/* What a render of the timeline contains, measured from its clips. */
import type { Clip } from "@maleo/shared";

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
