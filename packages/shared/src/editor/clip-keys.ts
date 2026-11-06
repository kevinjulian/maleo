/* `clip.setKeys`: replace one property track of one clip (keyframe-animation).
 * Every key edit (inspector, key lanes, canvas auto-key, agent) is this command or
 * a batch of it. The rules (which clip and track a key edit targets, when an
 * edit updates a key instead of adding one, and why an edit is refused) live in
 * the engine (`maleo_editor_core::keys`, `crates/app-core/src/keys.rs`;
 * `p1-envelope-inspector`), which the executor reads too, so a refused edit
 * reads the same message everywhere. */
import type { AnimationProperty, KeyframeEasing } from "../animation-properties.ts";
import { setKeys, type AnimationKey } from "./commands.ts";
import { applyCommand } from "./engine-registry.ts";
import { documentHandle, documentScope } from "./document-handle.ts";
import { inspectorOp, type KeyTargetView } from "./inspector-rules.ts";
import type { EditorDoc } from "./scope.ts";

export type { AnimationKey };

/** Where a clip keeps its animation, and how long its key timeline is. */
export type KeyTarget = KeyTargetView;

/** A clip's key target: the primary visual for `scene:`, the visual for `vis:`, else the payload. */
export function keyTarget(doc: EditorDoc, id: string): KeyTarget | undefined {
	return inspectorOp("keys.target", { id }, documentHandle(doc)) ?? undefined;
}

/** Why a track edit is refused, or null when it is valid. */
export function clipKeyError(
	doc: EditorDoc,
	id: string,
	property: string,
	keys: readonly AnimationKey[],
): string | null {
	return inspectorOp("keys.error", { id, property, keys }, documentHandle(doc));
}

/** Current keys of one track (empty when the property is not animated). */
export function clipTrack(doc: EditorDoc, id: string, property: AnimationProperty): AnimationKey[] {
	const animation = keyTarget(doc, id)?.animation;
	const tracks: Partial<Record<string, readonly AnimationKey[]>> = {
		...animation?.tracks,
		...animation?.colorTracks,
	};
	return [...(tracks[property] ?? [])];
}

/** The document with the track replaced, or the same document when refused or unchanged. */
export function setClipKeys(
	doc: EditorDoc,
	id: string,
	property: AnimationProperty,
	keys: readonly AnimationKey[],
): EditorDoc {
	if (clipKeyError(doc, id, property, keys)) return doc;
	if (JSON.stringify(clipTrack(doc, id, property)) === JSON.stringify(keys)) return doc;
	return applyCommand(documentScope(doc), setKeys(id, property, [...keys])).doc;
}

/** Index of the key nearest `time` within `snap` (the engine's 0.1 s when absent), or -1. */
export function nearKeyIndex(keys: readonly { t: number }[], time: number, snap?: number): number {
	return inspectorOp("keys.near", snap === undefined ? { keys, time } : { keys, time, snap });
}

type Key<V> = { t: number; v: V; easing?: KeyframeEasing; easingRange?: [number, number] };

/** `keys` with a value written at `time`: a key within `snap` (the engine's 0.1 s when
 *  absent) keeps its time and takes the value (and `easing`, when given); otherwise a new
 *  key is inserted in order. */
export function upsertKey<V>(
	keys: readonly Key<V>[],
	time: number,
	value: V,
	easing?: KeyframeEasing,
	snap?: number,
): Key<V>[] {
	const next = inspectorOp("keys.upsert", {
		keys,
		time,
		value,
		...(easing ? { easing } : {}),
		...(snap === undefined ? {} : { snap }),
	});
	// SAFETY: the engine returns `keys` with `value` written in, so each `v` is a `V`.
	return next as Key<V>[];
}
