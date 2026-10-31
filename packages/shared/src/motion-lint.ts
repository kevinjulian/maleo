/* Motion lint (motion-design-generation): findings about a composition's motion,
 * read from its stored keys, never from the intent that produced it, so the same
 * check applies to generated and hand-made compositions. Findings are reported,
 * never enforced: a placement is not refused because of one. */
import type { CompositionConfig, CompositionOverlayJson } from "./composition-schema.ts";
import { motionSamples, type LayerGeometry } from "./motion-geometry.ts";
import { readingTimeSec } from "./motion-tokens.ts";

export const MOTION_LINT_CODES = [
	"simultaneous_large_moves",
	"reading_time",
	"same_frame_entrance",
	"exit_longer_than_entrance",
	"off_frame_at_rest",
] as const;
export type MotionLintCode = (typeof MOTION_LINT_CODES)[number];

export interface MotionLintFinding {
	code: MotionLintCode;
	/** Index of the layer in the composition. */
	layer: number;
	/** Composition time, seconds. */
	atSec: number;
	message: string;
}

const HZ = 60;
const FRAME = 1 / HZ;
/** A move larger than this, in frame percent, is a large move. */
const LARGE_MOVE_PCT = 5;
const EPS = { position: 0.01, scale: 0.0005, rotate: 0.05, opacity: 0.002 };

interface Segment {
	start: number;
	end: number;
	amplitude: number;
}

const shapeDelta = (a: LayerGeometry, b: LayerGeometry) =>
	Math.max(
		Math.abs(a.left - b.left),
		Math.abs(a.top - b.top),
		Math.abs(a.width - b.width),
		Math.abs(a.height - b.height),
	);

function changing(a: LayerGeometry, b: LayerGeometry, withOpacity: boolean): boolean {
	return (
		shapeDelta(a, b) > EPS.position ||
		Math.abs(a.scale - b.scale) > EPS.scale ||
		Math.abs(a.rotate - b.rotate) > EPS.rotate ||
		(withOpacity && Math.abs(a.opacity - b.opacity) > EPS.opacity)
	);
}

/** Contiguous stretches where the layer changes, with how far it travelled. */
function segments(samples: ReturnType<typeof motionSamples>, withOpacity: boolean): Segment[] {
	const out: Segment[] = [];
	let open: { start: number; from: LayerGeometry; amplitude: number; end: number } | undefined;
	for (let i = 1; i < samples.length; i++) {
		const a = samples[i - 1]!,
			b = samples[i]!;
		if (changing(a.g, b.g, withOpacity)) {
			open ??= { start: a.t, from: a.g, amplitude: 0, end: b.t };
			open.end = b.t;
			open.amplitude = Math.max(
				open.amplitude,
				shapeDelta(open.from, b.g),
				Math.abs(open.from.scale - b.g.scale) * 50,
			);
		} else if (open) {
			out.push({ start: open.start, end: open.end, amplitude: open.amplitude });
			open = undefined;
		}
	}
	if (open) out.push({ start: open.start, end: open.end, amplitude: open.amplitude });
	return out;
}

interface LayerMotion {
	index: number;
	overlay: CompositionOverlayJson;
	samples: ReturnType<typeof motionSamples>;
	moves: Segment[];
	changes: Segment[];
	enters: boolean;
	exits: boolean;
	continuous: boolean;
}

function analyse(overlay: CompositionOverlayJson, index: number): LayerMotion {
	const samples = motionSamples(overlay, HZ);
	const moves = segments(samples, false),
		changes = segments(samples, true);
	const first = samples[0]!.g,
		last = samples[samples.length - 1]!.g;
	const covered = moves.reduce((sum, s) => sum + (s.end - s.start), 0);
	return {
		index,
		overlay,
		samples,
		moves,
		changes,
		enters: first.opacity < 0.05,
		exits: samples.length > 1 && last.opacity < 0.05,
		continuous: covered >= 0.9 * overlay.dur,
	};
}

function simultaneousMoves(layers: LayerMotion[]): MotionLintFinding[] {
	const starts = layers
		.filter((l) => !l.continuous)
		.flatMap((l) =>
			l.moves
				.filter((m) => m.amplitude > LARGE_MOVE_PCT)
				.map((m) => ({ layer: l.index, t: m.start })),
		)
		.sort((a, b) => a.t - b.t);
	return starts.flatMap((s, i) => {
		const next = starts[i + 1];
		return next && next.layer !== s.layer && next.t - s.t < FRAME / 2
			? [
					{
						code: "simultaneous_large_moves" as const,
						layer: next.layer,
						atSec: next.t,
						message: `layers ${s.layer} and ${next.layer} start large moves on the same frame`,
					},
				]
			: [];
	});
}

function readingTime(layer: LayerMotion): MotionLintFinding[] {
	if (layer.overlay.preset !== "plain") return [];
	const need = readingTimeSec(layer.overlay.content);
	return layer.changes.slice(1).flatMap((next, i) => {
		const hold = next.start - layer.changes[i]!.end;
		return hold < need - 1e-6
			? [
					{
						code: "reading_time" as const,
						layer: layer.index,
						atSec: next.start,
						message: `text holds ${hold.toFixed(2)}s but needs ${need.toFixed(2)}s to be read`,
					},
				]
			: [];
	});
}

function sameFrameEntrance(layers: LayerMotion[]): MotionLintFinding[] {
	const entering = layers.filter((l) => l.enters);
	if (entering.length < 2 || layers.length < 2) return [];
	const times = entering.map((l) => l.overlay.relStart);
	return Math.max(...times) - Math.min(...times) < FRAME / 2
		? [
				{
					code: "same_frame_entrance",
					layer: entering[0]!.index,
					atSec: times[0]!,
					message: "every entering layer starts on the same frame",
				},
			]
		: [];
}

function exitLonger(layer: LayerMotion): MotionLintFinding[] {
	if (!layer.enters || !layer.exits || layer.changes.length < 2) return [];
	const entrance = layer.changes[0]!,
		exit = layer.changes[layer.changes.length - 1]!;
	return exit.end - exit.start > entrance.end - entrance.start + FRAME
		? [
				{
					code: "exit_longer_than_entrance",
					layer: layer.index,
					atSec: exit.start,
					message: "exit is longer than entrance",
				},
			]
		: [];
}

function offFrame(layer: LayerMotion): MotionLintFinding[] {
	const resting = (t: number) => !layer.changes.some((c) => t >= c.start && t <= c.end);
	const out = layer.samples.find(({ t, g }) => {
		if (!resting(t) || g.opacity < 0.05) return false;
		const w = g.width * g.scale,
			h = g.height * g.scale;
		const cx = g.left + g.width / 2,
			cy = g.top + g.height / 2;
		return cx - w / 2 < -1 || cx + w / 2 > 101 || cy - h / 2 < -1 || cy + h / 2 > 101;
	});
	return out
		? [
				{
					code: "off_frame_at_rest",
					layer: layer.index,
					atSec: out.t,
					message: "layer rests partly outside the frame",
				},
			]
		: [];
}

/** Findings for a composition, ordered by time. An empty list means clean motion. */
export function lintMotion(config: CompositionConfig): MotionLintFinding[] {
	const layers = config.overlays.map(analyse);
	return [
		...simultaneousMoves(layers),
		...layers.flatMap(readingTime),
		...sameFrameEntrance(layers),
		...layers.flatMap(exitLonger),
		...layers.flatMap(offFrame),
	].sort((a, b) => a.atSec - b.atSec || a.layer - b.layer);
}
