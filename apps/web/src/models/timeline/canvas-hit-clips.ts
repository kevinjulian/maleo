/* The transparent targets that let a clip be picked on the preview.
 *
 * Every clip live at the playhead becomes a hit box, so a clip can be selected
 * on the canvas and not only on the timeline. The selected clip is excluded
 * (its own ClipBox already owns the pointer) and base scenes are omitted
 * deliberately — a full-canvas hit box would blanket the preview and swallow
 * the Generate and click-to-clear affordances.
 *
 * Split out of `use-canvas-selection.ts`, which the EDITOR calls, because this
 * is the one part of that hook that depends on the playhead: keeping it there
 * meant the editor's root had to know the current time, which is what made a
 * second of playback re-render the whole tree.
 *
 * A pure function rather than a hook, because WHEN it recomputes is the caller's
 * decision and the right answer is not "every frame". Which clips are live
 * changes only when one starts or ends, so the stage memoizes this on the
 * timeline segment (`time-segments.ts`) — a scan per frame is exactly the cost
 * that made playback stutter as the clip count grew.
 */
import { normalizeLayout, type ClipKind, type ClipLayout } from "@models/timeline/clip-layout.ts";
import type { TrackFlags } from "@maleo/shared";
import type { DerivedArrays as Derived } from "./derived-arrays.ts";

export interface CanvasHitBox {
	xPct: number;
	yPct: number;
	widthPct: number;
	heightPct: number;
	rotationDeg?: number;
}

export interface CanvasHitClip {
	source: "video" | "text" | "infographic";
	id: number;
	start: number;
	box: CanvasHitBox;
}

export interface CanvasHitClipsInput {
	overlays: Derived["textOverlays"];
	videoOverlays: Derived["videoOverlays"];
	infographicOverlays: Derived["infographicOverlays"];
	selectedOverlayId?: number | null;
	selectedInfographicId?: number | null;
	selectedVideoOvId?: number | null;
	trackFlags: TrackFlags;
}

/** The pickable boxes at `playheadSec`. */
export function canvasHitClipsAt(
	{
		overlays,
		videoOverlays,
		infographicOverlays,
		selectedOverlayId,
		selectedInfographicId,
		selectedVideoOvId,
		trackFlags,
	}: CanvasHitClipsInput,
	playheadSec: number,
): CanvasHitClip[] {
	const isLive = (start: number, dur: number): boolean =>
		playheadSec >= start && playheadSec <= start + Math.max(0, dur);
	const boxOf = (l: ClipLayout | undefined, k: ClipKind): CanvasHitBox => {
		const L = normalizeLayout(l, k);
		return {
			xPct: L.xPct,
			yPct: L.yPct,
			widthPct: L.widthPct,
			heightPct: L.heightPct ?? 12,
			...(L.rotationDeg ? { rotationDeg: L.rotationDeg } : {}),
		};
	};
	const hits: CanvasHitClip[] = [];
	const pickable = (track: number | undefined): boolean =>
		!trackFlags[track ?? 0]?.hidden && !trackFlags[track ?? 0]?.locked;
	for (const v of videoOverlays)
		if (v.id !== selectedVideoOvId && isLive(v.start, v.dur) && pickable(v.track))
			hits.push({ source: "video", id: v.id, start: v.start, box: boxOf(v.layout, v.kind) });
	for (const g of infographicOverlays)
		if (g.id !== selectedInfographicId && isLive(g.start, g.dur) && pickable(g.track))
			hits.push({ source: "infographic", id: g.id, start: g.start, box: boxOf(g.layout, "image") });
	for (const o of overlays)
		if (o.id !== selectedOverlayId && isLive(o.start, o.dur) && pickable(o.track))
			hits.push({ source: "text", id: o.id, start: o.start, box: boxOf(o.layout, "text") });
	return hits;
}
