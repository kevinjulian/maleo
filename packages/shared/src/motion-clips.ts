/* Motion as ordinary timeline clips (motion-design-generation, design D1): one clip
 * per layer, each on its own lane, with its keys in clip-local seconds on the
 * absolute properties the timeline already animates. Every key is then a key the
 * timeline shows and the user can move, which a sealed composition clip is not.
 *
 * Same plans as `compileMotion`, so both outputs draw the same motion. */
import { retimeClipAnimation, type Animation } from "./clip-animation.ts";
import type { CompositionConfig, CompositionOverlayJson } from "./composition-schema.ts";
import { animationFromLegacyText } from "./legacy-text-animation.ts";
import {
	layerLook,
	planIntent,
	resolvePalette,
	tracksOf,
	type CompileMotionOptions,
} from "./motion-compile.ts";
import type { MotionIntent } from "./motion-intent.ts";
import type { VisualPrimitiveId } from "./visual-primitives.ts";

export interface MotionClip {
	/** The intent layer this clip draws. */
	layerId: string;
	/** Lanes above the moment's first lane: the layer's paint order, back first. */
	lane: number;
	preset: VisualPrimitiveId;
	content: string;
	/** Relative to the moment's start. */
	startSec: number;
	durationSec: number;
	style?: CompositionOverlayJson["style"];
	params?: CompositionOverlayJson["params"];
	layout: {
		xPct: number;
		yPct: number;
		widthPct: number;
		heightPct: number;
		fit: "contain";
		animation?: Animation;
	};
}

/** Compiles a validated intent into one timeline clip per layer. */
export function compileMotionClips(
	intent: MotionIntent,
	options: CompileMotionOptions,
): MotionClip[] {
	const palette = resolvePalette(options.palette);
	const plans = planIntent(intent);
	return intent.layers.map((layer, lane): MotionClip => {
		const { from, to, tracks, colorTracks } = tracksOf(
			plans.get(layer.id)!,
			options.spanSec,
			"seconds",
		);
		const animated = Object.keys(tracks).length > 0 || colorTracks !== undefined;
		const b = layer.box;
		return {
			layerId: layer.id,
			lane,
			preset: layer.primitive,
			content: layer.content,
			startSec: from,
			durationSec: to - from,
			...layerLook(layer, palette),
			layout: {
				xPct: b.xPct,
				yPct: b.yPct,
				widthPct: b.widthPct,
				heightPct: b.heightPct,
				fit: "contain",
				...(animated ? { animation: { tracks, ...(colorTracks ? { colorTracks } : {}) } } : {}),
			},
		};
	});
}

/** A placed composition as one clip per layer (design D9), for a clip that plays
 *  it over `durationSec`. Layer timing stretches with the clip, as the renderers
 *  stretch it; normalized keys become clip-local seconds through the same
 *  conversion stored text animation is upgraded with. */
export function expandComposition(config: CompositionConfig, durationSec: number): MotionClip[] {
	const ratio = durationSec / config.spanSec;
	return config.overlays.map((overlay, index): MotionClip => {
		const layout = overlay.layout;
		const dur = overlay.dur * ratio;
		const base = {
			xPct: layout?.xPct ?? 0,
			yPct: layout?.yPct ?? 0,
			widthPct: layout?.widthPct ?? 100,
			heightPct: layout?.heightPct ?? 100,
		};
		const animation = layout?.animation
			? retimeClipAnimation(layout.animation, ratio)
			: overlay.anim
				? animationFromLegacyText(overlay.anim, base, dur).animation
				: undefined;
		return {
			layerId: String(index),
			lane: overlay.track ?? index,
			preset: overlay.preset,
			content: overlay.content,
			startSec: overlay.relStart * ratio,
			durationSec: dur,
			...(overlay.style ? { style: overlay.style } : {}),
			...(overlay.params ? { params: overlay.params } : {}),
			layout: { ...base, fit: "contain", ...(animation ? { animation } : {}) },
		};
	});
}
