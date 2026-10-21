/* Read-time upgrade of legacy text overlay animation (`OverlayAnim`) into the one
 * animation model (keyframe-animation; storyboard-document-contract).
 *
 * Timing is frame-exact: legacy keys were normalized over the overlay's rendered
 * frames, `floor(dur * RENDER_FPS)`, so `t` scales by that span in seconds and
 * every converted key lands on the frame it rendered on before.
 *
 * Legacy motion moved the text inside a fixed box (offset as a percent of the
 * box, scale/rotate about the box centre, opacity on the content). The model has
 * one set of box properties, so that motion folds into them: the user accepted
 * an approximate render for old text over a second set of properties. */
import { RENDER_FPS } from "./render-fps.ts";
import { evaluateValueTrack } from "./keyframe-evaluation.ts";
import { textAnimationSchema, type Animation } from "./clip-animation.ts";
import {
	COLOR_ANIMATION_PROPERTY_NAMES,
	KEYFRAME_EASINGS,
	type NumericAnimationProperty,
} from "./animation-properties.ts";
import { entriesOfUnknown } from "./object-keys.ts";
import { z } from "zod";
import type { ClipLayout, ColorKeyframe, ValueKeyframe } from "./timeline-model.ts";

export interface LegacyTextConversion {
	/** Undefined when nothing convertible remained. */
	animation?: Animation;
	/** Legacy track names that were malformed and dropped. */
	dropped: string[];
}

type LegacyLayout =
	| Pick<ClipLayout, "xPct" | "yPct" | "widthPct" | "heightPct" | "rotationDeg" | "opacity">
	| undefined;

/** Seconds spanned by the overlay's rendered frames. */
export function renderedSpanSec(durationSec: number): number {
	return Math.max(1, Math.floor(durationSec * RENDER_FPS)) / RENDER_FPS;
}

/* Legacy keys as stored: finite numbers (or a colour string) with an optional
 * easing. Extra fields are ignored; anything else marks the track malformed. */
const legacyValueTrack = z.array(
	z.object({
		t: z.number().finite(),
		v: z.number().finite(),
		easing: z.enum(KEYFRAME_EASINGS).optional(),
	}),
);
const legacyColorTrack = z.array(
	z.object({ t: z.number().finite(), v: z.string(), easing: z.enum(KEYFRAME_EASINGS).optional() }),
);

/** Legacy content-motion names, by the box/style property each becomes. */
const LEGACY_NAMES: readonly (readonly [NumericAnimationProperty, string])[] = [
	["xPct", "x"],
	["yPct", "y"],
	["scale", "scale"],
	["rotationDeg", "rotate"],
	["opacity", "opacity"],
	["widthPct", "width"],
	["heightPct", "height"],
	["blur", "blur"],
	["bgOpacity", "bgOpacity"],
	["fontSize", "fontSize"],
	["letterSpacing", "letterSpacing"],
	["lineHeight", "lineHeight"],
];

/** Convert one legacy text animation. Never throws; malformed tracks are dropped and named. */
export function animationFromLegacyText(
	anim: unknown,
	layout: LegacyLayout,
	durationSec: number,
): LegacyTextConversion {
	const dropped: string[] = [];
	const tracks = new Map(
		entriesOfUnknown(entriesOfUnknown(anim).find(([key]) => key === "tracks")?.[1]),
	);
	const colors = new Map(
		entriesOfUnknown(entriesOfUnknown(anim).find(([key]) => key === "colorTracks")?.[1]),
	);
	const span = renderedSpanSec(Number.isFinite(durationSec) && durationSec > 0 ? durationSec : 0);
	const valid = (name: string): ValueKeyframe[] | undefined => {
		if (!tracks.has(name)) return undefined;
		const parsed = legacyValueTrack.safeParse(tracks.get(name));
		if (!parsed.success) {
			dropped.push(name);
			return undefined;
		}
		return parsed.data;
	};
	const width = valid("width"),
		height = valid("height");
	const boxWidth = (t: number) => evaluateValueTrack(width, t, layout?.widthPct ?? 100);
	const boxHeight = (t: number) => evaluateValueTrack(height, t, layout?.heightPct ?? 100);
	const mapped: Partial<Record<NumericAnimationProperty, (k: ValueKeyframe) => number>> = {
		xPct: (k) => (layout?.xPct ?? 0) + (k.v * boxWidth(k.t)) / 100,
		yPct: (k) => (layout?.yPct ?? 0) + (k.v * boxHeight(k.t)) / 100,
		scale: (k) => k.v,
		rotationDeg: (k) => (layout?.rotationDeg ?? 0) + k.v,
		opacity: (k) => (layout?.opacity ?? 1) * k.v,
	};
	const out: Animation = { tracks: {} };
	for (const [property, name] of LEGACY_NAMES) {
		const keys = name === "width" ? width : name === "height" ? height : valid(name);
		if (!keys?.length) continue;
		const value = mapped[property] ?? ((k: ValueKeyframe) => k.v);
		const converted = keys.map((k) => ({
			t: k.t * span,
			v: value(k),
			...(k.easing ? { easing: k.easing } : {}),
		}));
		if (textAnimationSchema.safeParse({ tracks: { [property]: converted } }).success)
			out.tracks[property] = converted;
		else dropped.push(name);
	}
	for (const name of COLOR_ANIMATION_PROPERTY_NAMES) {
		if (!colors.has(name)) continue;
		const parsed = legacyColorTrack.safeParse(colors.get(name));
		if (!parsed.success) {
			dropped.push(name);
			continue;
		}
		if (!parsed.data.length) continue;
		const converted: ColorKeyframe[] = parsed.data.map((k) => ({
			t: k.t * span,
			v: k.v,
			...(k.easing ? { easing: k.easing } : {}),
		}));
		if (textAnimationSchema.safeParse({ tracks: {}, colorTracks: { [name]: converted } }).success)
			out.colorTracks = { ...out.colorTracks, [name]: converted };
		else dropped.push(name);
	}
	const known = new Set<string>([
		...LEGACY_NAMES.map(([, name]) => name),
		...COLOR_ANIMATION_PROPERTY_NAMES,
	]);
	for (const name of [...tracks.keys(), ...colors.keys()]) if (!known.has(name)) dropped.push(name);
	const empty = !Object.keys(out.tracks).length && !out.colorTracks;
	return { ...(empty ? {} : { animation: out }), dropped: [...new Set(dropped)] };
}
