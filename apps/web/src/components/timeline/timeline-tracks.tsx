import { BookmarksDialog } from "./timeline-bookmarks.tsx";
/* The timeline: the ruler, the label gutter, the scrolling lanes, the clips in
 * them, and the playhead, snap line, marquee and drag ghosts that move over the
 * top.
 *
 * Split out of `timeline-editor.tsx`, which was 2153 lines. The split is by
 * ownership, not by prop threading: the hover cursor, the drop ghost, the
 * marquee and the scrub handlers are per-gesture state that nothing outside
 * this region reads, so they live here now and the editor no longer carries
 * them. What is left crossing the boundary is the two bags below — the same
 * shape `TimelinePanelHost` takes, and for the same reason: the document, the
 * chrome and the track flags are read from their stores directly, so only what
 * the editor DERIVES has to be handed over.
 *
 * `trackRef` is the exception and it is deliberate. `useTimelineZoom` is keyed
 * on it and publishes `pxPerSec`, which the preview stage reads too, so zoom
 * stays in the editor and the ref comes down as a prop rather than the state
 * going up. */
/* VUI extraction boundary is machine-locked by
 * `content-vui-adapter.test.ts`: document writers, lane reorder, marquee,
 * beat-grid, typed lanes, selection rules, snapping, media drops, and
 * persistence remain Maleo-owned. This component injects those policies into
 * neutral VUI geometry/gesture primitives; package code never branches on them. */
import { Fragment, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import { useMediaDrop } from "@hooks/timeline/use-media-drop.ts";
import { fmtMMSS } from "@models/core/measures.ts";
import { laneGroupOf, type TimelineClip } from "@models/timeline/timeline-clips.ts";
import { TimelineBaseLane } from "./timeline-base-lane.tsx";
import { groupByLane } from "@models/timeline/render-derivations.ts";
import { rulerMarks } from "@models/timeline/ruler-ticks.ts";
import { useRulerWindow } from "@hooks/timeline/use-ruler-window.ts";
import { CONTENT_FPS } from "@models/timeline/content-document-adapter.ts";
import { type MediaDropInfo } from "@models/timeline/timeline-drops.ts";
import { useMarquee } from "@hooks/timeline/use-marquee.ts";
import { useCoarsePointer } from "@hooks/editor/use-coarse-pointer.ts";
import {
	gutterVisibleFor,
	pointerKind,
	storeGutterVisible,
} from "@models/timeline/gutter-visibility.ts";
import { useChromeField, useChromeSetter } from "@stores/editor-chrome-store.ts";
import { selectDerivedArrays, useDocumentSelector } from "@stores/timeline-document-store.ts";
import { timelineVisualSpans, validTransition } from "@maleo/shared";
import { useTimelineRows } from "@hooks/timeline/use-timeline-rows.ts";
import { countRender } from "@models/timeline/render-probe.ts";
import { usePlayheadSlider } from "@hooks/timeline/use-playhead-slider.ts";
import { LaneEnvProvider, TimelineLane, type LaneEnv } from "./timeline-lane.tsx";
import { TimelineToolbar } from "./timeline-toolbar.tsx";
import { ClipKeyframeGutter, ClipKeyframeLanes } from "./clip-keyframe-lanes.tsx";
import { TimelineGutter } from "./timeline-gutter.tsx";
import { TimelineHead } from "./timeline-head.tsx";
import { useGutterScrollSync } from "@hooks/timeline/use-gutter-scroll-sync.ts";
import { cssVars } from "@models/core/css-vars.ts";
import { contentTimeAtClientX, contentTimeToPixels } from "@models/timeline/content-vui-adapter.ts";
import { useContentVuiGestures } from "@hooks/timeline/use-content-vui-gestures.ts";
import type { TimelineTracksProps } from "./timeline-tracks-types.ts";
import { useLaneLookups, useTracksDrag } from "./timeline-tracks-drag.ts";

export type {
	TimelineTracksOps,
	TimelineTracksView,
	TimelineTracksProps,
} from "./timeline-tracks-types.ts";

/* A ruler drag shorter than this is a seek, not a range. Set well above the
 * clip drag threshold: marking a range is the rarer intent, so it should cost a
 * deliberate sweep rather than happening to every scrub that overshoots. */
const RANGE_MIN_PX = 24;
/* The answer for a lane with nothing on it. Module-scoped so an empty lane
 * hands the same array identity down every render — a fresh `[]` per empty lane
 * is exactly the allocation that stops a memo boundary holding. */
const EMPTY_LANE: TimelineClip[] = [];
/** The beat list while the beat grid is off, with one identity across renders. */
const NO_BEATS: readonly number[] = [];

export function TimelineTracks({
	store,
	chromeStore,
	trackFlags,
	trackRef,
	writers,
	selection,
	ops,
	view,
}: TimelineTracksProps): JSX.Element {
	/* The lane container. Playback must move the playhead without re-rendering
	 * it, so this tally is the one the playback requirement is judged on. */
	countRender("tracks");
	// Destructured to the names the markup already used, so the region reads the
	// same here as it did inside the editor.
	const {
		selectScene,
		clearSelection,
		toggleTrackFlag,
		trackLocked,
		ensureMediaAsset,
		sceneAt,
		seekPreview,
		setSelectedFreeIds,
		setFreeClipPos,
		sceneStart,
		setTrackFlags,
	} = ops;
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
		pacing,
		insightsOn,
		setInsightsOn,
		beatGridOn,
		timelineBeats,
		selectionSpansRef,
	} = view;

	/* Placing an asset is what admits it to the project. Every drop path calls
	 * this before it creates a clip and records the identity it answers with, so
	 * that "what this project uses" is derivable from the document rather than
	 * from whichever surface the operator happened to press save on. */
	const admitDrop = (m: MediaDropInfo): string =>
		ensureMediaAsset({
			id: m.mediaAssetId,
			label: m.label ?? "Media",
			url: m.url,
			kind: m.kind,
			audioKind: m.audioKind,
			thumb: m.thumb,
			dur: m.dur,
			source: m.source ?? "stock",
			...(m.referenceEntityId
				? { provenance: { copiedFromGlobalRefId: m.referenceEntityId } }
				: {}),
		});

	const derived = useDocumentSelector(store, selectDerivedArrays);
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [bookmarkEdit, setBookmarkEdit] = useState<string | null | undefined>(undefined);

	const { sceneById, presetOf, originalDurOf, mediaStartOf, transitionAt } =
		useLaneLookups(derived);

	/* The lane rows, as a stable list. `Array.from({length})` allocated a fresh
	 * array on every render for a value that is one number. */
	const laneRows = useMemo(() => Array.from({ length: freeRows }, (_, row) => row), [freeRows]);
	/* Which clip is being dragged or resized, as ids, and told only to the lane
	 * holding it.
	 *
	 * The drag state object changes identity on every pointer move, so passing it
	 * down re-renders everything; passing the id to every lane still re-rendered
	 * every lane twice per press, because arming and disarming the drag are both
	 * changes to that id. A lane that holds no part of the drag should hear
	 * neither. */
	const laneOfClip = useMemo(() => new Map(freeClips.map((c) => [c.id, c.track])), [freeClips]);

	const coarse = useCoarsePointer();
	const [timelineRange, setTimelineRange] = useChromeField(chromeStore, "timelineRange");

	const { clipDrag, snapLine, dropAltRef, projectedClips, sceneBoundaries } = useTracksDrag({
		store,
		chromeStore,
		trackFlags,
		trackRef,
		writers,
		ops,
		view,
		coarse,
		derived,
	});
	/* The clips as they should be DRAWN, which during a drag is not where the
	 * document has them.
	 *
	 * The edit is a transaction: nothing is written until the gesture commits, so
	 * the timeline draws the projection while it is open. The previous
	 * implementation had no projection and wrote on every pointer sample instead,
	 * which is why a drag produced a document change per frame for the writers to
	 * coalesce afterwards. */
	const displayClips = useMemo(
		() =>
			projectedClips.size === 0
				? freeClips
				: freeClips.map((clip) => {
						const projected = projectedClips.get(clip.id);
						return projected
							? {
									...clip,
									start: projected.startSec,
									dur: projected.durSec,
									track: projected.track,
								}
							: clip;
					}),
		[freeClips, projectedClips],
	);

	/* The base track as it should be DRAWN, on the same terms as the free lanes.
	 *
	 * A scene in flight is read from the kernel's projection rather than from a
	 * draft this component kept: the draft was a second copy of the edit, and the
	 * two disagreed the first time a render was skipped. The multi-image extras
	 * carry no projection because they are views of one clip, not clips. */
	const displayBaseClips = useMemo(
		() =>
			projectedClips.size === 0
				? baseClips
				: baseClips.map((clip) => {
						const projected = projectedClips.get(clip.id);
						return projected ? { ...clip, start: projected.startSec, dur: projected.durSec } : clip;
					}),
		[baseClips, projectedClips],
	);

	const clipsByLane = useMemo(() => groupByLane(displayClips), [displayClips]);
	const projectedSpans = timelineVisualSpans(doc).map((c) => {
		const projected = projectedClips.get(c.id);
		return projected
			? {
					...c,
					start: projected.startSec,
					dur: projected.durSec,
					track: c.track < 0 ? -1 : projected.track,
				}
			: c;
	});
	const pendingRemoval =
		projectedClips.size > 0 &&
		doc.clips.some((c) => c.transition && !validTransition(c.transition, projectedSpans));

	const { collidingIds, laneFor, moveFreeRow, organizeRange, organizeResult } = useTimelineRows({
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
	});
	const draggingId = clipDrag ? `${clipDrag.source}:${clipDrag.refId}` : null;
	/* The rows holding a selected clip, -1 for the scene row. Each lane is told
	 * a boolean, so only the lanes whose answer flips re-render. A scene counts
	 * when it is drawn selected, which is the base lane's own rule. */
	const rowsHoldingSelection = useMemo(() => {
		const rows = new Set<number>();
		for (const id of [...selectedFreeIds, ...(selectedFreeId ? [selectedFreeId] : [])]) {
			const row = laneOfClip.get(id);
			if (row !== undefined) rows.add(row);
		}
		if (!selectedFreeId && selectedSceneId != null) rows.add(-1);
		return rows;
	}, [selectedFreeIds, selectedFreeId, selectedSceneId, laneOfClip]);
	const resizingId = clipDrag?.mode === "resize" ? draggingId : null;
	const draggingRow = draggingId != null ? (laneOfClip.get(draggingId) ?? null) : null;

	/* Gutter visibility, and the lane header selection that arms reorder.
	 *
	 * Local rather than chrome: both are read only inside this region and the
	 * gutter it draws. The visibility DEFAULT and its persistence are the model's
	 * job — keyed on pointer type, stored per pointer type — so this only holds
	 * what the operator last chose in this session. */
	const pointer = pointerKind(coarse);
	const [gutterOn, setGutterOn] = useState<boolean>(() => gutterVisibleFor(pointer));
	const [selectedRow, setSelectedRow] = useState<number | null>(null);
	const toggleGutter = (): void =>
		setGutterOn((on) => {
			storeGutterVisible(pointer, !on);
			return !on;
		});
	const gutterRef = useRef<HTMLDivElement | null>(null);
	const gutterTailRef = useRef<HTMLDivElement | null>(null);
	useGutterScrollSync(gutterRef, trackRef, gutterTailRef, gutterOn);

	/* The ruler's marks, for the scrolled-to window only. */
	const rulerWindow = useRulerWindow(trackRef);
	const { ticks: timelineTicks, tickStepSec } = useMemo(
		() =>
			rulerMarks({
				startSec: rulerWindow.fromPx / pxPerSec,
				endSec: rulerWindow.toPx / pxPerSec,
				totalSec: total,
				pxPerSec,
				fps: CONTENT_FPS,
			}),
		[rulerWindow, pxPerSec, total],
	);
	const gridStepPx = Math.max(1, tickStepSec * pxPerSec);

	const [timelineDensity] = useChromeField(chromeStore, "timelineDensity");
	/* Opened from here, rendered elsewhere: the timeline writes these four and
	 * never reads them, so it takes setters without subscribing. Held as pairs
	 * and voided, they re-rendered this component whenever any other surface
	 * touched an edit popover. */
	const setEditTarget = useChromeSetter(chromeStore, "editTarget");
	const setTransitionEditId = useChromeSetter(chromeStore, "transitionEditId");
	const setEffectEdit = useChromeSetter(chromeStore, "effectEdit");
	const setInfographicEditId = useChromeSetter(chromeStore, "infographicEditId");

	// ── Per-gesture state. None of this is read outside this component, which is
	// what makes the region separable at all. ──
	// Time under the cursor comes from the LANES element (the time origin), not
	// the scroll container: the container's horizontal padding would otherwise
	// shift every click by that padding.
	const lanesRef = useRef<HTMLDivElement | null>(null);
	// Hover cursor line, moved by direct style writes — no state, so no re-render
	// per mouse move.
	const hoverheadRef = useRef<HTMLDivElement | null>(null);
	/* The playhead, moved the same way, and a keyboard slider. */
	const playheadSlider = usePlayheadSlider(playhead, pxPerSec, total, seekPreview);
	const moveHoverhead = (clientX: number): void => {
		const lanes = lanesRef.current;
		const head = hoverheadRef.current;
		if (!lanes || !head) return;
		const t = contentTimeAtClientX(clientX, lanes.getBoundingClientRect().left, pxPerSec, total);
		head.style.display = "";
		head.style.left = `${contentTimeToPixels(t, pxPerSec)}px`;
		head.setAttribute("data-time", fmtMMSS(t));
	};
	const hideHoverhead = (): void => {
		if (hoverheadRef.current) hoverheadRef.current.style.display = "none";
	};
	const { dropGhostRef, dropTime, onMediaDrop, moveDropGhost, hideDropGhost } = useMediaDrop({
		store,
		writers,
		ops,
		assets: ops.mediaAssets,
		freeRows,
		pxPerSec,
		total,
		playhead,
		sceneBoundaries,
		beatTimes: beatGridOn ? timelineBeats : [],
		freeClips,
		baseClips,
		lanesRef,
		admitDrop,
	});
	/** Viewport x → timeline seconds, clamped to the project. */
	const timeAt = (clientX: number): number => {
		const lanes = lanesRef.current;
		if (!lanes) return 0;
		return contentTimeAtClientX(clientX, lanes.getBoundingClientRect().left, pxPerSec, total);
	};
	// Scrub on empty timeline space. Moves the playhead, then clears the selection
	// only when the new playhead falls outside every selected clip's span.
	const scrubAndGuard = (clientX: number): void => {
		const lanes = lanesRef.current;
		if (!lanes) return;
		const t = contentTimeAtClientX(clientX, lanes.getBoundingClientRect().left, pxPerSec, total);
		seekPreview(t);
		if (!selectionSpansRef.current.some((s) => t >= s.start && t <= s.end)) clearSelection();
	};
	/* The ruler's scrub, and the range a coarse sweep marks. Scene manipulation
	 * is no longer here: the base track is on the surface with everything else,
	 * so `useContentVuiGestures` is down to the one gesture the ruler owns. */
	const { scrubDrag } = useContentVuiGestures({
		total,
		pxPerSec,
		coarse,
		playhead,
		timelineRange,
		setTimelineRange,
		seekPreview,
		timeAt,
		minimumRangePx: RANGE_MIN_PX,
	});
	// Marquee box-select owns its own rect state.
	const { marquee, startMarquee } = useMarquee({
		selectedFreeIds,
		setSelectedFreeIds,
		scrubTo: scrubAndGuard,
	});

	/* What the lanes CALL, as one object. Its identity is frozen by the provider
	 * so that no lane re-renders because a handler was rebuilt; the reads go
	 * through to the current closures at call time. */
	const laneEnv: LaneEnv = {
		store,
		chromeStore,
		ops,
		selection,
		playhead,
		admitDrop,
		startMarquee,
		laneFor,
		onMediaDrop,
		dropTime,
		setEditTarget,
		setEffectEdit,
		setInfographicEditId,
		setTransitionEditId,
	};

	/* The selected clip's keyframe markers (and expanded lanes) mount after the lane
	   that holds it, so its keys sit on its own bar rather than at the bottom. */
	const keyLanes = (row: number) => (
		<ClipKeyframeLanes
			store={store}
			selection={selection}
			chromeStore={chromeStore}
			writers={writers}
			total={total}
			pxPerSec={pxPerSec}
			coarse={coarse}
			onSeek={seekPreview}
			row={row}
		/>
	);
	return (
		<LaneEnvProvider env={laneEnv}>
			<div className={`tl2-timeline tl2-density-${timelineDensity}`}>
				{pendingRemoval && (
					<div className="tl2-animation-removal" role="status">
						Transition will be removed on drop
					</div>
				)}
				<TimelineToolbar
					store={store}
					chromeStore={chromeStore}
					ops={ops}
					view={view}
					gutterOn={gutterOn}
					toggleGutter={toggleGutter}
					organizeRange={organizeRange}
					organizeResult={organizeResult}
					openBookmarks={() => setBookmarkEdit(null)}
				/>
				{bookmarkEdit !== undefined && (
					<BookmarksDialog
						store={store}
						writers={writers}
						total={total}
						playhead={playhead.get()}
						initialId={bookmarkEdit}
						onClose={() => setBookmarkEdit(undefined)}
						onSeek={seekPreview}
					/>
				)}
				{/* Two columns: the gutter, and the one element that scrolls the lanes on
			    both axes. The gutter stays outside the horizontal scroll so time zero
			    sits at its right edge and no lane slides beneath it; its vertical
			    scroll is kept in step by `useGutterScrollSync`. */}
				<div className="tl2-tlmain">
					{gutterOn && (
						<TimelineGutter
							gutterRef={gutterRef}
							tailRef={gutterTailRef}
							rowsHoldingSelection={rowsHoldingSelection}
							freeRows={freeRows}
							trackFlags={trackFlags}
							toggleTrackFlag={toggleTrackFlag}
							moveFreeRow={moveFreeRow}
							showInsightSpacer={Boolean(insightsOn && pacing)}
							showMarkSpacer={doc.markers.length > 0}
							showBookmarkSpacer={Boolean(doc.bookmarks?.length)}
							coarse={coarse}
							selectedRow={selectedRow}
							onSelectRow={setSelectedRow}
							afterRow={(row) => (
								<ClipKeyframeGutter
									store={store}
									selection={selection}
									chromeStore={chromeStore}
									row={row}
								/>
							)}
						/>
					)}

					{/* One surface per gesture. On a coarse pointer the lane area is the
				    PAN surface and nothing else — scrubbing from it would make the
				    same horizontal drag mean two things depending on where it began,
				    which is the ambiguity this change exists to remove. The playhead
				    moves from the ruler, which is a surface a finger can aim at. */}
					<div
						ref={trackRef}
						data-vui-slot="timeline-scroller"
						className="tl2-tlscroll"
						onPointerDown={(e) => {
							if (!coarse && e.target === e.currentTarget) scrubAndGuard(e.clientX);
						}}
						onPointerMove={(e) => moveHoverhead(e.clientX)}
						onPointerLeave={hideHoverhead}
					>
						<div
							ref={lanesRef}
							data-vui-slot="rows"
							className="tl2-lanes"
							style={{
								width: Math.max(contentTimeToPixels(total, pxPerSec), 320),
								...cssVars({ "--tl2-grid-step": `${gridStepPx}px` }),
							}}
							onDragOver={moveDropGhost}
							onDragLeave={(e) => {
								if (
									!(e.relatedTarget instanceof Node) ||
									!e.currentTarget.contains(e.relatedTarget)
								)
									hideDropGhost();
							}}
							onDropCapture={hideDropGhost}
						>
							<TimelineHead
								ticks={timelineTicks}
								pxPerSec={pxPerSec}
								total={total}
								beats={beatGridOn ? timelineBeats : NO_BEATS}
								range={timelineRange}
								onClearRange={() => setTimelineRange(null)}
								onRulerPointerDown={(e) => {
									if (e.button === 0) scrubDrag(e);
								}}
								bookmarks={doc.bookmarks}
								onOpenBookmark={setBookmarkEdit}
								onSeek={seekPreview}
								pacing={insightsOn ? pacing : null}
								markers={doc.markers}
								selectedSceneId={selectedSceneId}
								onSelectScene={selectScene}
							/>

							{/* The base track: scenes are clips on the surface, drawn by the
						    region that owns them. */}
							<TimelineBaseLane
								ops={ops}
								view={view}
								trackFlags={trackFlags}
								displayBaseClips={displayBaseClips}
								clipDrag={clipDrag}
								sceneById={sceneById}
								coarse={coarse}
								holdsSelection={rowsHoldingSelection.has(-1)}
								onMediaDrop={onMediaDrop}
								scrubAndGuard={scrubAndGuard}
								setEditTarget={setEditTarget}
								setTransitionEditId={setTransitionEditId}
								chromeStore={chromeStore}
							/>
							{keyLanes(-1)}
							{/* Overlay layers — image/video/text/audio/effect, any can move between rows.
						    Each lane is its own memo boundary (see timeline-lane.tsx): the props
						    below are data, the handlers come from the env, and the selection is a
						    per-clip subscription — so a lane re-renders when ITS clips change and
						    not because something elsewhere in the editor did. */}
							{laneRows.map((row) => (
								<Fragment key={`lane${row}`}>
									<TimelineLane
										key={`lane${row}`}
										row={row}
										clips={clipsByLane.get(row) ?? EMPTY_LANE}
										group={laneGroupOf(trackFlags, row)}
										last={row === freeRows - 1}
										pxPerSec={pxPerSec}
										total={total}
										coarse={coarse}
										locked={trackLocked(row)}
										hidden={Boolean(trackFlags[row]?.hidden)}
										laneSelected={selectedRow === row}
										holdsSelection={rowsHoldingSelection.has(row)}
										dropping={Boolean(clipDrag?.moved && clipDrag.overTrack === row)}
										collidingIds={collidingIds}
										draggingId={draggingRow === row ? draggingId : null}
										resizingId={draggingRow === row ? resizingId : null}
										presetOf={presetOf}
										originalDurOf={originalDurOf}
										mediaStartOf={mediaStartOf}
										transitionAt={transitionAt}
									/>
									{keyLanes(row)}
								</Fragment>
							))}

							{/* The space below the last lane, so the lanes reach the bottom of
						    the panel and the playhead with them. Empty lane space in every
						    respect: a press scrubs, a sweep marquees. */}
							<div
								className="tl2-lanes-fill"
								onPointerDown={(e) => {
									if (!coarse && e.target === e.currentTarget && e.button === 0) startMarquee(e);
								}}
							/>
							{snapLine != null && (
								<div className="tl2-snapline" style={{ left: snapLine * pxPerSec }} />
							)}
							<div ref={hoverheadRef} className="tl2-hoverhead" style={{ display: "none" }} />
							{/* External-drag drop ghost (All Media → timeline). */}
							<div ref={dropGhostRef} className="tl2-dropghost" style={{ display: "none" }} />
							{marquee && (
								<div
									className="tl2-marquee"
									style={{
										position: "fixed",
										left: Math.min(marquee.x0, marquee.x1),
										top: Math.min(marquee.y0, marquee.y1),
										width: Math.abs(marquee.x1 - marquee.x0),
										height: Math.abs(marquee.y1 - marquee.y0),
									}}
								/>
							)}
							{/* Moved by a direct style write, like the hover cursor above it and
						    for the same reason its comment gives: this was a rendered `left`
						    offset driven by the player's frame events, so a second of
						    playback repainted every clip and every waveform thirty times to
						    move one element. `translateX` rather than `left` keeps it on the
						    compositor. */}
							<div
								ref={playheadSlider.ref}
								className="tl2-playhead"
								data-vui-slot="playhead"
								role="slider"
								tabIndex={0}
								aria-label="Playhead"
								aria-orientation="horizontal"
								aria-valuemin={0}
								aria-valuemax={Math.round(total * 100) / 100}
								aria-valuenow={Math.round(playhead.get() * 100) / 100}
								onKeyDown={playheadSlider.onKeyDown}
								onPointerDown={(e) => {
									if (e.button === 0) scrubDrag(e);
								}}
							>
								<span className="tl2-playhead-grip" />
							</div>
						</div>
					</div>
				</div>
			</div>
		</LaneEnvProvider>
	);
}
