/* Reads a composition layer back into absolute geometry (motion-design-generation).
 * The motion lint and the compiler tests judge what will render, so they evaluate
 * the stored normalized keys with the same evaluator the renderers share, not the
 * compiler's own curves. */
import type { CompositionOverlayJson } from "./composition-schema.ts";
import { evaluateValueTrack } from "./keyframe-evaluation.ts";
import type { LayerGeometry } from "./motion-channels.ts";

export type { LayerGeometry } from "./motion-channels.ts";

/** Geometry at composition time `t`, or undefined outside the layer's window. */
export function overlayGeometryAt(
	overlay: CompositionOverlayJson,
	t: number,
): LayerGeometry | undefined {
	if (t < overlay.relStart - 1e-9 || t > overlay.relStart + overlay.dur + 1e-9) return undefined;
	const p = Math.min(1, Math.max(0, (t - overlay.relStart) / overlay.dur));
	const layout = overlay.layout ?? { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100 };
	const tracks = overlay.anim?.tracks ?? {};
	const width = evaluateValueTrack(tracks.width, p, layout.widthPct);
	const height = evaluateValueTrack(tracks.height, p, layout.heightPct ?? 100);
	return {
		left: layout.xPct + (evaluateValueTrack(tracks.x, p, 0) * width) / 100,
		top: layout.yPct + (evaluateValueTrack(tracks.y, p, 0) * height) / 100,
		width,
		height,
		scale: evaluateValueTrack(tracks.scale, p, 1),
		rotate: evaluateValueTrack(tracks.rotate, p, 0),
		opacity: evaluateValueTrack(tracks.opacity, p, 1),
	};
}

/** The layer's geometry across its whole window, sampled at `hz`, ends included. */
export function motionSamples(
	overlay: CompositionOverlayJson,
	hz: number,
): Array<{ t: number; g: LayerGeometry }> {
	const start = overlay.relStart,
		end = overlay.relStart + overlay.dur;
	const steps = Math.max(1, Math.round((end - start) * hz));
	return Array.from({ length: steps + 1 }, (_, i) => {
		const t = i === steps ? end : start + i / hz;
		return { t, g: overlayGeometryAt(overlay, t)! };
	});
}
