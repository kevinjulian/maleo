/* The inspector's animation edits: what a clip or overlay can key, the key edits,
 * moments and their easing, pasted keys, edge presets and a row's keying at the
 * playhead. The rules live in the shared core (`crates/app-core/src/animation_edit.rs`,
 * `p1-envelope-inspector` task 3.4); each function here crosses once and throws
 * the engine's refusal as an `Error` with its message, as these edits always have. */
import type {
	Animation,
	AnimationProperty,
	KeyframeEasing,
	NumericAnimationProperty,
} from "@maleo/shared";
import { documentHandle, type EditorCommand, type EditScope } from "@maleo/shared/editor";
import {
	inspectorOp,
	type ClipAnimationInfo,
	type EditAnswer,
	type KeyMoment,
} from "@maleo/shared/editor/inspector-rules";
import type { Selection } from "./selection-model.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { SourceEditTarget } from "./source-audio-edit.ts";
import type { AnimationEdge, EdgePreset } from "@maleo/shared";

/** Any clip or overlay the inspector can key. */
export type ClipAnimationTarget = SourceEditTarget | { source: "text"; id: number };

export type { ClipAnimationInfo };

/** The handle holding `doc`, which every animation rule reads. */
const on = (doc: EditorDoc): number => documentHandle(doc);

/** An edit's command, or its refusal thrown with the engine's message. */
function commandOf(answer: EditAnswer | null): EditorCommand {
	if (!answer?.command) throw new Error(answer?.error ?? "Selected clip is unavailable");
	return answer.command;
}

export function applyEdgePreset(
	scope: EditScope,
	target: ClipAnimationTarget,
	edge: AnimationEdge,
	preset: EdgePreset,
	duration: number,
): EditorCommand {
	return commandOf(
		inspectorOp("anim.edge", { target, edge, preset, seconds: duration }, on(scope.doc)),
	);
}

export function animationTargetForId(doc: EditorDoc, id: string): ClipAnimationTarget | undefined {
	return inspectorOp("anim.target.forId", { id }, on(doc)) ?? undefined;
}

/** The timeline clip id that holds a target's animation (scene primary visual rides in `scene:`). */
export function clipIdForTarget(
	doc: EditorDoc,
	target: { source: ClipAnimationTarget["source"]; id: number; visualId?: string },
): string {
	return inspectorOp("anim.clipId", { target }, on(doc));
}

export function clipAnimationInfo(
	doc: EditorDoc,
	target: ClipAnimationTarget,
): ClipAnimationInfo | undefined {
	return inspectorOp("anim.info", { target }, on(doc)) ?? undefined;
}

/** Write a value at `time`; a key within the engine's 0.1 s snap is updated in place (keyframe-animation). */
export function editClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	time: number,
	value?: number,
	easing?: KeyframeEasing,
): EditorCommand {
	return commandOf(
		inspectorOp("anim.key.edit", { target, property, time, value, easing }, on(scope.doc)),
	);
}

export function removeClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	index: number,
): EditorCommand {
	return commandOf(inspectorOp("anim.key.remove", { target, property, index }, on(scope.doc)));
}

export function moveClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	index: number,
	time: number,
): EditorCommand {
	return commandOf(inspectorOp("anim.key.move", { target, property, index, time }, on(scope.doc)));
}

/** Resolve ordinary clip selection without changing the canonical document. */
export function selectedClipAnimationTarget(
	doc: EditorDoc,
	selection: Selection,
	visualChoice: { sceneId: number; visualId: string } | null,
): ClipAnimationTarget | undefined {
	return (
		inspectorOp("anim.target.selected", { selection, choice: visualChoice }, on(doc)) ?? undefined
	);
}

/** One moment on a clip: key times within a frame of each other, across every track. */
export type { KeyMoment };

/** The clip's moments in time order (keyframe-animation: keys shown on the selected clip). */
export function keyMoments(animation: Animation | undefined): KeyMoment[] {
	return inspectorOp("anim.moments", { animation: animation ?? null });
}

/** Every key at the given moments shifted by `delta` seconds, or removed when `delta` is
 *  undefined, as one batch. A shift that would leave the clip is clamped so the whole
 *  selection moves together. */
export function moveMoments(
	scope: EditScope,
	target: ClipAnimationTarget,
	times: readonly number[],
	delta?: number,
): EditorCommand {
	return commandOf(inspectorOp("anim.moments.move", { target, times, delta }, on(scope.doc)));
}

/** Every key at a moment moved to `to` (or removed when `to` is undefined), as one batch. */
export function moveMoment(
	scope: EditScope,
	target: ClipAnimationTarget,
	from: number,
	to?: number,
): EditorCommand {
	return commandOf(inspectorOp("anim.moment.move", { target, from, to }, on(scope.doc)));
}

/** The easing of every key at the given moments, as one batch. */
export function setMomentsEasing(
	scope: EditScope,
	target: ClipAnimationTarget,
	times: readonly number[],
	easing: KeyframeEasing,
	property?: AnimationProperty,
): EditorCommand {
	return commandOf(
		inspectorOp("anim.moments.easing", { target, times, easing, property }, on(scope.doc)),
	);
}

/** The easing of every key at one moment. */
export function setMomentEasing(
	scope: EditScope,
	target: ClipAnimationTarget,
	time: number,
	easing: KeyframeEasing,
): EditorCommand {
	return setMomentsEasing(scope, target, [time], easing);
}

/** Easings of every key at a moment (linear when unset). */
export function momentKeyEasings(animation: Animation | undefined, time: number): KeyframeEasing[] {
	return inspectorOp("anim.moment.easings", { animation: animation ?? null, time });
}

/** A clip's keyframes, copied whole (after OpenCut's keyframe clipboard). */
export type KeyframeClipboard = Animation;

export function copyClipKeys(
	doc: EditorDoc,
	target: ClipAnimationTarget,
): KeyframeClipboard | undefined {
	const animation = clipAnimationInfo(doc, target)?.animation;
	return animation && keyMoments(animation).length ? structuredClone(animation) : undefined;
}

/** Paste copied tracks onto a clip, replacing the tracks it has for those properties. Tracks
 *  the clip's kind cannot animate are skipped; anything else invalid refuses the whole paste. */
export function pasteClipKeys(
	scope: EditScope,
	target: ClipAnimationTarget,
	clipboard: KeyframeClipboard,
): EditorCommand {
	return commandOf(inspectorOp("anim.paste", { target, clipboard }, on(scope.doc)));
}

/** A row of keyable properties at the playhead (Position is X and Y): its key state,
 *  its values, and the commands its toggle and value edit make. */
export interface RowKeying {
	time: number;
	animated: boolean;
	keyed: boolean;
	toggleDisabled: boolean;
	valueDisabled: boolean;
	/** Each property sampled at the playhead (or static). Registry units. */
	values: Partial<Record<NumericAnimationProperty, number>>;
	/** Removes the keys at the playhead when keyed, else adds one per property. */
	toggle: (scope: EditScope) => EditorCommand;
	/** Keys every row property at the playhead, given values first. */
	set: (
		scope: EditScope,
		values: Partial<Record<NumericAnimationProperty, number>>,
	) => EditorCommand;
}

/** The row's keying at an absolute playhead time, or undefined when the target cannot key
 *  every property of the row. */
export function rowKeyingAt(
	doc: EditorDoc,
	target: ClipAnimationTarget,
	properties: readonly NumericAnimationProperty[],
	absolute: number,
	fps: number,
): RowKeying | undefined {
	const input = { target, properties, absolute, fps };
	const state = inspectorOp("anim.row", input, on(doc));
	if (!state) return undefined;
	return {
		...state,
		toggle: (scope) => commandOf(inspectorOp("anim.row.toggle", input, on(scope.doc))),
		set: (scope, values) =>
			commandOf(inspectorOp("anim.row.set", { ...input, values }, on(scope.doc))),
	};
}
