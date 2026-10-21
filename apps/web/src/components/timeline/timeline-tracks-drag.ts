/* The timeline's drag wiring and the per-clip lookups its lanes resolve.
 *
 * Split out of `timeline-tracks.tsx`. Both are hooks the region calls once and
 * whose outputs it alone draws; they moved as they were, with the comments that
 * explain them, so the component reads as layout. */
import { useCallback, useMemo, type MutableRefObject } from "react";
import { clipId, parseClipId } from "@models/timeline/timeline-clips.ts";
import { indexById } from "@models/timeline/render-derivations.ts";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type {
	selectDerivedArrays,
	TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { clipSourceRange } from "@maleo/shared";
import type { TrackFlags } from "@maleo/shared";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { useContentTimeline } from "@hooks/timeline/use-content-timeline.ts";
import {
	createContentDocumentAdapter,
	sceneEditPatch,
} from "@models/timeline/content-document-adapter.ts";
import type { TimelineClip } from "@models/timeline/timeline-clips.ts";
import type { TimelineTracksOps, TimelineTracksView } from "./timeline-tracks-types.ts";

type DerivedArrays = ReturnType<typeof selectDerivedArrays>;

/** What a lane resolves for each of its clips, by id rather than by scan. */
export function useLaneLookups(derived: DerivedArrays) {
	const scenes = derived.scenes;
	const overlays = derived.textOverlays;
	const audioOverlays = derived.audioOverlays;
	const videoOverlays = derived.videoOverlays;

	/* One pass over the clips, not one per lane.
	 *
	 * Each lane used to filter the whole clip array for its own members, so the
	 * work grew as lanes × clips — invisible at ten clips, and the reason a large
	 * project feels different from a small one. Lanes with nothing on them are
	 * absent from the map rather than holding an empty array, so the empty-lane
	 * branch below reads a missing key as empty. */
	/* And one map per family, not a linear scan per clip.
	 *
	 * A clip carries its family and its `refId`; the record behind it lives in
	 * the per-type array. Four call sites answered that by scanning the array,
	 * once per clip drawn, which is quadratic in clip count. */
	const overlayById = useMemo(() => indexById(overlays), [overlays]);
	const audioById = useMemo(() => new Map(audioOverlays.map((a) => [a.id, a])), [audioOverlays]);
	const videoById = useMemo(() => new Map(videoOverlays.map((v) => [v.id, v])), [videoOverlays]);
	const sceneById = useMemo(() => new Map(scenes.map((s) => [s.id, s])), [scenes]);

	/* What a lane resolves for each of its clips. Stable while the document is,
	 * so a memoized lane holds — and a lookup rather than a map prop, so a clip
	 * never holds a collection that changes whenever any sibling does. */
	const presetOf = useCallback(
		(c: TimelineClip) => (c.source === "text" ? overlayById.get(c.refId)?.preset : undefined),
		[overlayById],
	);
	const originalDurOf = useCallback(
		(c: TimelineClip) => (c.source === "audio" ? audioById.get(c.refId)?.originalDur : undefined),
		[audioById],
	);
	const mediaStartOf = useCallback(
		(c: TimelineClip) =>
			c.source === "video" && c.media === "video"
				? (videoById.get(c.refId)?.mediaStartSec ?? 0)
				: c.source === "audio"
					? (audioById.get(c.refId)?.mediaStartSec ?? 0)
					: undefined,
		[audioById, videoById],
	);
	/* The transition on an edge, by key.
	 *
	 * `transAt` from `useTransitionOps` is a fresh closure on every render and
	 * scans the transition array per edge — as a lane prop it would break the memo
	 * boundary before it could help, which is the failure mode this slice exists
	 * to avoid. Keyed on the pair the transition is identified by. */
	const transitionByEdge = useMemo(
		() => new Map(derived.transitions.map((t) => [`${t.fromClipId}->${t.toClipId}`, t])),
		[derived.transitions],
	);
	const transitionAt = useCallback(
		(aId: string, bId: string) => transitionByEdge.get(`${aId}->${bId}`),
		[transitionByEdge],
	);
	return { sceneById, presetOf, originalDurOf, mediaStartOf, transitionAt };
}

interface TracksDragInput {
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
	trackFlags: TrackFlags;
	trackRef: MutableRefObject<HTMLDivElement | null>;
	writers: DocumentWriters;
	ops: TimelineTracksOps;
	view: TimelineTracksView;
	coarse: boolean;
	derived: DerivedArrays;
}

/** The drag, on the library's kernel, with the policy Maleo owns. Returns the
 *  kernel's outputs and the scene boundaries the media drop also snaps to. */
export function useTracksDrag({
	store,
	chromeStore,
	trackFlags,
	trackRef,
	writers,
	ops,
	view,
	coarse,
	derived,
}: TracksDragInput) {
	const { selectScene, trackLocked, setFreeClipPos, updateAudio, updateVideoOverlay } = ops;
	const {
		playhead,
		total,
		pxPerSec,
		freeClips,
		freeRows,
		baseClips,
		selectedFreeId,
		selectedFreeIds,
		selectedSceneId,
		beatGridOn,
		timelineBeats,
	} = view;
	const scenes = derived.scenes;
	const audioOverlays = derived.audioOverlays;
	const videoOverlays = derived.videoOverlays;

	/* The drag, and the row bookkeeping that keys on it.
	 *
	 * Both used to run in the editor's root, which meant every pointer-down on a
	 * clip re-rendered the editor and the preview, and every pointer move during
	 * a drag did it again. Every output of both is drawn here and nowhere else,
	 * so this is where they belong — the same argument that put the hover cursor
	 * and the marquee in this file. */
	/* The gesture, on `@maleo/vui`'s kernel.
	 *
	 * The surface takes capture on the scroller below and resolves which clip a
	 * press concerns by hit-testing it — no clip owns a pointer any more, which
	 * is what lets a lane change land while the drag is still running. The policy
	 * Maleo still owns lives in `use-content-timeline`, once. */
	/* The document, spoken to the library. Rebuilt per render on purpose: it
	 * closes over the current document and the current lane flags, and the hook
	 * only ever calls it to re-read. */
	const contentAdapter = createContentDocumentAdapter({
		/* Read-only: the editor writes through its own writers, which own the
		 * undo ledger and run every command through the engine. */
		read: () => store.getDoc(),
		trackFlags: () => trackFlags,
		sourceDuration: (clip) =>
			ops.mediaAssets.find((asset) => asset.id === clipSourceRange(clip)?.assetId)?.metadata
				?.duration ?? clip.audio?.originalDur,
	});
	/* Scene boundaries, in seconds: the cuts a clip can land on. */
	const sceneBoundaries = useMemo(() => {
		const boundaries: number[] = [0];
		let at = 0;
		for (const scene of scenes) {
			at += Math.max(1, scene.dur);
			boundaries.push(at);
		}
		return boundaries;
	}, [scenes]);

	const timeline = useContentTimeline({
		state: () => contentAdapter.read(),
		scrollerRef: trackRef,
		/* Where the lanes begin inside the scroller: past the ruler and the marker
		 * band, and shifted by however far the lane area has been scrolled. Only
		 * this component can answer it, which is exactly why the library asks. */
		/* Measured from the lanes themselves rather than read from a constant: the
		 * three density rules and the coarse-pointer rule each move these, and a
		 * number in code that disagreed with the stylesheet would resolve a drag to
		 * the wrong lane in exactly the configurations nobody checks by hand. */
		rowHeightsPx: () => {
			/* Every row, in one pass, scoped to the lanes: `data-lane-base` also
			 * marks the GUTTER's base row, which sits in a different column. A zero
			 * is a row not laid out yet; the axis falls back to its group's token. */
			const rows = trackRef.current?.querySelectorAll<HTMLElement>(".tl2-lanes > .tl2-lane") ?? [];
			return [...rows].map((row) => row.getBoundingClientRect().height);
		},
		crossAxisTopPx: () => {
			const root = trackRef.current;
			/* The first LANE's top, not the lane container's: the ruler and the
			 * marker band live inside the container above the lanes, and measuring
			 * from the container put every row one lane out. */
			const base = root?.querySelector<HTMLElement>(".tl2-lanes [data-lane-base]");
			if (!root || !base) return 0;
			return base.getBoundingClientRect().top - root.getBoundingClientRect().top;
		},
		pxPerSec,
		totalSec: total,
		playhead,
		snapping: () => chromeStore.get().snapping,
		ripple: () => chromeStore.get().rippleEditing,
		sceneBoundaries: () => sceneBoundaries,
		beatTimes: () => (beatGridOn ? timelineBeats : []),
		freeClips: () => freeClips,
		/* Selection as the surface asks about it: which CLIP IDS are selected.
		 * A scene's selection lives in its own field rather than in the free-clip
		 * set, and leaving it out meant a finger could select a scene and then
		 * never drag it — the coarse rule declines an unselected clip, and the
		 * scene was permanently unselected as far as this answer was concerned. */
		selectedIds: () =>
			selectedFreeId || selectedSceneId == null
				? selectedFreeIds
				: new Set([...selectedFreeIds, clipId("scene", selectedSceneId)]),
		trackLocked,
		trackFlags: () => trackFlags,
		laneCount: () => freeRows,
		coarsePointer: coarse,
		writeEdits: (edits) => {
			/* One call, one undo step. The library hands over the whole committed
			 * edit at once, so the bracket is here rather than inside a loop that
			 * used to write per pointer sample. */
			writers.beginGesture();
			try {
				for (const edit of edits) {
					/* The clip the edit names, read from the editor's own list rather
					 * than parsed out of the id: it carries the source and the ref
					 * already, and one of them is the type the writers want. */
					/* A scene is not in `freeClips` — the base track is derived from the
					 * scene list — so it is read from the id, which is the only place
					 * that says which of the two write paths an edit belongs to. The
					 * scene writer re-sequences the whole run, because a scene move is
					 * a sequence operation rather than a single-clip command. */
					const parsed = parseClipId(edit.clipId);
					if (parsed?.source === "scene") {
						const current = baseClips.find((candidate) => candidate.id === edit.clipId);
						if (!current) continue;
						/* Only what actually changed. A scene's start is DERIVED until it
						 * is explicitly moved, so writing an unchanged start pins it and
						 * the run stops rolling behind it — which is the base track's
						 * magnetism, quietly switched off by a resize. */
						const patch = sceneEditPatch(edit, current);
						if (patch.start !== undefined || patch.dur !== undefined)
							setFreeClipPos("scene", parsed.refId, patch);
						continue;
					}
					const clip = freeClips.find((candidate) => candidate.id === edit.clipId);
					if (!clip) continue;
					const { source, refId: ref } = clip;
					setFreeClipPos(source, ref, {
						start: edit.startSec,
						dur: edit.durSec,
						track: edit.track === undefined || edit.track < 0 ? undefined : edit.track,
					});
					if (edit.mediaStartSec === undefined) continue;
					if (source === "video") updateVideoOverlay(ref, { mediaStartSec: edit.mediaStartSec });
					else if (source === "audio") updateAudio(ref, { mediaStartSec: edit.mediaStartSec });
				}
			} finally {
				writers.endGesture();
			}
		},
		/* A press that never became a drag. It arrives here rather than as a click
		 * because the surface holds pointer capture, which retargets the click to
		 * the capturing element — so the clip's own handler never sees it. */
		select: (pressedId, modifiers) => {
			const parsed = parseClipId(pressedId);
			if (parsed?.source === "scene") {
				selectScene(parsed.refId);
				return;
			}
			const clip = freeClips.find((candidate) => candidate.id === pressedId);
			if (!clip) return;
			if (modifiers.shift === true || modifiers.meta === true || modifiers.ctrl === true) {
				ops.toggleFreeClip(clip.source, clip.refId);
				return;
			}
			ops.selectFreeClip(clip.source, clip.refId, clip.start);
		},
		mediaStartSec: (clipId) => {
			const separator = clipId.indexOf(":");
			const ref = Number(clipId.slice(separator + 1));
			if (clipId.startsWith("video:"))
				return videoOverlays.find((video) => video.id === ref)?.mediaStartSec;
			if (clipId.startsWith("audio:"))
				return audioOverlays.find((audio) => audio.id === ref)?.mediaStartSec;
			return undefined;
		},
		sourceDurationSec: (clipId) =>
			audioOverlays.find((audio) => `audio:${audio.id}` === clipId)?.originalDur,
		sourceClip: (id) => store.getDoc().clips.find((clip) => clip.id === id),
	});
	return { ...timeline, sceneBoundaries };
}
