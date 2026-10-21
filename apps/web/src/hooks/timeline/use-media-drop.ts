import {
	useEffect,
	useRef,
	type Dispatch,
	type DragEvent,
	type RefObject,
	type SetStateAction,
} from "react";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { BaseTrackClip, TimelineClip } from "@models/timeline/timeline-clips.ts";
import {
	DATA_CALLOUT_DND_MIME,
	MEDIA_DND_MIME,
	type MediaAsset,
} from "@models/timeline/editor-media.ts";
import { mediaDragPreview } from "@models/timeline/media-drag.ts";
import {
	hasTimelineExternalDrag,
	readMediaDrop,
	type MediaDropInfo,
} from "@models/timeline/timeline-drops.ts";
import type { Engine } from "@maleo/shared/editor";
import { loadedEditorEngine } from "@services/editor-engine/engine-loader.ts";
import {
	mediaDropReason,
	mediaDropTime,
	mediaPlacementDuration,
	mediaPlacementLane,
	placeMediaOverlay,
	sceneVisualPlacement,
} from "@models/timeline/media-placement.ts";
import type { Scene, MediaImportReadiness } from "@maleo/shared";
import { admitMediaCommand } from "@models/timeline/media-admission.ts";
import type { Selection } from "@models/timeline/selection-model.ts";
import { selectClip } from "@models/timeline/selection-model.ts";
import { contentSnapCandidates } from "./use-content-timeline.ts";
import { fmtMMSS } from "@models/core/measures.ts";

/** Same wording as the import hook, so the ghost and the Assets panel agree. */
const importUnavailable = (readiness: MediaImportReadiness | null): string =>
	readiness
		? `Import unavailable: ${readiness.reason ?? "media worker unavailable"}`
		: "Import is still starting";

/* The editor route mounts after the engine has loaded, so a drop always finds it. */
function editorEngine(): Engine {
	const engine = loadedEditorEngine();
	if (!engine) throw new Error("the editor engine is not loaded");
	return engine;
}

export function useMediaDrop(input: {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	ops: {
		sceneAt: (time: number) => Scene | undefined;
		sceneStart: (id: number) => number;
		addVisualClip: (id: number, url: string, kind: "image" | "video", assetId?: string) => void;
		addSceneWithMedia: (url: string, assetId?: string) => void;
		setSelection: Dispatch<SetStateAction<Selection>>;
		seekPreview: (time: number) => void;
		importFiles: (files: File[], place?: (asset: MediaAsset) => boolean) => void;
		importReadiness: MediaImportReadiness | null;
	};
	assets: readonly MediaAsset[];
	freeRows: number;
	pxPerSec: number;
	total: number;
	playhead: PlayheadHandle;
	sceneBoundaries: readonly number[];
	beatTimes: readonly number[];
	freeClips: readonly TimelineClip[];
	baseClips: readonly BaseTrackClip[];
	lanesRef: RefObject<HTMLDivElement | null>;
	admitDrop: (media: MediaDropInfo) => string;
}) {
	const {
		store,
		writers,
		ops,
		assets,
		freeRows,
		pxPerSec,
		total,
		playhead,
		sceneBoundaries,
		beatTimes,
		freeClips,
		baseClips,
		lanesRef,
		admitDrop,
	} = input;
	const dropGhostRef = useRef<HTMLDivElement | null>(null);
	const highlighted = useRef<HTMLElement | null>(null);
	const dropTime = (e: DragEvent): number =>
		mediaDropTime(
			editorEngine(),
			e.clientX,
			lanesRef.current?.getBoundingClientRect().left ??
				e.currentTarget.getBoundingClientRect().left,
			pxPerSec,
			contentSnapCandidates({
				totalSec: total,
				playheadSec: playhead.get(),
				sceneBoundaries,
				beatTimes,
				clips: freeClips,
			}),
			e.altKey,
		);
	const hideDropGhost = (): void => {
		if (dropGhostRef.current) dropGhostRef.current.style.display = "none";
		highlighted.current?.removeAttribute("data-media-drop");
		highlighted.current = null;
	};
	useEffect(() => {
		window.addEventListener("dragend", hideDropGhost);
		return () => {
			window.removeEventListener("dragend", hideDropGhost);
			hideDropGhost();
		};
	}, []);

	const placement = (media: MediaDropInfo, row: number, at: number) => {
		const target = mediaPlacementLane(media.kind, row, store.getDoc().trackFlags ?? {}, freeRows);
		const error = mediaDropReason(media, assets) ?? target.error;
		const scene = target.row < 0 ? ops.sceneAt(at) : undefined;
		const visualSpan = scene ? sceneVisualPlacement(scene) : undefined;
		const reelEnd = baseClips.reduce((end, c) => Math.max(end, c.start + c.dur), 0);
		return {
			...target,
			error:
				error ??
				(target.row < 0 && !scene && media.kind === "video"
					? "Drop video on a scene or visual lane"
					: undefined),
			scene,
			start:
				target.row < 0 ? (scene ? ops.sceneStart(scene.id) + visualSpan!.startSec : reelEnd) : at,
			dur: target.row < 0 && scene ? visualSpan!.durationSec : mediaPlacementDuration(media),
		};
	};
	const commitPlacement = (
		media: MediaDropInfo,
		row: number,
		at: number,
		asset?: MediaAsset,
	): boolean => {
		const target = placement(media, row, at);
		if (
			target.error ||
			(target.scene &&
				!store.getDoc().clips.some((clip) => clip.id === `scene:${target.scene!.id}`))
		)
			return false;
		writers.beginGesture();
		try {
			if (asset) writers.apply(admitMediaCommand(asset));
			const assetId = admitDrop(media);
			if (target.row < 0) {
				if (target.scene)
					ops.addVisualClip(
						target.scene.id,
						media.url,
						media.kind === "video" ? "video" : "image",
						assetId,
					);
				else ops.addSceneWithMedia(media.url, assetId);
			} else {
				let id = Date.now();
				while (
					store
						.getDoc()
						.clips.some((c) => c.id === `${media.kind === "audio" ? "audio" : "video"}:${id}`)
				)
					id++;
				writers.mutate((doc) =>
					placeMediaOverlay(
						doc,
						{ ...media, mediaAssetId: assetId },
						target.start,
						row < 0 ? 0 : row,
						id,
					),
				);
				ops.setSelection(selectClip(media.kind === "audio" ? "audio" : "video", id));
				ops.seekPreview(target.start);
			}
		} finally {
			writers.endGesture();
		}
		return true;
	};
	const livePlacement = useRef({ placement, commitPlacement });
	livePlacement.current = { placement, commitPlacement };
	const onMediaDrop = (e: DragEvent, row: number): boolean => {
		if (e.dataTransfer.files.length) {
			e.preventDefault();
			e.stopPropagation();
			if (store.getDoc().trackFlags?.[row]?.locked || !ops.importReadiness?.available) return true;
			const at = dropTime(e);
			const sceneId = row < 0 ? ops.sceneAt(at)?.id : undefined;
			ops.importFiles(Array.from(e.dataTransfer.files), (asset) => {
				const latest = livePlacement.current;
				if (row < 0 && latest.placement(asset, row, at).scene?.id !== sceneId) return false;
				return latest.commitPlacement({ ...asset }, row, at, asset);
			});
			return true;
		}
		if (!e.dataTransfer.types.includes(MEDIA_DND_MIME)) return false;
		e.preventDefault();
		e.stopPropagation();
		const media = readMediaDrop(e);
		if (media) commitPlacement(media, row, dropTime(e));
		return true;
	};
	const moveDropGhost = (e: DragEvent<HTMLDivElement>): void => {
		if (!hasTimelineExternalDrag(e)) return;
		const lanes = lanesRef.current,
			ghost = dropGhostRef.current;
		const lane = e.target instanceof Element ? e.target.closest<HTMLElement>(".tl2-lane") : null;
		if (!lanes || !ghost || !lane) {
			hideDropGhost();
			return;
		}
		const media = mediaDragPreview();
		const row = lane.hasAttribute("data-lane-base")
			? -1
			: Number(lane.dataset.vuiRow?.replace("lane-", ""));
		const at = dropTime(e);
		const target = media ? placement(media, row, at) : null;
		const fileDrop = e.dataTransfer.types.includes("Files");
		const error =
			target?.error ??
			(fileDrop && store.getDoc().trackFlags?.[row]?.locked
				? "Track locked"
				: fileDrop && !ops.importReadiness?.available
					? importUnavailable(ops.importReadiness)
					: !media && e.dataTransfer.types.includes(MEDIA_DND_MIME)
						? "Media is not ready"
						: undefined);
		const destination =
			target && target.row >= 0 && !target.create
				? (lanes.querySelector<HTMLElement>(`[data-vui-row="lane-${target.row}"]`) ?? lane)
				: lane;
		highlighted.current?.removeAttribute("data-media-drop");
		highlighted.current = destination;
		destination.dataset.mediaDrop = error ? "invalid" : "valid";
		ghost.dataset.invalid = String(Boolean(error));
		ghost.style.display = "";
		ghost.style.left = `${(target?.start ?? at) * pxPerSec}px`;
		ghost.style.top = `${destination.offsetTop}px`;
		const dur = target?.dur ?? (e.dataTransfer.types.includes(DATA_CALLOUT_DND_MIME) ? 4 : 3);
		ghost.style.width = `${Math.max(1, dur * pxPerSec)}px`;
		ghost.style.height = `${destination.offsetHeight}px`;
		ghost.textContent =
			error ??
			(fileDrop
				? `Import files · ${fmtMMSS(at)} · Duration after processing`
				: `${media?.label ?? "Place item"} · ${fmtMMSS(target?.start ?? at)} · ${dur}s${target?.create ? " · New lane" : ""}`);
		ghost.setAttribute("aria-label", ghost.textContent);
		if (fileDrop || e.dataTransfer.types.includes(MEDIA_DND_MIME)) {
			e.preventDefault();
			e.dataTransfer.dropEffect = error ? "none" : "copy";
		}
	};
	return { dropGhostRef, dropTime, onMediaDrop, moveDropGhost, hideDropGhost };
}
