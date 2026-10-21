/* The base track, and the two right-click menus that open over the lanes.
 *
 * Scenes are normal clips on the unified rows — there is no special scene rail
 * any more — but a beat holding several visual clips still renders one clip
 * per visual, so the base row has to be derived rather than read. The primary
 * visual keeps the beat's own clip id; the extras get `vis:` ids.
 *
 * The two menu openers live here because their snap magnets are exactly this
 * derivation: the playhead, every base and free clip edge, and the beat grid
 * when it is on.
 *
 * Split out of `timeline-editor.tsx`.
 */
import { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import {
	clipId,
	snapTime,
	type BaseTrackClip,
	type TimelineClip,
} from "@models/timeline/timeline-clips.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { Scene } from "@maleo/shared";

export interface BaseTrackInput {
	scenes: Scene[];
	sceneStart: (id: number) => number;
	gen: Record<number, boolean>;
	freeClips: TimelineClip[];
	playhead: PlayheadHandle;
	total: number;
	pxPerSec: number;
	beatGridOn: boolean;
	timelineBeats: number[];
	selectScene: (sceneId: number) => void;
	setCtxMenu: (v: null) => void;
}

export interface BaseTrack {
	baseClips: BaseTrackClip[];
	openAddMenu: (e: ReactMouseEvent<HTMLDivElement>, row: number) => void;
	openSceneMenu: (e: ReactMouseEvent<HTMLElement>, sceneId: number) => void;
	sceneMenu: { x: number; y: number; sceneId: number } | null;
	setSceneMenu: React.Dispatch<
		React.SetStateAction<{ x: number; y: number; sceneId: number } | null>
	>;
	addMenu: { x: number; y: number; t: number; row: number } | null;
	setAddMenu: React.Dispatch<
		React.SetStateAction<{ x: number; y: number; t: number; row: number } | null>
	>;
}

export function useBaseTrack({
	scenes,
	sceneStart,
	gen,
	freeClips,
	playhead,
	total,
	pxPerSec,
	beatGridOn,
	timelineBeats,
	selectScene,
	setCtxMenu,
}: BaseTrackInput): BaseTrack {
	/* Right-click scene menu (base track clip) and the "Add clip" menu over empty
	 * lane space. Viewport coordinates, so they die with the pointer. */
	const [sceneMenu, setSceneMenu] = useState<{ x: number; y: number; sceneId: number } | null>(
		null,
	);
	const [addMenu, setAddMenu] = useState<{ x: number; y: number; t: number; row: number } | null>(
		null,
	);
	type BaseClip = BaseTrackClip;
	// Scenes occupy the base track (row 0); overlays sit on the rows above. Scenes are
	// normal clips (same styling/interactions), just grouped on the base lane — there
	// is no special "scene rail" any more.
	// Base-track visuals: a beat with multiple visual clips renders each as its own
	// clip (multi-image-per-beat); a single-image beat renders one scene clip.
	const baseClips: BaseClip[] = scenes
		.flatMap((s): BaseClip[] => {
			const ss = sceneStart(s.id);
			const vcs = s.visualClips ?? [];
			if (vcs.length > 1) {
				// Primary keeps id "scene:N" (= the beat clip in the doc); extras are vis:N:x.
				const primaryIdx = Math.max(
					0,
					vcs.findIndex((v) => v.primary),
				);
				return vcs.map((v, i) =>
					i === primaryIdx
						? {
								id: clipId("scene", s.id),
								sceneId: s.id,
								vclipId: null,
								start: ss + (v.startSec ?? 0),
								dur: Math.max(0.5, v.durationSec ?? s.dur),
								thumb: v.url,
								label: s.name,
								gen: Boolean(gen[s.id]),
								hasImg: true,
							}
						: {
								id: `vis:${s.id}:${v.id}`,
								sceneId: s.id,
								vclipId: v.id,
								start: ss + (v.startSec ?? 0),
								dur: Math.max(0.5, v.durationSec ?? s.dur),
								thumb: v.url,
								label: s.name,
								gen: Boolean(gen[s.id]),
								hasImg: true,
							},
				);
			}
			return [
				{
					id: clipId("scene", s.id),
					sceneId: s.id,
					vclipId: null,
					start: ss,
					dur: Math.max(1, s.dur),
					thumb: s.src,
					label: s.name,
					gen: Boolean(gen[s.id]),
					hasImg: s.img,
				},
			];
		})
		.sort((a, b) => a.start - b.start);

	// Right-click on empty lane space → "Add clip" menu at the snapped time. Snap
	// magnets: playhead, every clip edge, and the beat grid when it's on. Clips own
	// their context menu (openClipMenu stops propagation), so only true lane space
	// opens this one.
	const openAddMenu = (e: ReactMouseEvent<HTMLDivElement>, row: number): void => {
		e.preventDefault();
		if (e.target !== e.currentTarget) return;
		e.stopPropagation();
		const rawAtCursor = (e.clientX - e.currentTarget.getBoundingClientRect().left) / pxPerSec;
		const at = playhead.get();
		const raw = Number.isFinite(rawAtCursor) ? rawAtCursor : at;
		const candidates = [
			at,
			...(beatGridOn ? timelineBeats : []),
			...baseClips.flatMap((c) => [c.start, c.start + c.dur]),
			...freeClips.flatMap((c) => [c.start, c.start + c.dur]),
		];
		const t = Math.min(snapTime(raw, candidates, 8 / pxPerSec), Math.max(0, total));
		setCtxMenu(null);
		setSceneMenu(null);
		setAddMenu({ x: e.clientX, y: e.clientY, t, row });
	};
	const openSceneMenu = (e: ReactMouseEvent<HTMLElement>, sceneId: number): void => {
		e.preventDefault();
		e.stopPropagation();
		selectScene(sceneId);
		setCtxMenu(null);
		setAddMenu(null);
		setSceneMenu({ x: e.clientX, y: e.clientY, sceneId });
	};
	return { baseClips, openAddMenu, openSceneMenu, sceneMenu, setSceneMenu, addMenu, setAddMenu };
}
