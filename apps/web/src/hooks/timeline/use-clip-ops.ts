/* NLE clip operations: clipboard (copy / paste / duplicate), razor split, ripple
 * / lift-out delete, z-order reorder, and right-click menu selection. Extracted
 * verbatim from TimelineEditor; owns the clipboard state, everything else is
 * injected (the clip arrays are parent props, so they can't move here). */
import { useState } from "react";
import type { Dispatch, SetStateAction, MouseEvent } from "react";
import {
	clipId,
	rippleShift,
	adjacentVisualPairs,
	type TimelineClip,
} from "@models/timeline/timeline-clips.ts";
import { type Clip, resequenceScenes, retainClipWindow, canRetainClipWindow } from "@maleo/shared";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type {
	AudioOverlay,
	EffectClip,
	InfographicOverlay,
	Scene,
	SceneDurationMode,
	TextOverlay,
	VideoOverlay,
} from "@maleo/shared";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { editCaptions, trimClipAtPlayhead } from "@maleo/shared/editor";

// A copied free clip carries its full record so paste/duplicate reproduces every
// property (layout, style, gen, volume…) under a fresh id.
export type ClipboardItem =
	| { source: "video"; data: VideoOverlay }
	| { source: "text"; data: TextOverlay }
	| { source: "audio"; data: AudioOverlay }
	| { source: "infographic"; data: InfographicOverlay }
	| { source: "effect"; data: EffectClip }
	| { source: "caption"; data: Clip };

type ClipSource = "video" | "text" | "audio" | "effect" | "scene" | "infographic";

interface ClipOpsOptions {
	openAnimationPair: (fromClipId: string, toClipId: string) => void;
	writers: DocumentWriters;
	playhead: PlayheadHandle;
	total: number;
	freeRows: number;
	freeClips: TimelineClip[];
	captionClips: readonly Clip[];
	videoOverlays: VideoOverlay[];
	overlays: TextOverlay[];
	audioOverlays: AudioOverlay[];
	infographicOverlays: InfographicOverlay[];
	effects: EffectClip[];
	selectedFreeIds: Set<string>;
	selectedFreeId: string | null;
	selectedEffectId: number | null;
	selectedSceneId: number | undefined;
	setVideoOverlays: Dispatch<SetStateAction<VideoOverlay[]>>;
	setOverlays: Dispatch<SetStateAction<TextOverlay[]>>;
	setAudioOverlays: Dispatch<SetStateAction<AudioOverlay[]>>;
	setInfographicOverlays: Dispatch<SetStateAction<InfographicOverlay[]>>;
	setEffects: Dispatch<SetStateAction<EffectClip[]>>;
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setPreviewSceneId: Dispatch<SetStateAction<number | undefined>>;
	setSelectedVideoOvId: Dispatch<SetStateAction<number | null>>;
	setSelectedOverlayId: Dispatch<SetStateAction<number | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<number | null>>;
	setSelectedEffectId: Dispatch<SetStateAction<number | null>>;
	setSelectedTransition: Dispatch<SetStateAction<number | null>>;
	setSelectedFreeIds: Dispatch<SetStateAction<ReadonlySet<string>>>;
	setEditorSceneId: Dispatch<SetStateAction<number | undefined>>;
	setCtxMenu: Dispatch<SetStateAction<{ x: number; y: number } | null>>;
	isLockedClip: (id: string) => boolean;
	isClipSelected: (id: string) => boolean;
	clearSelection: () => void;
	removeFreeClipById: (id: string) => void;
	updateVideoOverlay: (id: number, patch: Partial<VideoOverlay>) => void;
	updateAudio: (id: number, patch: Partial<AudioOverlay>) => void;
	updateOverlay: (id: number, patch: Partial<TextOverlay>) => void;
	setFreeClipPos: (
		source: ClipSource,
		refId: number,
		patch: { start?: number; track?: number; dur?: number; durMode?: SceneDurationMode },
	) => void;
	selectFreeClip: (
		source: "video" | "text" | "audio" | "infographic",
		refId: number,
		start: number,
	) => void;
	sceneAt: (t: number) => Scene | undefined;
	sceneStart: (id: number) => number;
	trackLocked: (row?: number) => boolean;
}

export interface ClipOps {
	transitionAfterSelection?: () => void;
	clipboard: ClipboardItem[];
	selectionIds: () => string[];
	mutableIds: () => string[];
	copySelection: () => void;
	pasteClipboard: (at?: number, track?: number) => void;
	duplicateSelection: () => void;
	splitAtPlayhead: () => void;
	trimAtPlayhead: (side: "before" | "after") => void;
	rippleDeleteSelection: () => void;
	deleteSelection: () => void;
	reorderSelection: (dir: "front" | "back") => void;
	openClipMenu: (c: TimelineClip, e: MouseEvent) => void;
}

export function useClipOps(opts: ClipOpsOptions): ClipOps {
	const {
		playhead,
		total,
		freeRows,
		freeClips,
		videoOverlays,
		overlays,
		audioOverlays,
		infographicOverlays,
		effects,
		selectedFreeIds,
		selectedFreeId,
		selectedEffectId,
		setVideoOverlays,
		setOverlays,
		setAudioOverlays,
		setInfographicOverlays,
		setEffects,
		setScenes,
		setPreviewSceneId,
		setSelectedVideoOvId,
		setSelectedOverlayId,
		setSelectedAudioId,
		setSelectedEffectId,
		setSelectedTransition,
		setSelectedFreeIds,
		setEditorSceneId,
		setCtxMenu,
		isLockedClip,
		isClipSelected,
		clearSelection,
		removeFreeClipById,
		updateOverlay,
		setFreeClipPos,
		selectFreeClip,
		sceneAt,
		sceneStart,
		trackLocked,
	} = opts;
	const [clipboard, setClipboard] = useState<ClipboardItem[]>([]);

	// ── NLE clipboard ops (copy / paste / duplicate) ──
	// The current selection as ids: the multi-select set, else the single primary.
	const selectionIds = (): string[] =>
		selectedFreeIds.size ? [...selectedFreeIds] : selectedFreeId ? [selectedFreeId] : [];
	// Selection minus anything on a locked track — the set mutating ops may touch.
	const mutableIds = (): string[] => selectionIds().filter((id) => !isLockedClip(id));
	// Resolve a free-clip id ("video:3", "effect:7") to its full record. parseClipId
	// omits effects, so split locally to cover every source.
	const recordFor = (id: string): ClipboardItem | null => {
		if (id.startsWith("caption:")) {
			const cue = opts.captionClips.find((clip) => clip.id === id);
			return cue ? { source: "caption", data: cue } : null;
		}
		const [s, idRaw] = id.split(":");
		const refId = Number(idRaw);
		if (!Number.isFinite(refId)) return null;
		if (s === "video") {
			const d = videoOverlays.find((x) => x.id === refId);
			return d ? { source: "video", data: d } : null;
		}
		if (s === "text") {
			const d = overlays.find((x) => x.id === refId);
			return d ? { source: "text", data: d } : null;
		}
		if (s === "audio") {
			const d = audioOverlays.find((x) => x.id === refId);
			return d ? { source: "audio", data: d } : null;
		}
		if (s === "infographic") {
			const d = infographicOverlays.find((x) => x.id === refId);
			return d ? { source: "infographic", data: d } : null;
		}
		if (s === "effect") {
			const d = effects.find((x) => x.id === refId);
			return d ? { source: "effect", data: d } : null;
		}
		return null;
	};
	const collectSelection = (): ClipboardItem[] =>
		selectionIds()
			.map(recordFor)
			.filter((x): x is ClipboardItem => x != null);
	// Place copies on the timeline. An anchor shifts the group's earliest start to
	// that time (paste at playhead / at a right-click point); otherwise nudge +0.5s
	// (duplicate in place). A target track moves every pasted clip onto that row
	// (paste into the right-clicked lane).
	const placeClips = (items: ClipboardItem[], anchor: number | null, track?: number): void => {
		if (!items.length) return;
		const minStart = Math.min(
			...items.map((i) => (i.source === "caption" ? i.data.startSec : i.data.start)),
		);
		const offset = anchor != null ? anchor - minStart : 0.5;
		const base = Date.now();
		const nv: VideoOverlay[] = [],
			nt: TextOverlay[] = [],
			na: AudioOverlay[] = [],
			ng: InfographicOverlay[] = [],
			nf: EffectClip[] = [];
		const ids: string[] = [];
		items.forEach((it, i) => {
			const id = base + i;
			const start = Math.max(
				0,
				Math.min(total, (it.source === "caption" ? it.data.startSec : it.data.start) + offset),
			);
			const row = track != null ? { track } : {};
			if (it.source === "caption") {
				const id = `caption:${crypto.randomUUID()}`;
				opts.writers.apply(
					editCaptions({
						action: "create",
						clip: {
							...it.data,
							id,
							startSec: start,
							...row,
							caption: it.data.caption
								? {
										...it.data.caption,
										revision: 0,
										protection: { ...it.data.caption.protection, timing: true },
									}
								: undefined,
						},
					}),
				);
				ids.push(id);
			} else if (it.source === "video") {
				nv.push({ ...it.data, id, start, ...row });
				ids.push(clipId("video", id));
			} else if (it.source === "text") {
				nt.push({ ...it.data, id, start, ...row });
				ids.push(clipId("text", id));
			} else if (it.source === "audio") {
				na.push({ ...it.data, id, start, ...row });
				ids.push(clipId("audio", id));
			} else if (it.source === "infographic") {
				ng.push({ ...it.data, id, start, ...row });
				ids.push(clipId("infographic", id));
			} else {
				nf.push({ ...it.data, id, start, ...row });
				ids.push(`effect:${id}`);
			}
		});
		if (nv.length) setVideoOverlays((v) => [...v, ...nv]);
		if (nt.length) setOverlays((o) => [...o, ...nt]);
		if (na.length) setAudioOverlays((a) => [...a, ...na]);
		if (ng.length) setInfographicOverlays((g) => [...g, ...ng]);
		if (nf.length) setEffects((e) => [...e, ...nf]);
		setSelectedVideoOvId(null);
		setSelectedOverlayId(null);
		setSelectedAudioId(null);
		setSelectedEffectId(null);
		setSelectedFreeIds(new Set(ids));
	};
	const copySelection = (): void => {
		const items = collectSelection();
		if (items.length) setClipboard(items);
	};
	const pasteClipboard = (at?: number, track?: number): void =>
		placeClips(clipboard, at ?? playhead.get(), track);
	const duplicateSelection = (): void => placeClips(collectSelection(), null);

	// Razor (S / ⌘B): split the selected free clip — else the base scene under the
	// playhead — into two independent clips at the playhead. Video/audio set the new
	// half's media in-point so it plays from the cut, not from the source start.
	const splitAtPlayheadOp = (): void => {
		const t = playhead.get();
		const r2 = (n: number): number => Math.round(n * 30) / 30;
		// selectedFreeId only covers video/text/audio; include the selected effect so
		// S splits it instead of falling through to the base scene.
		const fid = selectedFreeId ?? (selectedEffectId != null ? `effect:${selectedEffectId}` : null);
		if (fid) {
			const c = freeClips.find((x) => x.id === fid);
			if (c && isLockedClip(c.id)) return;
			if (c && t > c.start + 0.05 && t < c.start + c.dur - 0.05) {
				const leftDur = r2(t - c.start),
					rightStart = c.start + leftDur,
					rightDur = c.dur - leftDur;
				const nid = Date.now();
				if (c.source === "caption") {
					const id = `caption:${crypto.randomUUID()}`;
					opts.writers.apply(editCaptions({ action: "split", id: c.id, at: t, newId: id }));
					setSelectedFreeIds(new Set([id]));
				} else if (c.source === "video") {
					const d = videoOverlays.find((v) => v.id === c.refId);
					if (d) {
						const original = {
							id: c.id,
							type: d.kind,
							startSec: d.start,
							durationSec: d.dur,
							track: d.track ?? 0,
							video: d,
						};
						const left = retainClipWindow(original, 0, leftDur).video!,
							right = retainClipWindow(original, leftDur, d.dur).video!;
						setVideoOverlays((items) => [
							...items.map((v) => (v.id === d.id ? left : v)),
							{ ...right, id: nid },
						]);
						setSelectedVideoOvId(nid);
						setSelectedFreeIds(new Set([clipId("video", nid)]));
					}
				} else if (c.source === "audio") {
					const d = audioOverlays.find((a) => a.id === c.refId);
					if (d) {
						const original = {
							id: c.id,
							type: "audio" as const,
							startSec: d.start,
							durationSec: d.dur,
							track: d.track ?? 0,
							audio: d,
						};
						const left = retainClipWindow(original, 0, leftDur).audio!,
							right = retainClipWindow(original, leftDur, d.dur).audio!;
						setAudioOverlays((items) => [
							...items.map((a) => (a.id === d.id ? left : a)),
							{ ...right, id: nid },
						]);
						setSelectedAudioId(nid);
						setSelectedFreeIds(new Set([clipId("audio", nid)]));
					}
				} else if (c.source === "text") {
					const d = overlays.find((o) => o.id === c.refId);
					if (d) {
						updateOverlay(d.id, { dur: leftDur });
						setOverlays((o) => [...o, { ...d, id: nid, start: rightStart, dur: rightDur }]);
						setSelectedOverlayId(nid);
						setSelectedFreeIds(new Set([clipId("text", nid)]));
					}
				} else if (c.source === "infographic") {
					const d = infographicOverlays.find((g) => g.id === c.refId);
					if (d) {
						setFreeClipPos("infographic", d.id, { dur: leftDur });
						setInfographicOverlays((g) => [
							...g,
							{ ...d, id: nid, start: rightStart, dur: rightDur },
						]);
						setSelectedFreeIds(new Set([clipId("infographic", nid)]));
					}
				} else if (c.source === "effect") {
					const d = effects.find((x) => x.id === c.refId);
					if (d) {
						setEffects((e) => [
							...e.map((x) => (x.id === d.id ? { ...x, dur: leftDur } : x)),
							{ ...d, id: nid, start: rightStart, dur: rightDur },
						]);
						setSelectedEffectId(nid);
						setSelectedFreeIds(new Set([`effect:${nid}`]));
					}
				}
				return;
			}
			return;
		}
		const sc = sceneAt(t);
		if (sc && !trackLocked(-1)) {
			const local = t - sceneStart(sc.id);
			if (local > 0.1 && local < sc.dur - 0.1) {
				const duration = r2(local);
				const original = {
					id: clipId("scene", sc.id),
					type: "image" as const,
					startSec: sceneStart(sc.id),
					durationSec: sc.dur,
					track: sc.track ?? -1,
					scene: sc,
				};
				if (!canRetainClipWindow(original, duration, sc.dur)) return;
				const nid = Date.now();
				setScenes((all) => {
					const i = all.findIndex((s) => s.id === sc.id);
					if (i < 0) return all;
					const left: Scene = { ...retainClipWindow(original, 0, duration).scene!, dur: duration };
					const right: Scene = {
						...retainClipWindow(original, duration, sc.dur).scene!,
						id: nid,
						start: undefined,
						dur: sc.dur - duration,
						history: undefined,
					};
					const a = [...all];
					a.splice(i, 1, left, right);
					return resequenceScenes(a);
				});
				setPreviewSceneId(nid);
			}
		}
	};
	const splitAtPlayhead = (): void => {
		opts.writers.beginGesture();
		try {
			splitAtPlayheadOp();
		} finally {
			opts.writers.endGesture();
		}
	};
	const trimAtPlayhead = (side: "before" | "after"): void => {
		const scene = sceneAt(playhead.get());
		const id =
			selectedFreeId ??
			(selectedEffectId != null
				? `effect:${selectedEffectId}`
				: opts.selectedSceneId != null
					? clipId("scene", opts.selectedSceneId)
					: scene
						? clipId("scene", scene.id)
						: null);
		if (id) {
			const cue = opts.captionClips.find((clip) => clip.id === id);
			if (cue) {
				const at = playhead.get();
				if (at > cue.startSec && at < cue.startSec + cue.durationSec)
					opts.writers.apply(
						editCaptions({
							action: "timing",
							id,
							startSec: side === "before" ? at : cue.startSec,
							durationSec:
								side === "before" ? cue.startSec + cue.durationSec - at : at - cue.startSec,
						}),
					);
			} else opts.writers.apply(trimClipAtPlayhead(id, playhead.get(), side));
		}
	};

	// Ripple delete: remove the selected clips AND close the gap they left — every
	// later clip on the same track slides left by the removed duration before it.
	const rippleDeleteSelection = (): void => {
		const removed = mutableIds()
			.map((id) => freeClips.find((c) => c.id === id))
			.filter((c): c is TimelineClip => c != null);
		if (!removed.length) return;
		const gone = new Set(removed.map((r) => r.id));
		const deletedCaptions = removed
			.filter((clip) => clip.source === "caption")
			.map((clip) => clip.id);
		if (deletedCaptions.length)
			opts.writers.apply(editCaptions({ action: "delete", ids: deletedCaptions }));
		for (const cue of opts.captionClips) {
			if (gone.has(cue.id) || trackLocked(cue.track)) continue;
			const shift = rippleShift(removed, cue.track, cue.startSec);
			if (shift)
				opts.writers.apply(
					editCaptions({
						action: "timing",
						id: cue.id,
						startSec: Math.max(0, cue.startSec - shift),
						durationSec: cue.durationSec,
					}),
				);
		}
		const shiftFor = (track: number, start: number): number => rippleShift(removed, track, start);
		setVideoOverlays((v) =>
			v
				.filter((o) => !gone.has(clipId("video", o.id)))
				.map((o) => ({ ...o, start: Math.max(0, o.start - shiftFor(o.track ?? 0, o.start)) })),
		);
		setOverlays((arr) =>
			arr
				.filter((o) => !gone.has(clipId("text", o.id)))
				.map((o) => ({ ...o, start: Math.max(0, o.start - shiftFor(o.track ?? 0, o.start)) })),
		);
		setAudioOverlays((arr) =>
			arr
				.filter((o) => !gone.has(clipId("audio", o.id)))
				.map((o) => ({ ...o, start: Math.max(0, o.start - shiftFor(o.track ?? 0, o.start)) })),
		);
		setInfographicOverlays((arr) =>
			arr
				.filter((o) => !gone.has(clipId("infographic", o.id)))
				.map((o) => ({ ...o, start: Math.max(0, o.start - shiftFor(o.track ?? 0, o.start)) })),
		);
		setEffects((arr) =>
			arr
				.filter((o) => !gone.has(`effect:${o.id}`))
				.map((o) => ({ ...o, start: Math.max(0, o.start - shiftFor(o.track ?? 0, o.start)) })),
		);
		clearSelection();
	};
	const deleteSelection = (): void => {
		for (const id of mutableIds()) removeFreeClipById(id);
		clearSelection();
	};
	// Z-order: send selected clips to the top (front) or bottom (back) layer row.
	const reorderSelection = (dir: "front" | "back"): void => {
		const track = dir === "front" ? Math.max(0, freeRows - 1) : 0;
		for (const id of mutableIds()) {
			const p = recordFor(id);
			if (p?.source === "caption")
				opts.writers.apply({ type: "clip.update", id: p.data.id, patch: { track } });
			else if (p) setFreeClipPos(p.source, p.data.id, { track });
		}
	};
	// Open the right-click menu, selecting the clip first if it wasn't already.
	const openClipMenu = (c: TimelineClip, e: MouseEvent): void => {
		e.preventDefault();
		e.stopPropagation();
		if (!isClipSelected(c.id)) {
			if (c.source === "effect") {
				setSelectedEffectId(c.refId);
				setSelectedVideoOvId(null);
				setSelectedOverlayId(null);
				setSelectedAudioId(null);
				setSelectedTransition(null);
				setSelectedFreeIds(new Set([c.id]));
				setEditorSceneId(undefined);
			} else if (c.source === "caption") {
				clearSelection();
				setSelectedFreeIds(new Set([c.id]));
			} else selectFreeClip(c.source, c.refId, c.start);
		}
		setCtxMenu({ x: e.clientX, y: e.clientY });
	};

	const pair = adjacentVisualPairs(freeClips).find((p) => p.from.id === selectedFreeId);
	const transitionAfterSelection =
		pair && !isLockedClip(pair.from.id) && !isLockedClip(pair.to.id)
			? () => opts.openAnimationPair(pair.from.id, pair.to.id)
			: undefined;

	return {
		transitionAfterSelection,
		clipboard,
		selectionIds,
		mutableIds,
		copySelection,
		pasteClipboard,
		duplicateSelection,
		splitAtPlayhead,
		trimAtPlayhead,
		rippleDeleteSelection,
		deleteSelection,
		reorderSelection,
		openClipMenu,
	};
}
