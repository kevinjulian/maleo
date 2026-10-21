/* What a value edit in Motion Studio writes — the input-to-layer half of the
 * inspector, with no React in it.
 *
 * Split out of `motion-studio-modal.tsx`. Each function here used to be a
 * closure over the modal's `mark` and `progress`; they read nothing else, so
 * they take both as arguments and return the patch the modal applies. The
 * modal still owns the one write (`upd`); this owns what an edit MEANS. */
import { evalColorTrack, evalTrack } from "@maleo/video/composition";
import type {
	AnimatableProp,
	ColorAnimatableProp,
	ColorKeyframe,
	CompositionLayer,
	MotionEasing,
	ValueKeyframe,
} from "@maleo/shared";
import type {
	MotionMarkSelection,
	MotionStudioTrack,
} from "@models/timeline/motion-vui-adapter.ts";
import { PROP_BASE, hexInput, layoutOf, writeColorKey, writeKey } from "./motion-keyframes.ts";

type MarkSel = MotionMarkSelection;
type StudioTrack = MotionStudioTrack;
type LayerPatch = Partial<CompositionLayer>;

export const PROP_LABEL = {
	x: "X %",
	y: "Y %",
	scale: "Scale",
	rotate: "Rotate°",
	opacity: "Opacity",
	width: "W %",
	height: "H %",
	blur: "Blur px",
	bgOpacity: "BG opacity",
	fontSize: "Font px",
	letterSpacing: "Tracking px",
	lineHeight: "Line height",
} satisfies Record<AnimatableProp, string>;
export const PROP_STEP = {
	x: 1,
	y: 1,
	scale: 0.05,
	rotate: 1,
	opacity: 0.05,
	width: 1,
	height: 1,
	blur: 1,
	bgOpacity: 0.05,
	fontSize: 1,
	letterSpacing: 0.5,
	lineHeight: 0.05,
} satisfies Record<AnimatableProp, number>;
export const COLOR_LABEL = {
	fill: "Text",
	bodyFill: "Body",
	accent: "Accent",
	background: "BG color",
} satisfies Record<ColorAnimatableProp, string>;
const COLOR_FALLBACK = {
	fill: "#ffffff",
	bodyFill: "#ffffff",
	accent: "#7C66FF",
	background: "#000000",
} satisfies Record<ColorAnimatableProp, string>;
export const EASINGS: MotionEasing[] = ["linear", "in", "out", "in-out", "bezier"];
export const EASING_LABEL = {
	linear: "Linear",
	in: "Ease in",
	out: "Ease out",
	"in-out": "In-out",
	bezier: "Expo",
} satisfies Record<MotionEasing, string>;

export const markLabel = (sel: MarkSel): string =>
	sel.kind === "value" ? PROP_LABEL[sel.prop] : COLOR_LABEL[sel.prop];

export const markSelection = (layerId: number, track: StudioTrack, index: number): MarkSel =>
	track.kind === "value"
		? { layerId, kind: "value", prop: track.prop, index }
		: { layerId, kind: "color", prop: track.prop, index };

export const valueTrackPatch = (
	layer: CompositionLayer,
	prop: AnimatableProp,
	kfs: ValueKeyframe[] | undefined,
): LayerPatch => {
	const tracks = { ...layer.anim?.tracks };
	if (kfs && kfs.length > 0) tracks[prop] = kfs;
	else delete tracks[prop];
	const colorTracks = { ...layer.anim?.colorTracks };
	const any =
		Object.values(tracks).some((k) => k && k.length > 0) ||
		Object.values(colorTracks).some((k) => k && k.length > 0);
	return {
		anim: any ? { tracks, ...(Object.keys(colorTracks).length ? { colorTracks } : {}) } : null,
	};
};
export const colorTrackPatch = (
	layer: CompositionLayer,
	prop: ColorAnimatableProp,
	kfs: ColorKeyframe[] | undefined,
): LayerPatch => {
	const tracks = { ...layer.anim?.tracks };
	const colorTracks = { ...layer.anim?.colorTracks };
	if (kfs && kfs.length > 0) colorTracks[prop] = kfs;
	else delete colorTracks[prop];
	const any =
		Object.values(tracks).some((k) => k && k.length > 0) ||
		Object.values(colorTracks).some((k) => k && k.length > 0);
	return {
		anim: any ? { tracks, ...(Object.keys(colorTracks).length ? { colorTracks } : {}) } : null,
	};
};

/** Displayed value: placement/style props read from static base + animated override. */
export const displayValue = (
	layer: CompositionLayer,
	prop: AnimatableProp,
	mark: MarkSel | null,
	progress: number,
): number => {
	const layoutBase =
		prop === "x" ? (layer.layout?.xPct ?? 0) : prop === "y" ? (layer.layout?.yPct ?? 0) : 0;
	const styleBase =
		prop === "bgOpacity"
			? (layer.style?.bgOpacity ?? 0)
			: prop === "fontSize"
				? (layer.style?.fontSize ?? PROP_BASE.fontSize)
				: prop === "letterSpacing"
					? (layer.style?.letterSpacing ?? 0)
					: prop === "lineHeight"
						? (layer.style?.lineHeight ?? PROP_BASE.lineHeight)
						: 0;
	const boxBase =
		prop === "width"
			? (layer.layout?.widthPct ?? 100)
			: prop === "height"
				? (layer.layout?.heightPct ?? 100)
				: styleBase;
	if (mark?.kind === "value" && mark.layerId === layer.id && mark.prop === prop) {
		const k = layer.anim?.tracks[prop]?.[mark.index];
		if (k) return prop === "x" || prop === "y" ? layoutBase + k.v : k.v;
	}
	const fallback =
		prop === "width" ||
		prop === "height" ||
		prop === "bgOpacity" ||
		prop === "fontSize" ||
		prop === "letterSpacing" ||
		prop === "lineHeight"
			? boxBase
			: PROP_BASE[prop];
	const v = evalTrack(layer.anim?.tracks[prop], progress, fallback);
	return prop === "x" || prop === "y" ? layoutBase + v : v;
};

/** Single write path: selected mark → edit that key; t≈0 with no track →
 * static (layout move / constant); otherwise auto-key at the playhead. */
export const valueEditPatch = (
	layer: CompositionLayer,
	prop: AnimatableProp,
	display: number,
	mark: MarkSel | null,
	progress: number,
): LayerPatch => {
	const isXY = prop === "x" || prop === "y";
	const isLayoutSize = prop === "width" || prop === "height";
	const isStyleBase =
		prop === "bgOpacity" ||
		prop === "fontSize" ||
		prop === "letterSpacing" ||
		prop === "lineHeight";
	const layoutBase =
		prop === "x" ? (layer.layout?.xPct ?? 0) : prop === "y" ? (layer.layout?.yPct ?? 0) : 0;
	const staticBase =
		prop === "width"
			? (layer.layout?.widthPct ?? 100)
			: prop === "height"
				? (layer.layout?.heightPct ?? 100)
				: prop === "bgOpacity"
					? (layer.style?.bgOpacity ?? 0)
					: prop === "fontSize"
						? (layer.style?.fontSize ?? PROP_BASE.fontSize)
						: prop === "letterSpacing"
							? (layer.style?.letterSpacing ?? 0)
							: prop === "lineHeight"
								? (layer.style?.lineHeight ?? PROP_BASE.lineHeight)
								: PROP_BASE[prop];
	const v = isXY ? display - layoutBase : display;
	const kfs = layer.anim?.tracks[prop];
	if (
		mark?.kind === "value" &&
		mark.layerId === layer.id &&
		mark.prop === prop &&
		kfs?.[mark.index]
	) {
		return valueTrackPatch(
			layer,
			prop,
			kfs.map((k, i) => (i === mark.index ? { ...k, v } : k)),
		);
	}
	if (!kfs) {
		if (progress < 0.02) {
			// Static edit: placement/style props update their owning static field;
			// transform/filter props hold as a single base key.
			if (isXY)
				return { layout: { ...layoutOf(layer), [prop === "x" ? "xPct" : "yPct"]: display } };
			if (isLayoutSize)
				return {
					layout: { ...layoutOf(layer), [prop === "width" ? "widthPct" : "heightPct"]: display },
				};
			if (isStyleBase) {
				// SAFETY: the spread and the write are both sound; the TYPE is not
				// expressible. A computed key widens the object to an index
				// signature, and under `exactOptionalPropertyTypes` the spread also
				// re-adds `| undefined` to every optional field it copies. `prop` is
				// a style key by construction — `isStyleBase` is what selects this
				// branch — so the value lands where it belongs.
				const style = { ...layer.style, [prop]: display } as CompositionLayer["style"];
				return { style };
			}
			return valueTrackPatch(layer, prop, [{ t: 0, v, easing: "linear" }]);
		}
		// First animated edit: base holds at t=0, new value at the playhead.
		return valueTrackPatch(
			layer,
			prop,
			writeKey([{ t: 0, v: isXY ? 0 : staticBase, easing: "linear" }], progress, v),
		);
	}
	return valueTrackPatch(layer, prop, writeKey(kfs, progress, v));
};

export const colorBase = (layer: CompositionLayer, prop: ColorAnimatableProp): string =>
	hexInput(
		prop === "bodyFill" ? (layer.style?.bodyFill ?? layer.style?.fill) : layer.style?.[prop],
		COLOR_FALLBACK[prop],
	);

export const displayColor = (
	layer: CompositionLayer,
	prop: ColorAnimatableProp,
	mark: MarkSel | null,
	progress: number,
): string => {
	if (mark?.kind === "color" && mark.layerId === layer.id && mark.prop === prop) {
		const k = layer.anim?.colorTracks?.[prop]?.[mark.index];
		if (k) return hexInput(k.v, COLOR_FALLBACK[prop]);
	}
	return hexInput(
		evalColorTrack(layer.anim?.colorTracks?.[prop], progress, colorBase(layer, prop)),
		COLOR_FALLBACK[prop],
	);
};

export const colorEditPatch = (
	layer: CompositionLayer,
	prop: ColorAnimatableProp,
	color: string,
	mark: MarkSel | null,
	progress: number,
): LayerPatch => {
	const v = hexInput(color, COLOR_FALLBACK[prop]);
	const kfs = layer.anim?.colorTracks?.[prop];
	if (
		mark?.kind === "color" &&
		mark.layerId === layer.id &&
		mark.prop === prop &&
		kfs?.[mark.index]
	) {
		return colorTrackPatch(
			layer,
			prop,
			kfs.map((k, i) => (i === mark.index ? { ...k, v } : k)),
		);
	}
	if (!kfs) {
		if (progress < 0.02) {
			// SAFETY: as above — a computed key plus `exactOptionalPropertyTypes`.
			// `prop` is a `ColorAnimatableProp`, which is a subset of the style's
			// own keys, and `v` is the hex string that key holds.
			const style = { ...layer.style, [prop]: v } as CompositionLayer["style"];
			return { style };
		}
		return colorTrackPatch(
			layer,
			prop,
			writeColorKey([{ t: 0, v: colorBase(layer, prop), easing: "linear" }], progress, v),
		);
	}
	return colorTrackPatch(layer, prop, writeColorKey(kfs, progress, v));
};

/* Run an operation against whichever keyframe track a selection names.
 *
 * The two branches cannot share one body: `sel.kind` narrows the SELECTION,
 * and every call site here used to read the array in a separate statement,
 * which the narrowing cannot reach — hence a wall of `as ValueKeyframe[]`
 * telling the compiler what the line above already proved. Passing the branch
 * bodies in keeps the kind and the array type correlated instead. */
export function onTrack(
	layer: CompositionLayer | undefined,
	sel: StudioTrack,
	value: (layer: CompositionLayer, kfs: ValueKeyframe[], prop: AnimatableProp) => void,
	color: (layer: CompositionLayer, kfs: ColorKeyframe[], prop: ColorAnimatableProp) => void,
): void {
	if (!layer) return;
	if (sel.kind === "value") {
		const kfs = layer.anim?.tracks[sel.prop];
		if (kfs) value(layer, kfs, sel.prop);
		return;
	}
	const kfs = layer.anim?.colorTracks?.[sel.prop];
	if (kfs) color(layer, kfs, sel.prop);
}
