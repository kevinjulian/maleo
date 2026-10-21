import {
	fromTimelineDoc,
	normalizeSceneClips,
	sampleClipProperty,
	NUMERIC_ANIMATION_PROPERTIES,
	NUMERIC_ANIMATION_PROPERTY_NAMES,
	COLOR_ANIMATION_PROPERTY_NAMES,
	numericPropertiesFor,
	type Animation,
	type AnimationProperty,
	type NumericAnimationProperty,
	type KeyframeEasing,
	type ValueKeyframe,
} from "@maleo/shared";
import {
	batch,
	clipKeyError,
	keyTarget,
	setKeys,
	upsertKey,
	type AnimationKey,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import type { Selection } from "./selection-model.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { SourceEditTarget } from "./source-audio-edit.ts";
import { edgeAnimationTracks, type AnimationEdge, type EdgePreset } from "@maleo/shared";

export function applyEdgePreset(
	scope: EditScope,
	target: ClipAnimationTarget,
	edge: AnimationEdge,
	preset: EdgePreset,
	duration: number,
): EditorCommand {
	const info = clipAnimationInfo(scope.doc, target);
	if (!info) throw new Error("Selected clip is unavailable");
	if (info.locked) throw new Error("Selected clip is on a locked track");
	const tracks = edgeAnimationTracks(
		info.animation,
		edge,
		preset,
		duration,
		info.duration,
		info.values,
		info.audio,
	);
	return batch(
		Object.entries(tracks).map(([property, keys]) => {
			const known = NUMERIC_ANIMATION_PROPERTY_NAMES.find((p) => p === property);
			if (!known) throw new Error("Unknown animation property");
			return trackCommand(scope, target, known, keys!);
		}),
		`${edge === "in" ? "entrance" : "exit"} animation`,
	);
}

/** Any clip or overlay the inspector can key. */
export type ClipAnimationTarget = SourceEditTarget | { source: "text" | "infographic"; id: number };

export function animationTargetForId(doc: EditorDoc, id: string): ClipAnimationTarget | undefined {
	const clip = doc.clips.find((c) => c.id === id);
	if (clip?.scene) {
		const visuals = normalizeSceneClips(clip.scene).visualClips ?? [],
			visual = visuals.find((v) => v.primary) ?? visuals[0];
		return visual ? { source: "scene", id: clip.scene.id, visualId: visual.id } : undefined;
	}
	if (clip?.vis) return { source: "scene", id: clip.vis.sceneId, visualId: clip.vis.vclip.id };
	if (clip?.video) return { source: "video", id: clip.video.id };
	if (clip?.audio) return { source: "audio", id: clip.audio.id };
	if (clip?.text) return { source: "text", id: clip.text.id };
	if (clip?.infographic) return { source: "infographic", id: clip.infographic.id };
	return undefined;
}

/** The timeline clip id that holds a target's animation (scene primary visual rides in `scene:`). */
export function clipIdForTarget(
	doc: EditorDoc,
	target: { source: ClipAnimationTarget["source"]; id: number; visualId?: string },
): string {
	if (target.source !== "scene") return `${target.source}:${target.id}`;
	const vis = target.visualId && `vis:${target.id}:${target.visualId}`;
	return vis && doc.clips.some((c) => c.id === vis) ? vis : `scene:${target.id}`;
}

/** Static (unanimated) value of a property for a target, used as the sampling fallback. */
function staticValue(
	doc: EditorDoc,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
): number {
	const views = fromTimelineDoc(doc);
	if (target.source === "audio")
		return property === "volume"
			? (views.audioOverlays.find((a) => a.id === target.id)?.volume ?? 1)
			: NUMERIC_ANIMATION_PROPERTIES[property].neutral;
	const scene =
		target.source === "scene" ? views.scenes.find((s) => s.id === target.id) : undefined;
	const visualId = target.source === "scene" ? target.visualId : undefined;
	const visual =
		scene &&
		(normalizeSceneClips(scene).visualClips?.find((v) => v.id === visualId) ??
			normalizeSceneClips(scene).visualClips?.[0]);
	const overlay =
		target.source === "video"
			? views.videoOverlays.find((v) => v.id === target.id)
			: target.source === "text"
				? views.textOverlays.find((t) => t.id === target.id)
				: target.source === "infographic"
					? views.infographicOverlays.find((g) => g.id === target.id)
					: undefined;
	const layout = scene ? { ...scene.layout, ...visual?.layout } : overlay?.layout;
	const style =
		target.source === "text"
			? views.textOverlays.find((t) => t.id === target.id)?.style
			: undefined;
	const volume =
		target.source === "video"
			? views.videoOverlays.find((v) => v.id === target.id)?.volume
			: (visual?.volume ?? (scene?.visualClips?.length === 1 ? 1 : 0));
	const fromLayout: Partial<Record<NumericAnimationProperty, number | undefined>> = {
		xPct: layout?.xPct,
		yPct: layout?.yPct,
		rotationDeg: layout?.rotationDeg,
		opacity: layout?.opacity,
		widthPct: layout?.widthPct,
		heightPct: layout?.heightPct ?? undefined,
		volume,
		bgOpacity: style?.bgOpacity,
		fontSize: style?.fontSize,
		letterSpacing: style?.letterSpacing,
		lineHeight: style?.lineHeight,
	};
	return fromLayout[property] ?? NUMERIC_ANIMATION_PROPERTIES[property].neutral;
}

export function clipAnimationInfo(doc: EditorDoc, target: ClipAnimationTarget) {
	const id = clipIdForTarget(doc, target),
		keyed = keyTarget(doc, id),
		clip = doc.clips.find((c) => c.id === id);
	if (!keyed || !clip) return undefined;
	const start = clip.scene
		? clip.startSec + (normalizeSceneClips(clip.scene).visualClips?.[0]?.startSec ?? 0)
		: clip.startSec;
	const properties = numericPropertiesFor(keyed.kind);
	const values: Partial<Record<NumericAnimationProperty, number>> = {};
	for (const property of properties) values[property] = staticValue(doc, target, property);
	return {
		id,
		kind: keyed.kind,
		start,
		duration: keyed.duration,
		animation: keyed.animation,
		values,
		properties,
		locked: keyed.locked,
		audio: keyed.kind === "audio",
		hasVolume: properties.includes("volume"),
	};
}

/** The command setting `keys` on one track, or a thrown, legible refusal. */
function trackCommand(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	keys: ValueKeyframe[],
): EditorCommand {
	const info = clipAnimationInfo(scope.doc, target);
	if (!info) throw new Error("Selected clip is locked or unavailable");
	if (info.locked) throw new Error("Selected clip is on a locked track");
	if (property === "volume" && !info.hasVolume)
		throw new Error(
			info.kind === "image" ? "Images have no source volume" : "This clip has no source volume",
		);
	const error = clipKeyError(scope.doc, info.id, property, keys);
	if (error) throw new Error(error);
	return setKeys(info.id, property, keys);
}

/** Write a value at `time`; a key within KEY_SNAP_SEC is updated in place (keyframe-animation). */
export function editClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	time: number,
	value?: number,
	easing?: KeyframeEasing,
) {
	const info = clipAnimationInfo(scope.doc, target);
	if (!info || !Number.isFinite(time) || time < 0 || time > info.duration)
		throw new Error("Keyframe is outside selected clip");
	const keys = info.animation?.tracks[property] ?? [];
	const v =
		value ??
		sampleClipProperty(
			info.animation,
			property,
			time,
			info.values[property] ?? NUMERIC_ANIMATION_PROPERTIES[property].neutral,
		);
	return trackCommand(scope, target, property, upsertKey(keys, time, v, easing));
}

export function removeClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	index: number,
) {
	const keys = clipAnimationInfo(scope.doc, target)?.animation?.tracks[property];
	if (!keys?.[index]) throw new Error("Selected keyframe is unavailable");
	return trackCommand(
		scope,
		target,
		property,
		keys.filter((_, i) => i !== index),
	);
}

export function moveClipKey(
	scope: EditScope,
	target: ClipAnimationTarget,
	property: NumericAnimationProperty,
	index: number,
	time: number,
) {
	const info = clipAnimationInfo(scope.doc, target),
		keys = info?.animation?.tracks[property];
	if (!keys?.[index] || !Number.isFinite(time) || time < 0 || time > (info?.duration ?? 0))
		throw new Error("Selected keyframe or new time is unavailable");
	return trackCommand(
		scope,
		target,
		property,
		keys.map((k, i) => (i === index ? { ...k, t: time } : k)).sort((a, b) => a.t - b.t),
	);
}

/** Resolve ordinary clip selection without changing the canonical document. */
export function selectedClipAnimationTarget(
	doc: EditorDoc,
	selection: Selection,
	visualChoice: { sceneId: number; visualId: string } | null,
): ClipAnimationTarget | undefined {
	if (selection.videoOverlayId !== null) return { source: "video", id: selection.videoOverlayId };
	if (selection.audioId !== null) return { source: "audio", id: selection.audioId };
	if (selection.overlayId !== null) return { source: "text", id: selection.overlayId };
	if (selection.infographicId !== null)
		return { source: "infographic", id: selection.infographicId };
	const scene = fromTimelineDoc(doc).scenes.find((s) => s.id === selection.sceneId);
	if (!scene) return undefined;
	const visuals = normalizeSceneClips(scene).visualClips;
	const visual =
		visuals?.find((v) => visualChoice?.sceneId === scene.id && visualChoice.visualId === v.id) ??
		visuals?.[0];
	return visual ? { source: "scene", id: scene.id, visualId: visual.id } : undefined;
}

/** One moment on a clip: key times within a frame of each other, across every track. */
export interface KeyMoment {
	time: number;
	properties: AnimationProperty[];
}
const MOMENT_SEC = 1 / 30;

/** The clip's moments in time order (keyframe-animation: keys shown on the selected clip). */
export function keyMoments(animation: Animation | undefined): KeyMoment[] {
	const entries: [number, AnimationProperty][] = [
		...NUMERIC_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			(animation?.tracks[p] ?? []).map((k): [number, AnimationProperty] => [k.t, p]),
		),
		...COLOR_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			(animation?.colorTracks?.[p] ?? []).map((k): [number, AnimationProperty] => [k.t, p]),
		),
	].sort((a, b) => a[0] - b[0]);
	const moments: KeyMoment[] = [];
	for (const [t, property] of entries) {
		const last = moments.at(-1);
		if (last && t - last.time <= MOMENT_SEC / 2 + 1e-9) {
			if (!last.properties.includes(property)) last.properties.push(property);
		} else moments.push({ time: t, properties: [property] });
	}
	return moments;
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
	const info = clipAnimationInfo(scope.doc, target);
	if (!info) throw new Error("Selected clip is unavailable");
	if (info.locked) throw new Error("Selected clip is on a locked track");
	if (!times.length) throw new Error("No keys selected");
	const momentOf = (t: number) => times.find((m) => Math.abs(t - m) <= MOMENT_SEC / 2 + 1e-9);
	const at = (t: number) => momentOf(t) !== undefined;
	const shift =
		delta === undefined
			? 0
			: Math.max(-Math.min(...times), Math.min(info.duration - Math.max(...times), delta));
	// Keys within a moment land together on the moment's new time.
	const move = <K extends { t: number }>(keys: readonly K[]): K[] =>
		delta === undefined
			? keys.filter((k) => !at(k.t))
			: keys
					.map((k) => {
						const m = momentOf(k.t);
						return m === undefined ? k : { ...k, t: Math.round((m + shift) * 1e6) / 1e6 };
					})
					.sort((a, b) => a.t - b.t);
	const commands: EditorCommand[] = [
		...NUMERIC_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			info.animation?.tracks[p]?.some((k) => at(k.t))
				? [checked(scope, info.id, p, move(info.animation!.tracks[p]!))]
				: [],
		),
		...COLOR_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			info.animation?.colorTracks?.[p]?.some((k) => at(k.t))
				? [checked(scope, info.id, p, move(info.animation!.colorTracks![p]!))]
				: [],
		),
	];
	if (!commands.length) throw new Error("No keys at that moment");
	return commands.length === 1
		? commands[0]!
		: batch(commands, delta === undefined ? "remove keyframes" : "move keyframes");
}

/** Every key at a moment moved to `to` (or removed when `to` is undefined), as one batch. */
export function moveMoment(
	scope: EditScope,
	target: ClipAnimationTarget,
	from: number,
	to?: number,
): EditorCommand {
	const info = clipAnimationInfo(scope.doc, target);
	if (to !== undefined && info && (!Number.isFinite(to) || to < 0 || to > info.duration))
		throw new Error("Keyframe is outside selected clip");
	return moveMoments(scope, target, [from], to === undefined ? undefined : to - from);
}

/** The easing of every key at the given moments, as one batch. */
export function setMomentsEasing(
	scope: EditScope,
	target: ClipAnimationTarget,
	times: readonly number[],
	easing: KeyframeEasing,
	property?: AnimationProperty,
): EditorCommand {
	const info = clipAnimationInfo(scope.doc, target);
	if (!info) throw new Error("Selected clip is unavailable");
	const at = (t: number) => times.some((m) => Math.abs(t - m) <= MOMENT_SEC / 2 + 1e-9);
	const ease = <K extends { t: number; easing?: KeyframeEasing }>(keys: readonly K[]): K[] =>
		keys.map((k) => (at(k.t) ? { ...k, easing } : k));
	const commands: EditorCommand[] = [
		...NUMERIC_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			(!property || property === p) && info.animation?.tracks[p]?.some((k) => at(k.t))
				? [checked(scope, info.id, p, ease(info.animation!.tracks[p]!))]
				: [],
		),
		...COLOR_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			(!property || property === p) && info.animation?.colorTracks?.[p]?.some((k) => at(k.t))
				? [checked(scope, info.id, p, ease(info.animation!.colorTracks![p]!))]
				: [],
		),
	];
	if (!commands.length) throw new Error("No keys at that moment");
	return commands.length === 1 ? commands[0]! : batch(commands, "keyframe easing");
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

function checked(
	scope: EditScope,
	id: string,
	property: AnimationProperty,
	keys: AnimationKey[],
): EditorCommand {
	const error = clipKeyError(scope.doc, id, property, keys);
	if (error) throw new Error(error);
	return setKeys(id, property, keys);
}

/** Easings of every key at a moment (linear when unset). */
export function momentKeyEasings(animation: Animation | undefined, time: number): KeyframeEasing[] {
	const at = (t: number) => Math.abs(t - time) <= MOMENT_SEC / 2 + 1e-9;
	return [
		...Object.values(animation?.tracks ?? {}),
		...Object.values(animation?.colorTracks ?? {}),
	].flatMap((keys) => (keys ?? []).filter((k) => at(k.t)).map((k) => k.easing ?? "linear"));
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
	const info = clipAnimationInfo(scope.doc, target);
	if (!info) throw new Error("Selected clip is unavailable");
	if (info.locked) throw new Error("Selected clip is on a locked track");
	const allowed = new Set<string>(info.properties);
	const commands: EditorCommand[] = [
		...NUMERIC_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			clipboard.tracks[p]?.length && allowed.has(p)
				? [
						checked(
							scope,
							info.id,
							p,
							clipboard.tracks[p]!.map((k) => ({ ...k })),
						),
					]
				: [],
		),
		...COLOR_ANIMATION_PROPERTY_NAMES.flatMap((p) =>
			clipboard.colorTracks?.[p]?.length && info.kind === "text"
				? [
						checked(
							scope,
							info.id,
							p,
							clipboard.colorTracks[p]!.map((k) => ({ ...k })),
						),
					]
				: [],
		),
	];
	if (!commands.length) throw new Error("Nothing copied applies to this clip");
	return commands.length === 1 ? commands[0]! : batch(commands, "paste keyframes");
}
