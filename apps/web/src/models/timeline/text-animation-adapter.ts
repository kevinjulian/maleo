/* Where a timeline text overlay (seconds `layout.animation`) meets the normalized
 * `OverlayAnim` that the text Animate section and saved compositions still speak.
 * Both directions use the overlay's rendered frame span and design decision 4's
 * box mapping, so a round trip is exact away from animated width/height. */
import {
	animationFromLegacyText,
	evaluateValueTrack,
	COLOR_ANIMATION_PROPERTY_NAMES,
	renderedSpanSec,
	type Animation,
	type ClipLayout,
	type ColorKeyframe,
	type CompositionLayer,
	type OverlayAnim,
	type TextOverlay,
	type ValueKeyframe,
} from "@maleo/shared";

type BoxLayout =
	| Pick<ClipLayout, "xPct" | "yPct" | "widthPct" | "heightPct" | "rotationDeg" | "opacity">
	| undefined;

/** Normalized Animate-section form → seconds animation for the overlay. */
export function overlayAnimToAnimation(
	anim: OverlayAnim | null,
	layout: BoxLayout,
	durationSec: number,
): Animation | undefined {
	return anim ? animationFromLegacyText(anim, layout, durationSec).animation : undefined;
}

/** Seconds animation → the normalized form the Animate section and compositions edit. */
export function animationToOverlayAnim(
	animation: Animation | undefined,
	layout: BoxLayout,
	durationSec: number,
): OverlayAnim | null {
	if (!animation) return null;
	const span = renderedSpanSec(durationSec),
		tracks = animation.tracks;
	const at = (
		keys: readonly ValueKeyframe[],
		value: (k: ValueKeyframe) => number,
	): ValueKeyframe[] =>
		keys.map((k) => ({ t: k.t / span, v: value(k), ...(k.easing ? { easing: k.easing } : {}) }));
	const width = (t: number) =>
		evaluateValueTrack(tracks.widthPct, t, layout?.widthPct ?? 100) || 100;
	const height = (t: number) =>
		evaluateValueTrack(tracks.heightPct, t, layout?.heightPct ?? 100) || 100;
	const opacityBase = layout?.opacity || 1;
	const out: OverlayAnim = { tracks: {} };
	if (tracks.xPct)
		out.tracks.x = at(tracks.xPct, (k) => ((k.v - (layout?.xPct ?? 0)) * 100) / width(k.t));
	if (tracks.yPct)
		out.tracks.y = at(tracks.yPct, (k) => ((k.v - (layout?.yPct ?? 0)) * 100) / height(k.t));
	if (tracks.scale) out.tracks.scale = at(tracks.scale, (k) => k.v);
	if (tracks.rotationDeg)
		out.tracks.rotate = at(tracks.rotationDeg, (k) => k.v - (layout?.rotationDeg ?? 0));
	if (tracks.opacity) out.tracks.opacity = at(tracks.opacity, (k) => k.v / opacityBase);
	if (tracks.widthPct) out.tracks.width = at(tracks.widthPct, (k) => k.v);
	if (tracks.heightPct) out.tracks.height = at(tracks.heightPct, (k) => k.v);
	for (const name of ["blur", "bgOpacity", "fontSize", "letterSpacing", "lineHeight"] as const)
		if (tracks[name]) out.tracks[name] = at(tracks[name], (k) => k.v);
	const colors = animation.colorTracks;
	for (const name of COLOR_ANIMATION_PROPERTY_NAMES) {
		const keys = colors?.[name];
		if (keys)
			out.colorTracks = {
				...out.colorTracks,
				[name]: keys.map((k: ColorKeyframe) => ({
					t: k.t / span,
					v: k.v,
					...(k.easing ? { easing: k.easing } : {}),
				})),
			};
	}
	return Object.keys(out.tracks).length || out.colorTracks ? out : null;
}

/** A timeline overlay as a composition layer: animation back in normalized form, box static. */
export function compositionLayerOf(overlay: TextOverlay): CompositionLayer {
	if (!overlay.layout) return { ...overlay, anim: null };
	const { animation, ...box } = overlay.layout;
	return {
		...overlay,
		layout: box,
		anim: animationToOverlayAnim(animation, overlay.layout, overlay.dur),
	};
}

/** The overlay's layout with `animation` replaced (removed when undefined). A missing
 *  layout takes the text renderer's own defaults, so placement does not move. */
export function withTextAnimation(
	overlay: Pick<TextOverlay, "layout">,
	animation: Animation | undefined,
): ClipLayout | undefined {
	if (!overlay.layout)
		return animation ? { xPct: 0, yPct: 0, widthPct: 100, fit: "contain", animation } : undefined;
	const { animation: _previous, ...box } = overlay.layout;
	return animation ? { ...box, animation } : box;
}
