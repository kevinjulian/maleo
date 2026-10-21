/* Composition motion templates — the pure half.
 * A composition is a bundle of text/shape overlays stored with timing relative
 * to the selection's start; placing it expands the bundle back into ordinary
 * editable overlays at the playhead. The save that writes one is
 * `saveCompositionTemplate` in the api's templates module. */
import type { CompositionLayer, TextPreset } from "@maleo/shared";
import type {
	CompositionConfig,
	CompositionOverlayJson,
} from "@models/clip-templates/composition-config.ts";

/** Serialize overlays into a composition config, timing relative to the
 * earliest start and tracks relative to the lowest track. */
export function compositionFromOverlays(overlays: CompositionLayer[]): CompositionConfig {
	const t0 = Math.min(...overlays.map((o) => o.start));
	const track0 = Math.min(...overlays.map((o) => o.track ?? 0));
	const items = overlays.map((o): CompositionOverlayJson => ({
		relStart: Math.max(0, o.start - t0),
		dur: o.dur,
		preset: o.preset,
		content: o.content,
		track: (o.track ?? 0) - track0,
		params: o.params ?? undefined,
		style: o.style ?? undefined,
		layout: o.layout ?? undefined,
		anim: o.anim ?? undefined,
	}));
	const spanSec = Math.max(...items.map((i) => i.relStart + i.dur));
	return { overlays: items, spanSec };
}

/** The renderer id a stored composition overlay resolves to. The one place the
 *  claim is made; both the placement path and the tile preview call it. */
export function presetOfCompositionOverlay(
	overlay: Pick<CompositionOverlayJson, "preset"> | undefined,
): TextPreset {
	// SAFETY: the field is written by `compositionFromOverlays` above from a
	// `CompositionLayer.preset`, so every non-empty id came from the union. Stored
	// compositions do carry `preset: ""` (see `composition-overlays.test.ts`);
	// that case is defaulted before the assertion, not asserted through.
	return (overlay?.preset || "title") as TextPreset;
}

/** Rebuild placeable overlays from a stored composition at an absolute start.
 * Fresh ids; tracks offset from `baseTrack`. */
export function overlaysFromComposition(
	config: CompositionConfig,
	atSec: number,
	baseTrack = 0,
): CompositionLayer[] {
	const stamp = Date.now();
	// SAFETY: a stored composition's style/layout/anim are written only by
	// `compositionFromOverlays` above, from these same `CompositionLayer` fields.
	return (config.overlays ?? []).map((o, i): CompositionLayer => ({
		id: stamp + i,
		content: o.content ?? "",
		start: atSec + Math.max(0, o.relStart ?? 0),
		dur: Math.max(0.5, o.dur ?? 2),
		preset: presetOfCompositionOverlay(o),
		track: baseTrack + Math.max(0, o.track ?? 0),
		params: o.params,
		style: o.style as CompositionLayer["style"],
		layout: o.layout as CompositionLayer["layout"],
		anim: o.anim as CompositionLayer["anim"],
	}));
}
