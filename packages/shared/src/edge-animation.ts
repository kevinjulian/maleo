/* Entrance and exit presets as ordinary keys (`p1-envelope-inspector` task 3.4).
 * The rules (which ramp an edge holds, its state, and the track patches a preset
 * writes) live in the shared core (`crates/app-core/src/animation_edit.rs`), so
 * every client recognizes and writes the same ramps. */
import type { NumericAnimationProperty } from "./animation-properties.ts";
import type { Animation } from "./clip-animation.ts";
import type { ValueKeyframe } from "./timeline-model.ts";
import { inspectorOp, type EdgePresetName, type EdgeRamp } from "./editor/inspector-rules.ts";

export type AnimationEdge = "in" | "out";
export type EdgePreset = EdgePresetName;
type Values = Partial<Record<NumericAnimationProperty, number>>;

/** Exact edge ramps remain ordinary keys; editing keys naturally turns a preset into Custom. */
export function edgeAnimation(
	animation: Animation | undefined,
	edge: AnimationEdge,
	duration: number,
	values: Values,
	audio = false,
): EdgeRamp | undefined {
	const input = { animation: animation ?? null, edge, duration, values, audio };
	return inspectorOp("anim.edge.ramp", input) ?? undefined;
}

/** Distinguish unrecognized authored edge keys from an empty edge. */
export function edgeAnimationState(
	animation: Animation | undefined,
	edge: AnimationEdge,
	duration: number,
	values: Values,
	audio = false,
): EdgePreset | "custom" {
	return inspectorOp("anim.edge.state", {
		animation: animation ?? null,
		edge,
		duration,
		values,
		audio,
	});
}

/** Track patches for one edge. Other properties and keys outside its old/new window survive. */
export function edgeAnimationTracks(
	animation: Animation | undefined,
	edge: AnimationEdge,
	preset: EdgePreset,
	seconds: number,
	duration: number,
	values: Values,
	audio = false,
): Partial<Record<NumericAnimationProperty, ValueKeyframe[]>> {
	const input = { animation: animation ?? null, edge, preset, seconds, duration, values, audio };
	const result = inspectorOp("anim.edge.tracks", input);
	if (result.error !== undefined) throw new Error(result.error);
	return result.tracks ?? {};
}
