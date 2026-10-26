/* Composition motion templates — the pure half.
 * A composition is a bundle of text/shape overlays stored with timing relative
 * to the selection's start; placing it expands the bundle back into ordinary
 * editable overlays at the playhead. The save that writes one is
 * `saveCompositionTemplate` in the api's templates module. */
import {
	compositionConfigSchema,
	isVisualPrimitive,
	type CompositionLayer,
	type TextPreset,
} from "@maleo/shared";
import type {
	CompositionConfig,
	CompositionOverlayJson,
} from "@models/clip-templates/composition-config.ts";

/** Serialize overlays into a composition config, timing relative to the
 * earliest start and tracks relative to the lowest track. */
export function compositionFromOverlays(
	overlays: CompositionLayer[],
	spanSec?: number,
): CompositionConfig {
	const t0 = spanSec === undefined ? Math.min(...overlays.map((o) => o.start)) : 0;
	const track0 = spanSec === undefined ? Math.min(...overlays.map((o) => o.track ?? 0)) : 0;
	const items = overlays.map((o): CompositionOverlayJson => ({
		relStart: Math.max(0, o.start - t0),
		dur: o.dur,
		preset: primitivePreset(o.preset),
		content: o.content,
		track: (o.track ?? 0) - track0,
		params: o.params ?? undefined,
		style: o.style ?? undefined,
		layout: o.layout ?? undefined,
		anim: o.anim ?? undefined,
	}));
	const span = spanSec ?? Math.max(...items.map((i) => i.relStart + i.dur));
	return compositionConfigSchema.parse({ schemaVersion: 1, overlays: items, spanSec: span });
}

function primitivePreset(preset: string) {
	if (!isVisualPrimitive(preset))
		throw new Error(`Unsupported composition primitive: ${preset}. Reload or repair this layer.`);
	return preset;
}

/** The renderer id a stored composition overlay resolves to. The one place the
 *  claim is made; both the placement path and the tile preview call it. */
export function presetOfCompositionOverlay(
	overlay: Pick<CompositionOverlayJson, "preset"> | undefined,
): TextPreset {
	return primitivePreset(overlay?.preset ?? "");
}

/** Rebuild placeable overlays from a stored composition at an absolute start.
 * Fresh ids; tracks offset from `baseTrack`. */
export function overlaysFromComposition(
	config: CompositionConfig,
	atSec: number,
	baseTrack = 0,
): CompositionLayer[] {
	const stamp = Date.now();
	return compositionConfigSchema.parse(config).overlays.map((o, i): CompositionLayer => ({
		id: stamp + i,
		content: o.content ?? "",
		start: atSec + o.relStart,
		dur: o.dur,
		preset: presetOfCompositionOverlay(o),
		track: baseTrack + (o.track ?? 0),
		params: o.params,
		style: o.style,
		layout: o.layout,
		anim: o.anim,
	}));
}
