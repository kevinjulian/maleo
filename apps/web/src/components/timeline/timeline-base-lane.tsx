/* The base track: the row that carries the render.
 *
 * Split out of `timeline-tracks.tsx` because it owns something nothing else
 * does — the scene run, the transition edges between touching clips, and the
 * gaps that would render as black — and drawing all of it inside the region
 * that owns the viewport made one file answerable for two unrelated pieces of
 * state.
 *
 * A scene is an ordinary clip here. It sits on `@maleo/vui`'s surface with
 * every other lane, hit-tested by `data-clipid`, so this component owns no
 * pointer and decides nothing about a gesture. What it still owns is what a
 * scene MEANS: the multi-image beat that draws one element per visual, the
 * transition between two clips that touch, and the gap that does not.
 */
import { Fragment, type DragEvent, type JSX } from "react";
import { touchingBoundary } from "@maleo/shared";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";
import { ClipRange, clipCapabilities } from "@components/timeline/clip-range.tsx";
import { clipGeom as clipGeomOf } from "./timeline-lane.tsx";
import { Shimmer } from "@design-system/components/shimmer.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { MEDIA_DND_MIME } from "@models/timeline/editor-media.ts";
import type { BaseTrackClip } from "@models/timeline/timeline-clips.ts";
import type { ContentDragView } from "@hooks/timeline/use-content-timeline.ts";
import type { Scene, TrackFlags } from "@maleo/shared";
import type { TimelineTracksOps, TimelineTracksView } from "./timeline-tracks.tsx";

export interface TimelineBaseLaneProps {
	chromeStore: EditorChromeStore;
	readonly ops: TimelineTracksOps;
	readonly view: TimelineTracksView;
	readonly trackFlags: TrackFlags;
	/** The run as it should be DRAWN, which during a drag is the projection. */
	readonly displayBaseClips: BaseTrackClip[];
	/** The gesture in flight, for the class a moving scene wears. */
	readonly clipDrag: ContentDragView | null;
	readonly sceneById: Map<number, Scene>;
	readonly coarse: boolean;
	/** A scene on this track is selected. */
	readonly holdsSelection: boolean;
	/** Placing an asset is what admits it to the project. */
	onMediaDrop(e: DragEvent, row: number): boolean;
	/** Scrub on empty lane space, then drop a selection the playhead left behind. */
	scrubAndGuard(clientX: number): void;
	setEditTarget(target: { type: "scene"; id: number }): void;
	setTransitionEditId(id: number): void;
}

export function TimelineBaseLane({
	chromeStore,
	ops,
	view,
	trackFlags,
	displayBaseClips,
	clipDrag,
	sceneById,
	coarse,
	holdsSelection,
	onMediaDrop,
	scrubAndGuard,
	setEditTarget,
}: TimelineBaseLaneProps): JSX.Element {
	const {
		selectScene,
		openAddMenu,
		openSceneMenu,
		trackLocked,
		removeVisualClip,
		extendVisualClipDur,
		upd,
		transAt,
		setFreeClipPos,
	} = ops;
	const {
		pxPerSec,
		baseClips,
		selectedFreeId,
		selectedSceneId,
		selectedTransition,
		editorSceneId,
	} = view;
	const clipGeom = (clip: { start: number; dur: number }): ReturnType<typeof clipGeomOf> =>
		clipGeomOf(clip, pxPerSec, coarse);

	return (
		<div
			/* The one lane that keeps the taller metric: it carries the render. */
			data-lane-base=""
			data-vui-slot="row"
			data-vui-row="scene"
			className={`tl2-lane tl2-lane-free ${holdsSelection ? "holds" : ""} ${trackLocked(-1) ? "locked" : ""}`}
			onPointerDown={(e) => {
				if (!coarse && e.target === e.currentTarget) scrubAndGuard(e.clientX);
			}}
			onContextMenu={(e) => openAddMenu(e, -1)}
			onDragOver={(e) => {
				if (e.dataTransfer.types.includes(MEDIA_DND_MIME)) e.preventDefault();
			}}
			onDrop={(e) => {
				onMediaDrop(e, -1);
			}}
		>
			{displayBaseClips.length === 0 && <div className="tl2-lane-empty">Drop media here</div>}
			{displayBaseClips.map((c) => {
				const selected = !selectedFreeId && selectedSceneId === c.sceneId;
				// Single-image beat → the full scene clip (drag/resize/select/edit).
				if (c.vclipId == null) {
					const geom = clipGeomOf(c, pxPerSec, coarse);
					return (
						<ClipRange
							key={c.id}
							/* The base track speaks the same clip vocabulary as every
								   other lane now. A scene carries no free-clip `source`,
								   which is why this element asks only for a span and a name. */
							clip={{ id: c.id, label: c.label, start: c.start, dur: c.dur }}
							selected={selected}
							/* A scene's head is the previous scene's tail — the row is
								   magnetic — so it is rolled rather than trimmed and has no
								   start handle. `clipCapabilities` says so for `scene`. */
							capabilities={clipCapabilities({
								kind: "scene",
								locked: trackLocked(-1),
								touchUnselected: coarse && !selected,
								tooNarrowToTrim: geom.narrow,
							})}
							className={`tl2-clip tl2-clip-video tl2-clip-compact ${selected ? "on" : ""} ${editorSceneId === c.sceneId ? "editing" : ""} ${c.gen ? "gen" : ""} ${trackLocked(-1) ? "locked" : ""} ${trackFlags[-1]?.hidden ? "hidden" : ""} ${clipDrag?.source === "scene" && clipDrag.refId === c.sceneId ? "dragging" : ""} ${geom.cls}`}
							style={geom.style}
							onDragOver={(e) => {
								if (e.dataTransfer.types.includes(MEDIA_DND_MIME)) e.preventDefault();
							}}
							nudge={(patch) => {
								if (trackLocked(-1)) return;
								setFreeClipPos("scene", c.sceneId, patch);
							}}
							onSelect={() => selectScene(c.sceneId)}
							onContextMenu={(e) => openSceneMenu(e, c.sceneId)}
							onDoubleClick={() => {
								if (trackLocked(-1)) return;
								setEditTarget({ type: "scene", id: c.sceneId });
							}}
							title={`${c.label} · drop an image to add a second visual · double-click to edit`}
							body={
								c.thumb ? (
									<span className="tl2-clip-strip" style={{ backgroundImage: `url(${c.thumb})` }}>
										{c.gen && <Shimmer />}
									</span>
								) : (
									<span className="tl2-clip-strip empty">
										{c.gen ? <Shimmer /> : Ic.image(ICON.sm)}
									</span>
								)
							}
						/>
					);
				}
				// One of several visual clips in a beat (multi-image). Click selects the
				// beat; the × removes this image and re-distributes the rest. Option
				// semantics and Enter/Space match `ClipRange`, which the other clips use.
				const selectBeatImage = (): void => {
					selectScene(c.sceneId);
					if (c.vclipId)
						chromeStore.patch("clipKeyVisual", { sceneId: c.sceneId, visualId: c.vclipId });
				};
				return (
					<Fragment key={c.id}>
						<div
							data-clipid={c.id}
							className={`tl2-clip tl2-clip-video tl2-clip-compact ${selected ? "on" : ""} ${c.gen ? "gen" : ""} ${trackLocked(-1) ? "locked" : ""} ${trackFlags[-1]?.hidden ? "hidden" : ""} ${clipGeom(c).cls}`}
							style={clipGeom(c).style}
							onDragOver={(e) => {
								if (e.dataTransfer.types.includes(MEDIA_DND_MIME)) e.preventDefault();
							}}
							role="option"
							aria-selected={selected}
							aria-label={`${c.label}, image in beat, starts at ${c.start.toFixed(2)} seconds`}
							tabIndex={selected ? 0 : -1}
							onClick={selectBeatImage}
							onKeyDown={(e) => {
								if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
								e.preventDefault();
								selectBeatImage();
							}}
							onContextMenu={(e) => openSceneMenu(e, c.sceneId)}
							onDoubleClick={() => {
								if (trackLocked(-1)) return;
								setEditTarget({ type: "scene", id: c.sceneId });
							}}
							title={`${c.label} · image in beat`}
						>
							{c.thumb ? (
								<span className="tl2-clip-strip" style={{ backgroundImage: `url(${c.thumb})` }}>
									{c.gen && <Shimmer />}
								</span>
							) : (
								<span className="tl2-clip-strip empty">
									{c.gen ? <Shimmer /> : Ic.image(ICON.sm)}
								</span>
							)}
							<button
								className="tl2-clip-del"
								title="Remove image from beat"
								onPointerDown={(e) => e.stopPropagation()}
								onClick={(e) => {
									e.stopPropagation();
									if (trackLocked(-1)) return;
									removeVisualClip(c.sceneId, c.vclipId!);
								}}
							>
								{Ic.x(ICON.xs)}
							</button>
						</div>
					</Fragment>
				);
			})}
			{/* Transition edges between adjacent (touching) base-track visual clips —
				    across beats AND within a beat (image A -> image B). Both render:
				    beat-level via the scene reel, intra-beat via the visual's entrance. */}
			{displayBaseClips.map((c, i) => {
				const nx = displayBaseClips[i + 1];
				if (!nx || !touchingBoundary({ ...c, track: -1 }, { ...nx, track: -1 })) return null;
				if (coarse && Math.min(c.dur, nx.dur) * pxPerSec < 88) return null;
				const tr = transAt(c.id, nx.id);
				const t = tr && tr.type !== "cut" ? tr.type : null;
				return (
					<button
						disabled={trackLocked(-1)}
						key={`sedge-${c.id}-${nx.id}`}
						className={`tl2-trans ${t ? "set" : ""} ${tr && selectedTransition === tr.id ? "on" : ""}`}
						style={{ left: nx.start * pxPerSec }}
						aria-label={`Transition · ${c.label} → ${nx.label}`}
						title={t ? `Transition: ${t} — click to edit` : "Add transition"}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={(e) => {
							e.stopPropagation();
							chromeStore.patch("animationInspector", { fromClipId: c.id, toClipId: nx.id });
						}}
					>
						{t ? (
							<span className="tl2-trans-pill">{t}</span>
						) : (
							<span className="tl2-trans-ic">{Ic.layers(ICON.xs)}</span>
						)}
					</button>
				);
			})}
			{/* Gaps: when a scene has an explicit start that leaves empty space
				    after the previous clip, the render shows black there. Make it
				    visible + clickable to close (extends the previous scene to fill). */}
			{baseClips.map((c, i) => {
				const nx = baseClips[i + 1];
				if (!nx) return null;
				const gapStart = c.start + c.dur;
				const gapDur = nx.start - gapStart;
				if (gapDur <= 0.05) return null;
				// Close by extending the LEFT clip. If the left clip lives in a
				// multi-image beat, grow that visual's durationSec; otherwise
				// grow the scene's duration. Never grow scene.dur for a beat clip.
				const leftScene = sceneById.get(c.sceneId);
				const inBeat = (leftScene?.visualClips?.length ?? 0) > 1;
				const closeGap = () => {
					if (inBeat) extendVisualClipDur(c.sceneId, c.vclipId, gapDur);
					else upd(c.sceneId, "dur", Math.round((c.dur + gapDur) * 10) / 10);
				};
				return (
					<button
						key={`gap-${c.id}-${nx.id}`}
						className="tl2-gap"
						style={{ left: gapStart * pxPerSec, width: Math.max(gapDur * pxPerSec, 4) }}
						title={`Gap ${gapDur.toFixed(1)}s (renders black) — click to close by extending "${c.label}"`}
						onClick={(e) => {
							e.stopPropagation();
							closeGap();
						}}
					>
						<span className="tl2-gap-label">{gapDur.toFixed(1)}s gap</span>
					</button>
				);
			})}
		</div>
	);
}
