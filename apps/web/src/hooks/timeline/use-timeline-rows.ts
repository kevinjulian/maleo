/* Row bookkeeping for the timeline's free tracks.
 *
 * Three things that all key on the same drag and therefore belong together:
 * which clips are colliding while one is dragged, where a dropped clip lands
 * when it overlaps, and whether a row emptied and should close up. Plus the
 * two manual row operations — dragging a row to reorder, and organizing a
 * range onto clear rows.
 *
 * Split out of `timeline-editor.tsx`. The effects are ordered deliberately:
 * the undo gesture opens first, collision resolution and row compaction run
 * inside it, and it closes last, so one sustained drag is one undo step
 * instead of one per animation frame.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import {
	clipId,
	laneGroupOfClip,
	organizeClipsInRange,
	overlapsTime,
	type TimelineClip,
} from "@models/timeline/timeline-clips.ts";
import {
	canonicalInsertRow,
	clampRowMove,
	compactionMap,
	laneGroups,
	nextFreeLaneOfGroup,
	routeToLane,
	rowsToKeep,
	withLaneInserted,
} from "@models/timeline/lane-bookkeeping.ts";
import type { LaneGroup, Scene, TrackFlags } from "@maleo/shared";
import type { DocumentWriters } from "@stores/document-writers.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { ContentDragView } from "./use-content-timeline.ts";

export interface TimelineRowsInput {
	freeClips: TimelineClip[];
	/* The gesture as the kernel reports it. What this hook does with it —
	 * collision resolution, lane routing, the undo bracket — is Maleo's own
	 * policy about what a drop MEANS, so it stayed here when the mechanics
	 * moved to the library. */
	clipDrag: ContentDragView | null;
	dropAltRef: { current: boolean };
	setFreeClipPos: (
		source: "video" | "text" | "audio" | "effect" | "scene" | "caption",
		refId: number | string,
		patch: { start?: number; track?: number; dur?: number },
	) => void;
	trackFlags: TrackFlags;
	setTrackFlags: Dispatch<SetStateAction<TrackFlags>>;
	writers: DocumentWriters;
	selectedFreeIds: Set<string>;
	sceneAt: (t: number) => Scene | undefined;
	sceneStart: (id: number) => number;
	playhead: PlayheadHandle;
	total: number;
	setInsightsOn: Dispatch<SetStateAction<boolean>>;
	/* A span marked out on the ruler, or null. Outranks both other sources when
	 * present: it is the only one the operator stated explicitly, and on a
	 * coarse pointer it is the ONLY way to say "these clips" now that
	 * multi-select is gone. */
	timelineRange?: { start: number; end: number } | null;
}

export interface TimelineRows {
	/** Clips whose current drag position overlaps another clip on their row. */
	collidingIds: Set<string>;
	/* Which lane a clip of `group` dropped at `preferredRow` should land on,
	 * creating one when the project has no lane of that group. Answers with the
	 * row, so the caller places the clip at a time it already knows. */
	laneFor: (group: LaneGroup, preferredRow: number) => number;
	/** Reorders a lane and answers with the row it landed on (the drop row may be
	 *  clamped back inside the group's band). */
	moveFreeRow: (from: number, to: number) => number;
	organizeRange: () => void;
	/** Transient message from the last organize, or null. */
	organizeResult: string | null;
}

/* The answer when nothing is being dragged, and the same answer every time.
 *
 * A fresh empty Set here is a new identity, which every memoized lane compares
 * its props by — so arming and disarming a drag re-rendered every lane on the
 * timeline to tell each of them that nothing had collided. */
const NO_IDS: Set<string> = new Set();

export function useTimelineRows({
	freeClips,
	clipDrag,
	dropAltRef,
	setFreeClipPos,
	trackFlags,
	setTrackFlags,
	writers,
	selectedFreeIds,
	sceneAt,
	sceneStart,
	playhead,
	total,
	setInsightsOn,
	timelineRange,
}: TimelineRowsInput): TimelineRows {
	// Collision awareness while dragging: the DRAGGED clip itself turns red
	// (tl2-clip.collide — red fill + border) whenever its current position
	// overlaps another clip on the same row, warning that dropping here will
	// relocate it. Existing clips stay visually untouched.
	const draggedIdSet = useMemo(() => {
		/* No `source === "scene"` guard: a scene is dragged on the base track by a
		 * different path entirely, and the gesture view's own type says so. The
		 * check was dead and the compiler now proves it. */
		if (!clipDrag || clipDrag.mode !== "move") return NO_IDS;
		const ids = (
			clipDrag.group?.length ? clipDrag.group : [{ source: clipDrag.source, refId: clipDrag.refId }]
		).map((g) => (g.source === "caption" ? String(g.refId) : clipId(g.source, Number(g.refId))));
		return new Set(ids);
	}, [clipDrag]);
	const collidingIds = useMemo(() => {
		if (!draggedIdSet.size) return NO_IDS;
		const out = new Set<string>();
		const moving = freeClips.filter((c) => draggedIdSet.has(c.id));
		for (const m of moving) {
			const hit = freeClips.some(
				(c) => !draggedIdSet.has(c.id) && c.track === m.track && overlapsTime(m, c),
			);
			if (hit) out.add(m.id);
		}
		// Same identity for the same answer: a press that collides with nothing is
		// the common case, and returning a fresh empty Set for it re-rendered every
		// lane twice per press to report no collisions.
		return out.size ? out : NO_IDS;
	}, [draggedIdSet, freeClips]);
	// Track reorder: drag a gutter grip onto another row. Clip rows and per-row
	// flags remap together so lock/mute/hide travel with their track. The drag's
	// own state lives in the gutter that draws it; this hook only performs the
	// move.
	const [organizeResult, setOrganizeResult] = useState<string | null>(null);

	/* A row op is one undo step, and its bracket is scoped to EFFECTS, not to the
	 * call.
	 *
	 * `asOneStep` closes the gesture as soon as the op returns, which is right
	 * only when everything the action writes is synchronous. These two are not:
	 * they move clips, and row compaction — an effect — then closes the gaps the
	 * move opened. That write is wanted, but with a synchronous bracket it lands
	 * outside the gesture as a second undo entry, and undo pops that instead of
	 * the reorder.
	 *
	 * Same shape the drag path uses below: open on the action, close in an effect
	 * declared AFTER compaction so its commands land inside. */
	const rowOpGestureRef = useRef(false);
	const openRowOpGesture = (): void => {
		if (rowOpGestureRef.current) return;
		rowOpGestureRef.current = true;
		writers.beginGesture();
	};

	/** How many free lanes exist, for reading the group of each. One past the
	 *  highest occupied or declared row, which is the trailing empty lane. */
	const rowCount = (): number =>
		Math.max(
			freeClips.reduce((max, clip) => Math.max(max, clip.track), -1) + 2,
			Object.keys(trackFlags).reduce((max, key) => Math.max(max, Number(key) + 1), 0),
		);

	/* Answers with the row the lane ENDED ON, which is not always the row it was
	 * dropped at: the clamp below can pull it back inside its group's band. The
	 * caller needs the real answer because the lane's identity here is its index,
	 * so anything still pointing at `from` — the selection, most obviously — is
	 * pointing at whichever lane took its place. */
	const moveFreeRow = (from: number, target: number): number => {
		/* A reorder stays inside its group's band. Dropping an audio lane on a
		 * visual row is not rejected — it lands at the nearest position that keeps
		 * the canonical order, which is what one row less of drag would have
		 * reached. An arbitrary order would put audio between two visual lanes. */
		const to = clampRowMove(laneGroups(trackFlags, rowCount()), from, target);
		if (from === to) return from;
		openRowOpGesture();
		const mapRow = (r: number): number => {
			if (r === from) return to;
			if (from < to) return r > from && r <= to ? r - 1 : r;
			return r >= to && r < from ? r + 1 : r;
		};
		for (const c of freeClips) {
			const next = mapRow(c.track);
			if (next !== c.track) setFreeClipPos(c.source, c.refId, { track: next });
		}
		setTrackFlags((prev) => {
			const next: TrackFlags = {};
			for (const [k, v] of Object.entries(prev)) {
				const r = Number(k);
				next[r < 0 ? r : mapRow(r)] = v;
			}
			return next;
		});
		return to;
	};
	/* Route a drop to a lane that accepts it.
	 *
	 * A drop states a time and a kind, both unambiguous; only the row can be
	 * wrong, and the row is derivable — so the placement is ROUTED rather than
	 * rejected. Rejecting it would throw away two correct pieces of information
	 * to punish the third.
	 *
	 * When no lane of the group exists, one is appended and then moved into its
	 * canonical position by `moveFreeRow`, which already knows how to shift the
	 * clips and flags below it. The row returned is where the clip should land
	 * AFTER that move, so the caller places the clip in the same batch. */
	const laneFor = (group: LaneGroup, preferredRow: number): number => {
		const count = rowCount();
		const groups = laneGroups(trackFlags, count);
		const existing = routeToLane(groups, group, preferredRow);
		if (existing != null) return existing;
		const at = canonicalInsertRow(groups, group);
		openRowOpGesture();
		setTrackFlags((prev) => withLaneInserted(prev, at, group));
		for (const clip of freeClips) {
			if (clip.track < at) continue;
			setFreeClipPos(clip.source, clip.refId, { track: clip.track + 1 });
		}
		return at;
	};

	const organizeRange = (): void => {
		openRowOpGesture();
		const selected = freeClips.filter((clip) => selectedFreeIds.has(clip.id));
		const activeScene = sceneAt(playhead.get());
		/* Three sources, most explicit first. A ruler range was stated by the
		 * operator about the timeline; a clip selection was stated about clips;
		 * the scene under the playhead was never stated at all and is the
		 * fallback. Ordering them the other way round would make a marked range
		 * inert whenever anything happened to be selected. */
		const rangeStart = timelineRange
			? timelineRange.start
			: selected.length
				? Math.min(...selected.map((clip) => clip.start))
				: activeScene
					? sceneStart(activeScene.id)
					: 0;
		const rangeEnd = timelineRange
			? timelineRange.end
			: selected.length
				? Math.max(...selected.map((clip) => clip.start + clip.dur))
				: activeScene
					? sceneStart(activeScene.id) + activeScene.dur
					: total;
		const organized = organizeClipsInRange(freeClips, rangeStart, rangeEnd);
		for (const clip of organized.clips) {
			const current = freeClips.find((item) => item.id === clip.id);
			if (current && current.track !== clip.track)
				setFreeClipPos(clip.source, clip.refId, { track: clip.track });
		}
		/* Organize no longer INFERS a layout — it RESETS to the declared one, so
		 * the lane groups it laid out have to be written down. Without this the
		 * clips move and the lanes they moved onto still claim their old groups,
		 * which is the same class of disagreement declared groups exist to end.
		 * Lanes past the organized range keep whatever they declared. */
		setTrackFlags((prev) => {
			const next: TrackFlags = { ...prev };
			organized.laneGroups.forEach((group, row) => {
				next[row] = { ...prev[row], group };
			});
			return next;
		});
		setInsightsOn(true);
		setOrganizeResult(organized.moved ? `${organized.moved} moved` : "Already organized");
		window.setTimeout(() => setOrganizeResult(null), 1800);
	};

	// Drop resolution: when a move drag ends on top of existing clips, the DROPPED
	// clip(s) relocate to the NEXT row down. If that row is also occupied in the
	// same time window, a fresh row is inserted directly below the collision
	// (rows underneath shift down) — never dumped to the bottom-most row.
	// Alt-drop skips resolution entirely (deliberate overlap, e.g. an audio
	// crossfade). Dropping into clear space resolves to nothing.
	// One drag is one undo step. The pointer loop emits a command per animation
	// frame and the drop below emits one per relocated clip; recorded separately
	// they fill the 60-entry ledger, so a single sustained drag used to evict the
	// entire undo history. Opened here and closed after the drop has settled (the
	// two effects below run first, in declaration order).
	//
	// The flag is not redundant with the effect's dependency: `clipDrag` is a NEW
	// object on every frame of the drag, so an effect keyed on it fires per frame.
	// Opening a gesture per frame gives each frame its own id and coalesces nothing,
	// which is the whole bug wearing a different hat.
	const dragGestureOpenRef = useRef(false);
	useEffect(() => {
		if (clipDrag && !dragGestureOpenRef.current) {
			dragGestureOpenRef.current = true;
			writers.beginGesture();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clipDrag]);

	const prevDragRef = useRef<typeof clipDrag>(null);
	useEffect(() => {
		const was = prevDragRef.current;
		prevDragRef.current = clipDrag;
		if (!was || clipDrag || was.mode !== "move" || !was.moved) return;
		if (dropAltRef.current) {
			dropAltRef.current = false;
			return;
		}
		const movedIds = new Set(
			(was.group?.length ? was.group : [{ source: was.source, refId: was.refId }]).map((g) =>
				g.source === "caption" ? String(g.refId) : clipId(g.source, Number(g.refId)),
			),
		);
		const moved = freeClips.filter((c) => movedIds.has(c.id));
		if (!moved.length) return;
		const collidesAt = (m: TimelineClip, track: number): boolean =>
			freeClips.some((c) => !movedIds.has(c.id) && c.track === track && overlapsTime(m, c));
		/* A clip dragged onto a lane that does not accept it is ROUTED, exactly as
		 * a fresh drop is — it must not snap back. Same reasoning: the drag stated
		 * a time and the clip already knows its kind, so only the row was wrong.
		 * This runs before collision resolution because the lane it routes to is
		 * the lane the collision check should then be asked about. */
		const declared = laneGroups(trackFlags, rowCount());
		const misrouted = moved.filter(
			(m) => declared[m.track] && declared[m.track] !== laneGroupOfClip(m),
		);
		if (misrouted.length) {
			for (const m of misrouted) {
				const to = routeToLane(declared, laneGroupOfClip(m), m.track);
				if (to != null && to !== m.track) setFreeClipPos(m.source, m.refId, { track: to });
			}
			return;
		}
		if (!moved.some((m) => collidesAt(m, m.track))) return;
		/* Step 1: the next free lane of the clip's OWN group.
		 *
		 * "The row directly below" was the old answer and is now a different KIND
		 * of lane — dropping a voiceover onto an occupied audio lane used to push
		 * it onto whatever happened to be underneath, which under declared groups
		 * could be a text lane that does not accept it at all. */
		const relocation = moved.map((m) => ({
			clip: m,
			to: nextFreeLaneOfGroup(declared, laneGroupOfClip(m), m.track, (row) => !collidesAt(m, row)),
		}));
		if (relocation.every((r) => r.to != null)) {
			for (const r of relocation) setFreeClipPos(r.clip.source, r.clip.refId, { track: r.to! });
			return;
		}
		/* Step 2: every lane of the group is occupied in this window, so INSERT one
		 * adjacent — declared with the group it was inserted for, because a lane
		 * created without a group is an untyped row the next compaction deletes. */
		const minMoved = moved.reduce((min, c) => Math.min(min, c.track), Number.POSITIVE_INFINITY);
		const maxMoved = moved.reduce((max, c) => Math.max(max, c.track), 0);
		const span = maxMoved - minMoved + 1;
		const insertAt = maxMoved + 1;
		for (const c of freeClips) {
			if (movedIds.has(c.id) || c.track < insertAt) continue;
			setFreeClipPos(c.source, c.refId, { track: c.track + span });
		}
		setTrackFlags((prev) => {
			let next = prev;
			for (let i = 0; i < span; i++)
				next = withLaneInserted(next, insertAt + i, laneGroupOfClip(moved[0]!));
			return next;
		});
		for (const m of moved)
			setFreeClipPos(m.source, m.refId, { track: m.track - minMoved + insertAt });
		// freeClips/setFreeClipPos are fresh in the render where the drop landed.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clipDrag]);
	/* Row compaction: close gaps left by a move so rows stay contiguous.
	 *
	 * It writes to the document BECAUSE the document changed, which makes it
	 * indistinguishable from a user edit unless it asks. Undoing a track reorder
	 * restored the tracks, this effect judged the result non-compact and wrote
	 * them straight back, and because recording clears the redo stack the undo
	 * looked like it had done nothing at all. An undone document is a state that
	 * already existed and was already compact, so it is not a layout to correct.
	 *
	 * Asked by identity rather than by a timing flag, which loses the race: this
	 * effect re-runs on later renders as `freeClips` takes a new identity, long
	 * after an "applying" flag has been cleared. */
	useEffect(() => {
		if (clipDrag || writers.isCommandResult()) return;
		// Keep declared lanes, but close redundant empty caption lanes left by generation.
		const keep = rowsToKeep(
			freeClips.map((c) => c.track),
			trackFlags,
			rowCount(),
		);
		const rowMap = compactionMap(keep);
		const remapTrack = (track: number): number => rowMap.get(track) ?? track;
		const needsClipRemap = freeClips.some((c) => remapTrack(c.track) !== c.track);
		const occupied = new Set(rowMap.keys());
		const needsFlagRemap = Object.keys(trackFlags).some((key) => {
			const row = Number(key);
			return row >= 0 && (!occupied.has(row) || remapTrack(row) !== row);
		});
		if (!needsClipRemap && !needsFlagRemap) return;
		for (const c of freeClips) {
			const next = remapTrack(c.track);
			if (next !== c.track) setFreeClipPos(c.source, c.refId, { track: next });
		}
		setTrackFlags((prev) => {
			const next: TrackFlags = {};
			for (const [key, value] of Object.entries(prev)) {
				const row = Number(key);
				if (row < 0) next[row] = value;
				else if (occupied.has(row)) next[remapTrack(row)] = value;
			}
			return next;
		});
		// `setFreeClipPos` is stable enough for this local cleanup; including it
		// would make this effect fire on every render because it is an inline helper.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clipDrag, freeClips, trackFlags]);

	/* Close a row op's undo step. Declared after row compaction for the same
	 * reason the drag closer is: effects in one commit run in declaration order,
	 * so compaction has already written by the time this runs, and its commands
	 * are inside the gesture. */
	useEffect(() => {
		if (!rowOpGestureRef.current) return;
		rowOpGestureRef.current = false;
		writers.endGesture();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [freeClips, trackFlags]);

	// Close the drag's undo step. Declared after collision resolution and row
	// compaction so their commands land inside the gesture rather than after it.
	useEffect(() => {
		if (!clipDrag && dragGestureOpenRef.current) {
			dragGestureOpenRef.current = false;
			writers.endGesture();
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [clipDrag, freeClips]);
	return { collidingIds, laneFor, moveFreeRow, organizeRange, organizeResult };
}
