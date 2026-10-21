/* The property groups a selected clip has, by clip kind.
 *
 * One list, two readers. The desktop clip inspector draws it as an icon rail
 * down the left of the docked panel; the phone contextual bar draws it as a row
 * of controls along the bottom. They are the same question — "what can be
 * edited about this thing?" — and the answer was previously computed inside the
 * inspector's render closure, where the bar could not reach it. A second copy
 * would mean a clip kind gaining a group in one surface and not the other, with
 * nothing to catch the divergence.
 *
 * Icons are stored as the registry's `(size) => JSX.Element` factories rather
 * than as rendered elements, because the two readers want different sizes: 17px
 * in a 54px rail, larger under a thumb.
 */
import { shapeElement } from "@models/timeline/shape-elements.ts";
import type { JSX } from "react";
import { Ic } from "@design-system/icons/index.tsx";
import {
	audioKindLabel,
	type AudioOverlayKind,
	type AudioOrigin,
} from "@maleo/shared/audio-overlays";
import type { ClipInspectorKind } from "@models/timeline/timeline-editor-model.ts";

/** What the inspector and the contextual bar are currently about. */
export interface ClipSubject {
	kind: ClipInspectorKind;
	title: string;
	/** The clip's media, so the bar can say when its file is still uploading. */
	mediaUrl?: string;
}

/** The selection, reduced to one subject.
 *
 *  The order is a precedence rule, not an arrangement: the selection model
 *  clears the other families when one becomes primary, but a scene stays
 *  selected underneath a free clip, so the free clip has to win or selecting a
 *  clip inside a scene would show the scene's properties. Lifted out of the
 *  inspector's render closure for the same reason the group list was — the
 *  phone bar needs the same answer and could not see it there. */
export function resolveClipSubject(sel: {
	videoOverlay?: { kind: string; url?: string } | null;
	audio?: { kind: AudioOverlayKind; origin?: AudioOrigin; url?: string } | null;
	text?: { preset?: string } | null;
	infographic?: unknown;
	effectId?: number | null;
	transitionId?: number | null;
	scene?: { name: string } | null;
}): ClipSubject | null {
	if (sel.videoOverlay)
		return {
			kind: "broll",
			title: `Overlay · ${sel.videoOverlay.kind}`,
			mediaUrl: sel.videoOverlay.url,
		};
	if (sel.audio)
		return {
			kind: "audio",
			title: audioKindLabel(sel.audio.kind, sel.audio.origin),
			mediaUrl: sel.audio.url,
		};
	if (sel.text) {
		const shape = shapeElement(sel.text.preset);
		return shape ? { kind: "shape", title: shape.label } : { kind: "text", title: "Text" };
	}
	if (sel.infographic) return { kind: "infographic", title: "Data callout" };
	if (sel.effectId != null) return { kind: "effect", title: "Effect" };
	if (sel.transitionId != null) return { kind: "transition", title: "Transition" };
	if (sel.scene) return { kind: "scene", title: `Scene · ${sel.scene.name}` };
	return null;
}

export type ClipPropertyGroupKey =
	| "content"
	| "shot"
	| "transform"
	| "blending"
	| "audio"
	| "levels"
	| "timing"
	| "masks"
	| "adjust"
	| "motion"
	| "animation"
	| "background"
	| "effect"
	| "transition";

export interface ClipPropertyGroup {
	k: ClipPropertyGroupKey;
	icon: (s?: number) => JSX.Element;
	label: string;
}

/* One icon per meaning, shared by every kind, so a glyph never stands for two groups. */
const TRANSFORM: ClipPropertyGroup = { k: "transform", icon: Ic.transform, label: "Transform" };
const BLENDING: ClipPropertyGroup = { k: "blending", icon: Ic.blend, label: "Blending" };
const TIMING: ClipPropertyGroup = { k: "timing", icon: Ic.timer, label: "Timing" };
const MASKS: ClipPropertyGroup = { k: "masks", icon: Ic.mask, label: "Masks" };
const ADJUST: ClipPropertyGroup = { k: "adjust", icon: Ic.sliders, label: "Adjust" };
const BACKGROUND: ClipPropertyGroup = { k: "background", icon: Ic.palette, label: "Background" };
const ANIMATION: ClipPropertyGroup = { k: "animation", icon: Ic.play, label: "Animation" };

/** The facts beyond the kind that decide a clip's groups. */
export interface ClipGroupOptions {
	videoHasAudio?: boolean;
	sceneHasVideo?: boolean;
	brollKind?: "image" | "video";
}

/** Those facts, read off the selection the inspector and the phone bar both hold. */
export function clipGroupOptions(sel: {
	videoOverlay?: { kind: "image" | "video" } | null;
	scene?: { visualClips?: readonly { kind: string }[] } | null;
}): ClipGroupOptions {
	return {
		videoHasAudio: sel.videoOverlay?.kind === "video",
		brollKind: sel.videoOverlay?.kind,
		sceneHasVideo: Boolean(sel.scene?.visualClips?.some((v) => v.kind === "video")),
	};
}

/** What a clip of this kind can be edited for, in the order an editor reaches for it
 *  (after opencut-classic's properties registry): the clip's own content first and as
 *  the default, then where it sits, how it composites, its sound and time, then
 *  optional treatments.
 *
 *  `videoHasAudio` gives a b-roll clip an Audio group only when its media carries a
 *  track; `sceneHasVideo` gives a scene a Timing group only when a visual is a video,
 *  because that is the only playback a scene has to edit. */
export function clipPropertyGroups(
	kind: ClipInspectorKind | null | undefined,
	opts?: ClipGroupOptions,
): ClipPropertyGroup[] {
	if (!kind) return [];
	switch (kind) {
		case "scene":
			return [
				{ k: "content", icon: Ic.image, label: "Source" },
				{ k: "shot", icon: Ic.scene, label: "Shot" },
				TRANSFORM,
				ANIMATION,
				BLENDING,
				...(opts?.sceneHasVideo ? [TIMING] : []),
				MASKS,
				ADJUST,
				BACKGROUND,
			];
		case "shape":
			return [
				{ k: "content", icon: Ic.rect, label: "Shape" },
				TRANSFORM,
				ANIMATION,
				BLENDING,
				TIMING,
			];
		case "text":
			return [
				{ k: "content", icon: Ic.type, label: "Text" },
				TRANSFORM,
				ANIMATION,
				BLENDING,
				TIMING,
			];
		case "broll":
			return [
				{ k: "content", icon: opts?.brollKind === "image" ? Ic.image : Ic.video, label: "Source" },
				TRANSFORM,
				ANIMATION,
				BLENDING,
				...(opts?.videoHasAudio ? [{ k: "audio" as const, icon: Ic.music, label: "Audio" }] : []),
				TIMING,
				MASKS,
				ADJUST,
				{ k: "motion", icon: Ic.spark, label: "Reveal" },
			];
		case "audio":
			return [
				{ k: "levels", icon: Ic.music, label: "Audio" },
				ANIMATION,
				TIMING,
				{ k: "content", icon: Ic.mic, label: "Source" },
			];
		case "infographic":
			return [
				{ k: "content", icon: Ic.chart, label: "Data" },
				TRANSFORM,
				ANIMATION,
				BLENDING,
				{ k: "motion", icon: Ic.spark, label: "Motion" },
				BACKGROUND,
			];
		case "effect":
			return [{ k: "effect", icon: Ic.spark, label: "Effect" }];
		case "transition":
			return [{ k: "transition", icon: Ic.swap, label: "Transition" }];
	}
}

/** The group to show for a clip, given whatever tab the operator last chose.
 *  A kind that lacks the remembered group falls back to its first. */
export function activeClipPropertyGroup(
	groups: ClipPropertyGroup[],
	remembered: string,
): ClipPropertyGroupKey {
	return groups.find((g) => g.k === remembered)?.k ?? groups[0]?.k ?? "content";
}
