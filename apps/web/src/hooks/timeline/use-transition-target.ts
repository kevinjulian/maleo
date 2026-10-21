/* Which boundary a transition applies to, and what the panel shows for it.
 *
 * A transition is a clip keyed by the two adjacent clips it joins, so "the
 * selected transition" is rarely what the user selected — it is derived from
 * whatever IS selected: an explicit transition clip, else the selected b-roll
 * overlay's boundary with its neighbour on the same row, else the active
 * scene's boundary with the next scene (or the previous one, when it is last).
 *
 * Split out of `timeline-editor.tsx`. The panel and the apply path have to agree
 * on that resolution or the preview shows one boundary and the click edits
 * another, which is why they are derived together here rather than at the two
 * call sites.
 */
import type { Dispatch, SetStateAction } from "react";
import {
	clipId,
	parseClipId,
	type BaseTrackClip,
	type TimelineClip,
} from "@models/timeline/timeline-clips.ts";
import {
	selectTransition as selectTransitionIn,
	type Selection,
} from "@models/timeline/selection-model.ts";
import type { Scene, TransitionType } from "@maleo/shared";
import type { useTransitionOps } from "./use-transition-ops.ts";

import type { selectDerivedArrays } from "@stores/timeline-document-store.ts";

type Derived = ReturnType<typeof selectDerivedArrays>;
type TransitionApi = ReturnType<typeof useTransitionOps>;

export interface TransitionTargetInput {
	transitions: Derived["transitions"];
	videoOverlays: Derived["videoOverlays"];
	scenes: Scene[];
	active?: Scene;
	selectedTransition?: number | null;
	selectedFreeId: string | null;
	baseClips: BaseTrackClip[];
	freeClips: TimelineClip[];
	upd: (id: number, f: keyof Scene, v: unknown) => void;
	upsertTransition: TransitionApi["upsertTransition"];
	updateTransition: TransitionApi["updateTransition"];
	setSelection: Dispatch<SetStateAction<Selection>>;
}

export interface TransitionTarget {
	selectedTransitionClip: Derived["transitions"][number] | undefined;
	activeTransitionType: TransitionType | undefined;
	/** Whether any boundary is resolvable — a lone clip has none. */
	canApply: boolean;
	/** The boundary's two clip labels, for the panel's caption. */
	targetName?: string;
	/** The frames the panel animates between, mirroring the boundary it edits. */
	previewFrames: { left?: string; right?: string };
	apply: (type: TransitionType) => void;
}

export function useTransitionTarget({
	transitions,
	videoOverlays,
	scenes,
	active,
	selectedTransition,
	selectedFreeId,
	baseClips,
	freeClips,
	upd,
	upsertTransition,
	updateTransition,
	setSelection,
}: TransitionTargetInput): TransitionTarget {
	const selectedTransitionClip =
		selectedTransition != null ? transitions.find((t) => t.id === selectedTransition) : undefined;
	// A selected visual overlay clip (b-roll image/video on a free row) also
	// carries transitions: its boundary is selected → next clip on the SAME row
	// (else previous → selected). The transition lands on the boundary's TO clip
	// (incoming-edge semantics, same as the renderer).
	const selectedVisualOv = (() => {
		const p = selectedFreeId ? parseClipId(selectedFreeId) : null;
		if (!p || p.source !== "video") return undefined;
		return videoOverlays.find((v) => v.id === p.refId);
	})();
	const ovBoundary = (() => {
		if (!selectedVisualOv) return null;
		const row = videoOverlays
			.filter((v) => (v.track ?? 0) === (selectedVisualOv.track ?? 0))
			.sort((a, b) => a.start - b.start);
		const i = row.findIndex((v) => v.id === selectedVisualOv.id);
		if (row[i + 1]) return { from: row[i]!, to: row[i + 1]! };
		if (row[i - 1]) return { from: row[i - 1]!, to: row[i]! };
		return null;
	})();
	const activeTransitionType =
		selectedTransitionClip?.type ??
		(ovBoundary
			? (transitions.find((t) => t.toClipId === clipId("video", ovBoundary.to.id))?.type ?? "cut")
			: active?.transition);
	const visualClipThumb = (id?: string): string | undefined => {
		if (!id) return undefined;
		const base = baseClips.find((c) => c.id === id);
		if (base?.thumb) return base.thumb;
		const free = freeClips.find((c) => c.id === id);
		return free?.thumb;
	};
	// Frame sources for the transition demos: the SELECTED scene's primary visual
	// on the left, the NEXT scene (by scene order — robust to inter-scene pauses)
	// on the right. An explicit transition-clip selection overrides both sides.
	const sceneFrameSrc = (s?: Scene): string | undefined =>
		s
			? (s.visualClips?.find((v) => v.primary)?.url ??
				s.visualClips?.[0]?.url ??
				s.src ??
				undefined)
			: undefined;
	// Demo frames mirror the boundary the panel will actually edit: selected →
	// next when a next exists, else previous → selected.
	const activeSceneIdx = active ? scenes.findIndex((s) => s.id === active.id) : -1;
	const nextOfActive = activeSceneIdx >= 0 ? scenes[activeSceneIdx + 1] : undefined;
	const prevOfActive = activeSceneIdx > 0 ? scenes[activeSceneIdx - 1] : undefined;
	const transitionPreviewFrames = {
		left:
			visualClipThumb(selectedTransitionClip?.fromClipId) ??
			(ovBoundary ? (ovBoundary.from.thumb ?? ovBoundary.from.url) : undefined) ??
			sceneFrameSrc(nextOfActive ? active : prevOfActive),
		right:
			visualClipThumb(selectedTransitionClip?.toClipId) ??
			(ovBoundary ? (ovBoundary.to.thumb ?? ovBoundary.to.url) : undefined) ??
			sceneFrameSrc(nextOfActive ?? active),
	};
	// Panel apply targets ONE boundary: selected clip → NEXT clip when a next
	// exists, else PREVIOUS clip → selected, else nothing (a lone clip has no
	// boundary to transition across). Scene.transition (the outgoing edge) is
	// stamped on the boundary's FROM scene so packed and moved paths agree.
	const applyTransitionFromPanel = (type: TransitionType): void => {
		if (selectedTransitionClip) {
			updateTransition(selectedTransitionClip.id, { type });
			return;
		}
		// Visual overlay boundary: a transition clip whose target is the TO overlay
		// (buildRenderStoryboard reads it as that overlay's incoming edge).
		if (ovBoundary) {
			const id = upsertTransition(
				clipId("video", ovBoundary.from.id),
				clipId("video", ovBoundary.to.id),
				{ type },
			);
			setSelection(selectTransitionIn(id));
			return;
		}
		if (!active) return;
		const idx = scenes.findIndex((s) => s.id === active.id);
		const nextScene = idx >= 0 ? scenes[idx + 1] : undefined;
		const prevScene = idx > 0 ? scenes[idx - 1] : undefined;
		const boundary = nextScene
			? { from: active, to: nextScene }
			: prevScene
				? { from: prevScene, to: active }
				: null;
		if (!boundary) return;
		upd(boundary.from.id, "transition", type);
		const id = upsertTransition(
			clipId("scene", boundary.from.id),
			clipId("scene", boundary.to.id),
			{ type },
		);
		setSelection(selectTransitionIn(id));
	};
	return {
		selectedTransitionClip,
		activeTransitionType,
		canApply: Boolean(selectedTransitionClip || ovBoundary || active),
		targetName: ovBoundary
			? `${ovBoundary.from.label ?? "clip"} → ${ovBoundary.to.label ?? "clip"}`
			: undefined,
		previewFrames: transitionPreviewFrames,
		apply: applyTransitionFromPanel,
	};
}
