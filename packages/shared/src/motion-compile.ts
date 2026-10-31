/* Motion compiler (motion-design-generation): a validated motion intent becomes a
 * composition of retained primitives whose layers carry the normalized `anim`
 * saved motion definitions use. The model chose layers, roles and states; this
 * decides every start time, curve and key from the motion tokens, so the same
 * intent always compiles to the same composition. */
import {
	easedCurve,
	geometryAt,
	MotionChannel,
	springCurve,
	type ChannelName,
	type EdgeName,
	type LayerChannels,
	type MotionCurve,
} from "./motion-channels.ts";
import {
	layersMovingIn,
	type MotionChange,
	type MotionIntent,
	type MotionLayer,
} from "./motion-intent.ts";
import { reduceSamples, sampleCurve, type MotionSample } from "./motion-spring.ts";
import {
	INDICATOR_TRAILING,
	MOTION_RULES,
	MOTION_SPRINGS,
	type MotionClass,
	type MotionSpring,
} from "./motion-tokens.ts";

import {
	compositionConfigSchema,
	type CompositionConfig,
	type CompositionOverlayJson,
} from "./composition-schema.ts";
import { PLAIN_TEXT_AUTHOR_STYLE } from "./visual-primitives.ts";

export interface MotionPalette {
	text: string;
	fontFamily: string;
}

export interface CompileMotionOptions {
	spanSec: number;
	palette?: Partial<MotionPalette>;
}

const DEFAULT_PALETTE: MotionPalette = {
	text: PLAIN_TEXT_AUTHOR_STYLE.fill,
	fontFamily: PLAIN_TEXT_AUTHOR_STYLE.fontFamily,
};
/** Default text size per class when the intent gives none. */
const FONT_SIZE: Readonly<Record<MotionClass, number>> = {
	headline: 96,
	body: 48,
	label: 40,
	container: 48,
	accent: 48,
	indicator: 48,
};

export interface LayerPlan {
	layer: MotionLayer;
	channels: LayerChannels;
	fromSec: number;
	toSec: number;
	fills: Array<{ startSec: number; to: string }>;
}

const scaled = (spring: MotionSpring, factor: number): MotionSpring => ({
	...spring,
	settleSec: spring.settleSec * factor,
});

/** Channels start at the rest pose, or at the hidden pose of a layer that enters. */
function newPlan(layer: MotionLayer): LayerPlan {
	const b = layer.box;
	const hidden = layer.enter ? hiddenTargets(layer, layer.enter.from, 1) : {};
	const x = hidden.x ?? [b.xPct, b.xPct + b.widthPct];
	const y = hidden.y ?? [b.yPct, b.yPct + b.heightPct];
	const initial: Record<ChannelName, number> = {
		left: x[0],
		right: x[1],
		top: y[0],
		bottom: y[1],
		scale: hidden.scale ?? 1,
		rotate: 0,
		opacity: layer.enter ? 0 : layer.opacity,
	};
	const channels: LayerChannels = {
		left: new MotionChannel(initial.left),
		right: new MotionChannel(initial.right),
		top: new MotionChannel(initial.top),
		bottom: new MotionChannel(initial.bottom),
		scale: new MotionChannel(initial.scale),
		rotate: new MotionChannel(initial.rotate),
		opacity: new MotionChannel(initial.opacity),
	};
	return {
		layer,
		channels,
		fromSec: layer.enter ? Number.POSITIVE_INFINITY : 0,
		toSec: 0,
		fills: [],
	};
}

/** Moves both edges of one axis. On the horizontal axis an indicator leads with
 *  the edge on the side it travels toward; the trailing edge follows later on a
 *  calmer spring. Vertical edges always move together: a thin underline that
 *  stretched vertically would read as a block. */
function moveAxis(
	plan: LayerPlan,
	edges: [EdgeName, EdgeName],
	targets: [number, number],
	startSec: number,
	spring: MotionSpring,
): number {
	const [a, b] = edges;
	const now = [plan.channels[a].valueAt(startSec), plan.channels[b].valueAt(startSec)];
	if (now[0] === targets[0] && now[1] === targets[1]) return startSec;
	const indicator = plan.layer.class === "indicator" && a === "left";
	const forward = targets[0] + targets[1] > now[0]! + now[1]!;
	const leading = forward ? 1 : 0;
	const ends = [0, 1].map((i) => {
		const trailing = indicator && i !== leading;
		const curve = springCurve(
			trailing
				? scaled(INDICATOR_TRAILING, spring.settleSec / MOTION_SPRINGS.indicator.settleSec)
				: spring,
		);
		const start = trailing ? startSec + INDICATOR_TRAILING.delaySec : startSec;
		return plan.channels[edges[i]!].moveTo(start, targets[i]!, curve);
	});
	return Math.max(...ends);
}

function moveValue(
	plan: LayerPlan,
	name: ChannelName,
	startSec: number,
	to: number,
	curve: MotionCurve,
): number {
	return plan.channels[name].moveTo(startSec, to, curve);
}

/** Offset of an entrance or exit, in frame percent. */
const offsetPct = (layer: MotionLayer) =>
	MOTION_RULES.heroOffsetPct * (layer.role === "hero" ? 1 : MOTION_RULES.secondaryOffsetRatio);

type Edges = [number, number];
const edges = (a: number, b: number): Edges => [a, b];

/** Where a layer rests while hidden: offset edges, a smaller scale, or neither. */
interface HiddenPose {
	x?: Edges;
	y?: Edges;
	scale?: number;
}

/** Hidden-side targets for an entrance (`sign` 1) or exit (`sign` -1). */
function hiddenTargets(layer: MotionLayer, direction: string, sign: 1 | -1): HiddenPose {
	const b = layer.box,
		o = offsetPct(layer) * sign;
	const x = edges(b.xPct, b.xPct + b.widthPct);
	const y = edges(b.yPct, b.yPct + b.heightPct);
	if (direction === "up") return { y: edges(y[0] + o, y[1] + o) };
	if (direction === "down") return { y: edges(y[0] - o, y[1] - o) };
	if (direction === "left") return { x: edges(x[0] + o, x[1] + o) };
	if (direction === "right") return { x: edges(x[0] - o, x[1] - o) };
	if (direction === "grow-x") return { x: edges(x[0], x[0]) };
	if (direction === "grow-y") return { y: edges(y[0], y[0]) };
	if (direction === "scale")
		return { scale: 1 - 0.15 * (offsetPct(layer) / MOTION_RULES.heroOffsetPct) };
	return {};
}

function enter(plan: LayerPlan, startSec: number): void {
	const layer = plan.layer,
		hidden = hiddenTargets(layer, layer.enter!.from, 1);
	const spring = MOTION_SPRINGS[layer.class];
	const b = layer.box;
	const ends = [
		hidden.x
			? moveAxis(plan, ["left", "right"], [b.xPct, b.xPct + b.widthPct], startSec, spring)
			: startSec,
		hidden.y
			? moveAxis(plan, ["top", "bottom"], [b.yPct, b.yPct + b.heightPct], startSec, spring)
			: startSec,
		hidden.scale !== undefined
			? moveValue(plan, "scale", startSec, 1, springCurve(spring))
			: startSec,
		moveValue(plan, "opacity", startSec, layer.opacity, easedCurve(MOTION_RULES.fadeInSec, "out")),
	];
	plan.fromSec = startSec;
	plan.toSec = Math.max(plan.toSec, ...ends);
}

function exit(plan: LayerPlan, startSec: number): void {
	const layer = plan.layer,
		hidden = hiddenTargets(layer, layer.exit!.to, -1);
	const spring = scaled(MOTION_SPRINGS[layer.class], MOTION_RULES.exitFactor);
	const ends = [
		hidden.x ? moveAxis(plan, ["left", "right"], hidden.x, startSec, spring) : startSec,
		hidden.y ? moveAxis(plan, ["top", "bottom"], hidden.y, startSec, spring) : startSec,
		hidden.scale !== undefined
			? moveValue(plan, "scale", startSec, hidden.scale, springCurve(spring))
			: startSec,
		moveValue(
			plan,
			"opacity",
			startSec,
			0,
			easedCurve(MOTION_RULES.fadeInSec * MOTION_RULES.exitFactor, "in"),
		),
	];
	plan.toSec = Math.max(...ends);
}

function change(plan: LayerPlan, c: MotionChange, startSec: number): void {
	const ch = plan.channels,
		spring = MOTION_SPRINGS[plan.layer.class];
	const left = ch.left.valueAt(startSec),
		top = ch.top.valueAt(startSec);
	const width = ch.right.valueAt(startSec) - left,
		height = ch.bottom.valueAt(startSec) - top;
	const ends: number[] = [startSec];
	if (c.xPct !== undefined || c.widthPct !== undefined) {
		const x = c.xPct ?? left;
		ends.push(moveAxis(plan, ["left", "right"], [x, x + (c.widthPct ?? width)], startSec, spring));
	}
	if (c.yPct !== undefined || c.heightPct !== undefined) {
		const y = c.yPct ?? top;
		ends.push(
			moveAxis(plan, ["top", "bottom"], [y, y + (c.heightPct ?? height)], startSec, spring),
		);
	}
	if (c.scale !== undefined)
		ends.push(moveValue(plan, "scale", startSec, c.scale, springCurve(spring)));
	if (c.rotationDeg !== undefined)
		ends.push(moveValue(plan, "rotate", startSec, c.rotationDeg, springCurve(spring)));
	if (c.opacity !== undefined)
		ends.push(
			moveValue(plan, "opacity", startSec, c.opacity, easedCurve(MOTION_RULES.fadeInSec, "in-out")),
		);
	if (c.fill !== undefined) plan.fills.push({ startSec, to: c.fill });
	plan.toSec = Math.max(plan.toSec, ...ends);
}

/** Start time of each moving layer in a state, from the motion tokens. */
export function stateStarts(
	intent: MotionIntent,
	stateId: string,
	atSec: number,
): Map<string, number> {
	const moving = layersMovingIn(intent, stateId);
	// The hero leads when it moves; otherwise the first non-ambient layer does.
	const leader =
		moving.find((l) => l.role === "hero") ?? moving.find((l) => l.role !== "ambient") ?? moving[0];
	const starts = new Map<string, number>();
	let k = 0;
	for (const layer of moving) {
		if (layer === leader) starts.set(layer.id, atSec);
		else starts.set(layer.id, atSec + MOTION_RULES.cascadeGapSec * ++k);
	}
	const container = moving.find((l) => l.class === "container");
	if (container) {
		const exiting = container.exit?.state === stateId;
		const settle = MOTION_SPRINGS.container.settleSec * (exiting ? MOTION_RULES.exitFactor : 1);
		starts.set(container.id, atSec);
		for (const layer of moving)
			if (layer.primitive === "plain")
				starts.set(layer.id, atSec + MOTION_RULES.textAfterContainer * settle);
	}
	return starts;
}

function sampleTrack(samples: MotionSample[]): MotionSample[] {
	const values = samples.map((s) => s.v);
	const range = Math.max(...values) - Math.min(...values);
	return reduceSamples(samples, Math.max(1e-4, MOTION_RULES.keyTolerance * range));
}

const round = (v: number) => Math.round(v * 1e4) / 1e4;

/** `normalized`: the composition form (box-relative `x`/`y`, `t` 0..1 of the
 *  layer). `seconds`: the timeline form (absolute frame-percent properties, `t`
 *  in clip-local seconds). */
export type MotionTrackForm = "normalized" | "seconds";

export function tracksOf(plan: LayerPlan, spanSec: number, form: MotionTrackForm = "normalized") {
	const { layer } = plan,
		b = layer.box;
	const from = Math.min(plan.fromSec, spanSec - 1 / MOTION_RULES.sampleHz);
	const to = Math.min(
		spanSec,
		Math.max(plan.layer.exit ? plan.toSec : spanSec, from + 1 / MOTION_RULES.sampleHz),
	);
	const drift = (t: number) =>
		layer.role === "ambient"
			? MOTION_RULES.ambientAmplitudePct *
				Math.sin((2 * Math.PI * t) / MOTION_RULES.ambientPeriodSec)
			: 0;
	const times = sampleCurve((t) => t, from, to, MOTION_RULES.sampleHz).map((s) => s.t);
	const geometry = times.map((t) => geometryAt(plan.channels, t, drift(t)));
	const norm = (t: number) => (form === "seconds" ? t - from : (t - from) / (to - from));
	// Each track: its stored name, its value per sample, and the value that needs no key.
	const series: Array<[string, number[], number]> =
		form === "seconds"
			? [
					["xPct", geometry.map((g) => g.left), b.xPct],
					["yPct", geometry.map((g) => g.top), b.yPct],
					["widthPct", geometry.map((g) => g.width), b.widthPct],
					["heightPct", geometry.map((g) => g.height), b.heightPct],
					["scale", geometry.map((g) => g.scale), 1],
					["rotationDeg", geometry.map((g) => g.rotate), 0],
					["opacity", geometry.map((g) => g.opacity), 1],
				]
			: [
					["x", geometry.map((g) => (g.width > 0.01 ? ((g.left - b.xPct) / g.width) * 100 : 0)), 0],
					[
						"y",
						geometry.map((g) => (g.height > 0.01 ? ((g.top - b.yPct) / g.height) * 100 : 0)),
						0,
					],
					["width", geometry.map((g) => g.width), b.widthPct],
					["height", geometry.map((g) => g.height), b.heightPct],
					["scale", geometry.map((g) => g.scale), 1],
					["rotate", geometry.map((g) => g.rotate), 0],
					["opacity", geometry.map((g) => g.opacity), 1],
				];
	const tracks: Record<string, Array<{ t: number; v: number; easing: "linear" }>> = {};
	for (const [name, values, neutral] of series) {
		if (values.every((v) => Math.abs(v - neutral) < 1e-6)) continue;
		const keys = sampleTrack(times.map((t, i) => ({ t, v: values[i]! })));
		tracks[name] = keys.map((k) => ({ t: norm(k.t), v: round(k.v), easing: "linear" }));
	}
	const fill = layer.text?.fill;
	const colorTracks = plan.fills.length
		? {
				fill: [
					{ t: 0, v: fill ?? DEFAULT_PALETTE.text, easing: "linear" as const },
					...plan.fills.flatMap((f, i) => [
						{
							t: norm(f.startSec),
							v: i === 0 ? (fill ?? DEFAULT_PALETTE.text) : plan.fills[i - 1]!.to,
							easing: "hold" as const,
						},
						{
							t: norm(Math.min(to, f.startSec + MOTION_RULES.fadeInSec)),
							v: f.to,
							easing: "in-out" as const,
						},
					]),
				].filter((k, i, all) => i === 0 || k.t > all[i - 1]!.t),
			}
		: undefined;
	return { from, to, tracks, colorTracks };
}

/** A layer's static look: text style for plain text, shape parameters for shapes. */
export function layerLook(layer: MotionLayer, palette: MotionPalette) {
	const text = layer.text;
	return layer.primitive === "plain"
		? {
				style: {
					fontFamily: palette.fontFamily,
					fontSize: text?.fontSize ?? FONT_SIZE[layer.class],
					weight: text?.weight ?? (layer.class === "headline" ? 800 : 500),
					fill: text?.fill ?? palette.text,
					align: text?.align ?? ("center" as const),
					...(text?.casing ? { casing: text.casing } : {}),
				},
			}
		: {
				params: {
					fill: layer.shape?.fill ?? "",
					...(layer.shape?.stroke ? { stroke: layer.shape.stroke } : {}),
					...(layer.shape?.strokeWidth !== undefined
						? { strokeWidth: layer.shape.strokeWidth }
						: {}),
					...(layer.shape?.radius !== undefined ? { radius: layer.shape.radius } : {}),
				},
			};
}

function overlayOf(
	plan: LayerPlan,
	index: number,
	spanSec: number,
	palette: MotionPalette,
): CompositionOverlayJson {
	const { layer } = plan,
		b = layer.box;
	const { from, to, tracks, colorTracks } = tracksOf(plan, spanSec);
	const anim =
		Object.keys(tracks).length || colorTracks
			? { tracks, ...(colorTracks ? { colorTracks } : {}) }
			: undefined;
	return {
		relStart: from,
		dur: to - from,
		preset: layer.primitive,
		content: layer.content,
		track: index,
		...layerLook(layer, palette),
		layout: {
			xPct: b.xPct,
			yPct: b.yPct,
			widthPct: b.widthPct,
			heightPct: b.heightPct,
			fit: "contain",
		},
		...(anim ? { anim } : {}),
	};
}

/** Compiles a validated intent into a composition spanning `spanSec`. */
export function compileMotion(
	intent: MotionIntent,
	options: CompileMotionOptions,
): CompositionConfig {
	const palette = { ...DEFAULT_PALETTE, ...options.palette };
	const plans = planIntent(intent);
	const overlays = intent.layers.map((layer, index) =>
		overlayOf(plans.get(layer.id)!, index, options.spanSec, palette),
	);
	return compositionConfigSchema.parse({ schemaVersion: 1, overlays, spanSec: options.spanSec });
}

/** Every layer's channels with all of the intent's moves applied, by layer id. */
export function planIntent(intent: MotionIntent): Map<string, LayerPlan> {
	const plans = new Map(intent.layers.map((layer) => [layer.id, newPlan(layer)]));
	for (const state of intent.states) {
		const starts = stateStarts(intent, state.id, state.atSec);
		for (const [layerId, startSec] of starts) {
			const plan = plans.get(layerId)!,
				layer = plan.layer;
			if (layer.enter?.state === state.id) enter(plan, startSec);
			const changed = state.changes.find((c) => c.layer === layerId);
			if (changed) change(plan, changed, startSec);
			if (layer.exit?.state === state.id) exit(plan, startSec);
		}
	}
	return plans;
}

export const resolvePalette = (palette?: Partial<MotionPalette>): MotionPalette => ({
	...DEFAULT_PALETTE,
	...palette,
});
