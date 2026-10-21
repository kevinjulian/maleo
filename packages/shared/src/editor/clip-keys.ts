/* `clip.setKeys`: replace one property track of one clip (keyframe-animation).
 * Every key edit (inspector, key lanes, canvas auto-key, agent) is this command or
 * a batch of it. Pure; the executor and its callers share `clipKeyError` so a
 * refused edit reads the same message everywhere. */
import { animationSchemaFor, type Animation } from "../clip-animation.ts";
import {
	isColorAnimationProperty,
	isNumericAnimationProperty,
	type AnimationElementKind,
	type AnimationProperty,
	type KeyframeEasing,
} from "../animation-properties.ts";
import { normalizeSceneClips } from "../scene-timing.ts";
import { sceneVisualSourceDuration } from "../source-interval.ts";
import type { Clip } from "../timeline-doc.ts";
import type {
	ClipLayout,
	ColorKeyframe,
	SceneVisualClip,
	ValueKeyframe,
} from "../timeline-model.ts";
import type { EditorDoc } from "./scope.ts";

export type AnimationKey = ValueKeyframe | ColorKeyframe;

/** Where a clip keeps its animation, and how long its key timeline is. */
export interface KeyTarget {
	kind: AnimationElementKind;
	animation: Animation | undefined;
	duration: number;
	locked: boolean;
	/** The clip with `animation` written in place (undefined removes it). */
	write(animation: Animation | undefined): Clip;
}

const VISUAL_DEFAULT: ClipLayout = { xPct: 0, yPct: 0, widthPct: 100, fit: "cover" };

function withAnimation<T extends { animation?: Animation }>(
	holder: T,
	animation: Animation | undefined,
): Omit<T, "animation"> & { animation?: Animation } {
	const { animation: _previous, ...rest } = holder;
	return animation ? { ...rest, animation } : rest;
}
const isColorKey = (key: AnimationKey): key is ColorKeyframe => typeof key.v === "string";
const isValueKey = (key: AnimationKey): key is ValueKeyframe => typeof key.v === "number";

/** Resolve a clip's animation holder: the primary visual for `scene:`, the visual for `vis:`, else the payload. */
export function keyTarget(doc: EditorDoc, id: string): KeyTarget | undefined {
	const clip = doc.clips.find((c) => c.id === id);
	if (!clip) return undefined;
	const locked = (track: number) => Boolean(doc.trackFlags?.[track]?.locked);
	if (clip.scene) {
		const scene = clip.scene,
			visual = normalizeSceneClips(scene).visualClips?.[0];
		if (!visual) return undefined;
		const extra = doc.clips.some((c) => c.vis?.sceneId === scene.id);
		const layout: ClipLayout = { ...VISUAL_DEFAULT, ...scene.layout, ...visual.layout };
		const duration =
			!extra && !visual.startSec
				? visual.kind === "video"
					? sceneVisualSourceDuration(visual.durationSec, scene.dur, layout)
					: scene.dur
				: visual.durationSec;
		return {
			kind: visual.kind,
			animation: layout.animation,
			duration,
			locked: locked(-1),
			write: (animation) => ({
				...clip,
				scene: { ...scene, visualClips: [{ ...visual, layout: withAnimation(layout, animation) }] },
			}),
		};
	}
	if (clip.vis) {
		const vclip: SceneVisualClip = clip.vis.vclip,
			layout: ClipLayout = { ...VISUAL_DEFAULT, ...vclip.layout };
		return {
			kind: vclip.kind,
			animation: vclip.layout?.animation,
			duration: vclip.durationSec ?? clip.durationSec,
			locked: locked(-1),
			write: (animation) => ({
				...clip,
				vis: { ...clip.vis!, vclip: { ...vclip, layout: withAnimation(layout, animation) } },
			}),
		};
	}
	if (clip.audio) {
		const audio = clip.audio;
		return {
			kind: "audio",
			animation: audio.animation,
			duration: clip.durationSec,
			locked: locked(clip.track),
			write: (animation) => ({ ...clip, audio: withAnimation(audio, animation) }),
		};
	}
	const payloadKey = clip.video
		? "video"
		: clip.text
			? "text"
			: clip.infographic
				? "infographic"
				: undefined;
	if (!payloadKey) return undefined;
	const payload = clip[payloadKey]!;
	const kind: AnimationElementKind = clip.video
		? clip.video.kind
		: payloadKey === "text"
			? "text"
			: "infographic";
	const layout: ClipLayout = { ...VISUAL_DEFAULT, fit: "contain", ...payload.layout };
	return {
		kind,
		animation: payload.layout?.animation,
		duration: clip.durationSec,
		locked: locked(clip.track),
		write: (animation) => ({
			...clip,
			[payloadKey]: { ...payload, layout: withAnimation(layout, animation) },
		}),
	};
}

/** The animation with `property` replaced by `keys` (empty removes the track). */
export function withTrack(
	animation: Animation | undefined,
	property: AnimationProperty,
	keys: readonly AnimationKey[],
): Animation | undefined {
	const tracks = { ...animation?.tracks },
		colorTracks = { ...animation?.colorTracks };
	if (isColorAnimationProperty(property)) {
		if (keys.length) colorTracks[property] = keys.filter(isColorKey);
		else delete colorTracks[property];
	} else if (keys.length) tracks[property] = keys.filter(isValueKey);
	else delete tracks[property];
	const hasColors = Object.keys(colorTracks).length > 0;
	if (!Object.keys(tracks).length && !hasColors) return undefined;
	return { tracks, ...(hasColors ? { colorTracks } : {}) };
}

/** Why a track edit is refused, or null when it is valid. */
export function clipKeyError(
	doc: EditorDoc,
	id: string,
	property: string,
	keys: readonly AnimationKey[],
): string | null {
	const target = keyTarget(doc, id);
	if (!target) return `Clip ${id} is unavailable or cannot be animated`;
	if (target.locked) return "Selected clip is on a locked track";
	if (!isNumericAnimationProperty(property) && !isColorAnimationProperty(property))
		return `Unknown animatable property "${property}"`;
	const late = keys.find((k) => !Number.isFinite(k.t) || k.t < 0 || k.t > target.duration + 1e-6);
	if (late)
		return `Keyframe at ${late.t}s is outside the clip (0–${Number(target.duration.toFixed(3))}s)`;
	const probe = isColorAnimationProperty(property)
		? { tracks: {}, colorTracks: { [property]: keys } }
		: { tracks: { [property]: keys } };
	const parsed = animationSchemaFor(target.kind).safeParse(probe);
	return parsed.success
		? null
		: `${property} keys are not valid for this ${target.kind} clip: ${parsed.error.issues[0]?.message ?? "invalid value"}`;
}

/** Current keys of one track (empty when the property is not animated). */
export function clipTrack(doc: EditorDoc, id: string, property: AnimationProperty): AnimationKey[] {
	const animation = keyTarget(doc, id)?.animation;
	return [
		...(isColorAnimationProperty(property)
			? (animation?.colorTracks?.[property] ?? [])
			: (animation?.tracks[property] ?? [])),
	];
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
	const target = keyTarget(doc, id)!,
		next = target.write(withTrack(target.animation, property, keys));
	return { ...doc, clips: doc.clips.map((c) => (c.id === id ? next : c)) };
}

/** How close an edit must be to an existing key to update it rather than add one (keyframe-animation). */
export const KEY_SNAP_SEC = 0.1;

/** Index of the key nearest `time` within `snap`, or -1. */
export function nearKeyIndex(
	keys: readonly { t: number }[],
	time: number,
	snap = KEY_SNAP_SEC,
): number {
	let best = -1;
	keys.forEach((k, i) => {
		if (
			Math.abs(k.t - time) <= snap + 1e-9 &&
			(best < 0 || Math.abs(k.t - time) < Math.abs(keys[best]!.t - time))
		)
			best = i;
	});
	return best;
}

/** `keys` with a value written at `time`: a key within `snap` keeps its time and takes the
 *  value (and `easing`, when given); otherwise a new key is inserted in order. */
export function upsertKey<V>(
	keys: readonly { t: number; v: V; easing?: KeyframeEasing; easingRange?: [number, number] }[],
	time: number,
	value: V,
	easing?: KeyframeEasing,
	snap = KEY_SNAP_SEC,
) {
	const near = nearKeyIndex(keys, time, snap);
	if (near >= 0)
		return keys.map((k, i) => (i === near ? { ...k, v: value, ...(easing ? { easing } : {}) } : k));
	return [...keys, { t: time, v: value, easing: easing ?? "linear" }].sort((a, b) => a.t - b.t);
}
