import { RENDER_FPS } from "./render-fps.ts";
import type { TimelineDoc } from "./timeline-doc.ts";
import type { TransitionClip } from "./timeline-model.ts";

export interface VisualBoundaryClip {
	id: string;
	start: number;
	dur: number;
	track: number;
}
export const BOUNDARY_TOLERANCE_SEC = 1 / RENDER_FPS;

export function touchingBoundary(
	a: VisualBoundaryClip | undefined,
	b: VisualBoundaryClip | undefined,
): boolean {
	return Boolean(
		a &&
		b &&
		a.id !== b.id &&
		a.track === b.track &&
		a.dur > 0 &&
		b.dur > 0 &&
		b.start > a.start &&
		Math.abs(a.start + a.dur - b.start) <= BOUNDARY_TOLERANCE_SEC + 1e-6,
	);
}

/** The actual visual spans drawn on the base lane, plus free image/video clips. */
export function timelineVisualSpans(doc: TimelineDoc): VisualBoundaryClip[] {
	return doc.clips.flatMap((c) => {
		if (c.scene) {
			const primary = c.scene.visualClips?.[0],
				multi = doc.clips.some((v) => v.vis?.sceneId === c.scene!.id);
			return [
				{
					id: c.id,
					start: c.startSec + (multi ? (primary?.startSec ?? 0) : 0),
					dur: multi ? (primary?.durationSec ?? c.durationSec) : c.durationSec,
					track: -1,
				},
			];
		}
		if (c.vis) return [{ id: c.id, start: c.startSec, dur: c.durationSec, track: -1 }];
		return c.video ? [{ id: c.id, start: c.startSec, dur: c.durationSec, track: c.track }] : [];
	});
}

export function validTransition(t: TransitionClip, spans: readonly VisualBoundaryClip[]): boolean {
	const a = spans.find((c) => c.id === t.fromClipId),
		b = spans.find((c) => c.id === t.toClipId);
	return touchingBoundary(a, b);
}

/** Remove only requested pair records, and clear mirrored outgoing scene fallback. */
export function withoutTransitions<D extends TimelineDoc>(doc: D, ids: ReadonlySet<number>): D {
	if (!ids.size) return doc;
	const from = new Set(
		doc.clips.flatMap((c) =>
			c.transition && ids.has(c.transition.id) ? [c.transition.fromClipId] : [],
		),
	);
	return {
		...doc,
		clips: doc.clips
			.filter((c) => !c.transition || !ids.has(c.transition.id))
			.map((c) =>
				c.scene && from.has(c.id) ? { ...c, scene: { ...c.scene, transition: "cut" } } : c,
			),
	};
}

/** Call after all committed positions land, never while a drag is projected. */
export function pruneBrokenTransitions<D extends TimelineDoc>(doc: D): D {
	const spans = timelineVisualSpans(doc);
	return withoutTransitions(
		doc,
		new Set(
			doc.clips.flatMap((c) =>
				c.transition && !validTransition(c.transition, spans) ? [c.transition.id] : [],
			),
		),
	);
}
