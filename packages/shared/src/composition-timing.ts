import type { CompositionOverlayJson } from "./composition-schema.ts";

/** Keep the existing scale/multiply order: changing it can move a boundary one frame. */
export function compositionLayerTiming(
	layer: Pick<CompositionOverlayJson, "relStart" | "dur">,
	spanSec: number,
	frames: number,
	fps: number,
) {
	if (
		![spanSec, frames, fps, layer.dur].every((n) => Number.isFinite(n) && n > 0) ||
		!Number.isFinite(layer.relStart) ||
		layer.relStart < 0
	)
		throw new RangeError("Invalid composition timing");
	const scale = frames / fps / spanSec;
	return {
		from: Math.max(0, Math.floor(layer.relStart * scale * fps)),
		durationInFrames: Math.max(1, Math.floor(layer.dur * scale * fps)),
	};
}
