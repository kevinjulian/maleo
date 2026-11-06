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
 *
 * Which groups a kind offers, their order, the fallback group and the subject
 * precedence are shared-core rules (`crates/app-core/src/inspector.rs`,
 * `p1-envelope-inspector`). This module adds only labels, icons and titles.
 */
import { shapeElement } from "@models/timeline/shape-elements.ts";
import type { JSX } from "react";
import {
	activeGroupKey,
	groupOptions,
	inspectorSubject,
	propertyGroupKeys,
} from "@maleo/shared/editor/inspector-rules";
import { Ic } from "@design-system/icons/index.tsx";
import {
	audioKindLabel,
	type AudioOverlayKind,
	type AudioOrigin,
} from "@maleo/shared/audio-overlays";
import type { ClipInspectorKind } from "@models/timeline/timeline-editor-model.ts";

/** What the inspector and the contextual bar are currently about. */
export interface ClipSubject {
	clipId?: string;
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
	videoOverlay?: { id?: number; kind: string; url?: string } | null;
	audio?: { id?: number; kind: AudioOverlayKind; origin?: AudioOrigin; url?: string } | null;
	text?: { id?: number; preset?: string } | null;
	effectId?: number | null;
	transitionId?: number | null;
	scene?: { id?: number; name: string } | null;
}): ClipSubject | null {
	const subject = inspectorSubject(sel);
	if (!subject) return null;
	// SAFETY: the engine answers one of the inspector kinds this union lists.
	const kind = subject.kind as ClipInspectorKind;
	const clipId = subject.clipId === undefined ? {} : { clipId: subject.clipId };
	switch (kind) {
		case "broll":
			return {
				kind,
				...clipId,
				title: `Overlay · ${sel.videoOverlay!.kind}`,
				mediaUrl: sel.videoOverlay!.url,
			};
		case "audio":
			return {
				kind,
				...clipId,
				title: audioKindLabel(sel.audio!.kind, sel.audio!.origin),
				mediaUrl: sel.audio!.url,
			};
		case "shape":
			return { kind, title: shapeElement(sel.text?.preset)?.label ?? "Shape" };
		case "text":
			return { kind, title: "Text" };
		case "scene":
			return { kind, title: `Scene · ${sel.scene!.name}`, ...clipId };
		case "effect":
			return { kind, title: "Effect" };
		case "transition":
			return { kind, title: "Transition" };
	}
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
		...groupOptions(
			sel.videoOverlay?.kind,
			(sel.scene?.visualClips ?? []).map((visual) => visual.kind),
		),
		// Only the content icon follows it.
		brollKind: sel.videoOverlay?.kind,
	};
}

/* The label and icon of each group key, where a kind does not give its own. */
const SHARED: Partial<Record<ClipPropertyGroupKey, ClipPropertyGroup>> = {
	transform: TRANSFORM,
	blending: BLENDING,
	timing: TIMING,
	masks: MASKS,
	adjust: ADJUST,
	background: BACKGROUND,
	animation: ANIMATION,
	shot: { k: "shot", icon: Ic.scene, label: "Shot" },
	audio: { k: "audio", icon: Ic.music, label: "Audio" },
	motion: { k: "motion", icon: Ic.spark, label: "Reveal" },
	effect: { k: "effect", icon: Ic.spark, label: "Effect" },
	transition: { k: "transition", icon: Ic.swap, label: "Transition" },
};

/** The content group of a kind: the clip's own content, named for what it is. */
function contentGroup(kind: ClipInspectorKind, opts?: ClipGroupOptions): ClipPropertyGroup {
	switch (kind) {
		case "scene":
			return { k: "content", icon: Ic.image, label: "Source" };
		case "shape":
			return { k: "content", icon: Ic.rect, label: "Shape" };
		case "text":
			return { k: "content", icon: Ic.type, label: "Text" };
		case "broll":
			return {
				k: "content",
				icon: opts?.brollKind === "image" ? Ic.image : Ic.video,
				label: "Source",
			};
		// Effects and transitions have no content group; audio names its source.
		case "audio":
		case "effect":
		case "transition":
			return { k: "content", icon: Ic.mic, label: "Source" };
	}
}

/** What a clip of this kind can be edited for, in the shared core's order (after
 *  opencut-classic's properties registry), with this editor's labels and icons. */
export function clipPropertyGroups(
	kind: ClipInspectorKind | null | undefined,
	opts?: ClipGroupOptions,
): ClipPropertyGroup[] {
	if (!kind) return [];
	const keys = propertyGroupKeys(kind, {
		videoHasAudio: Boolean(opts?.videoHasAudio),
		sceneHasVideo: Boolean(opts?.sceneHasVideo),
	});
	return keys.flatMap((key): ClipPropertyGroup[] => {
		// SAFETY: the engine answers only the group keys this union lists.
		const k = key as ClipPropertyGroupKey;
		if (k === "content") return [contentGroup(kind, opts)];
		if (k === "levels") return [{ k, icon: Ic.music, label: "Audio" }];
		const group = SHARED[k];
		return group ? [group] : [];
	});
}

/** The group to show for a clip, given whatever tab the operator last chose.
 *  A kind that lacks the remembered group falls back to its first. */
export function activeClipPropertyGroup(
	groups: ClipPropertyGroup[],
	remembered: string,
): ClipPropertyGroupKey {
	// SAFETY: the answer is one of `groups`' keys, or `content`.
	return activeGroupKey(
		groups.map((group) => group.k),
		remembered,
	) as ClipPropertyGroupKey;
}
