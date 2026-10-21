/* Motion Studio's timeline region: the gutter, the seeking ruler, the playhead
 * and one row per layer or per nested property track.
 *
 * Split out of `motion-studio-modal.tsx`. The modal owns the layers, the mark
 * and the gesture surface (`useMotionTimeline`); this draws them. Rows are
 * hit-tested by identity on that surface, so nothing here owns a pointer
 * except the ruler's seek and the track's double-click to add a key. */
import type { JSX, RefObject } from "react";
import type { CompositionLayer } from "@maleo/shared";
import {
	MotionTimelineViewport,
	type MotionTimelineRow,
	type useMotionTimeline,
} from "@components/timeline/motion/motion-timeline.tsx";
import { motionMarkerId, motionRowId } from "@models/timeline/motion-document-adapter.ts";
import {
	MOTION_PREVIEW_FPS,
	motionLayerIdFromRow,
	motionTrackMarkers,
	parseMotionTrackRow,
	type MotionMarkSelection,
	type MotionStudioTrack,
} from "@models/timeline/motion-vui-adapter.ts";
import { rulerMarks } from "@models/timeline/ruler-ticks.ts";
import { layerLabel } from "./motion-keyframes.ts";
import { TrackCurve } from "./motion-curve.tsx";

interface MotionStudioTimelineProps {
	rows: MotionTimelineRow[];
	layers: CompositionLayer[];
	selectedId: number | null;
	mark: MotionMarkSelection | null;
	durationSec: number;
	playheadSec: number;
	pxPerSec: number;
	projection: ReturnType<typeof useMotionTimeline>["projection"];
	gutterRef: RefObject<HTMLDivElement | null>;
	gutterTailRef: RefObject<HTMLDivElement | null>;
	attachScroller: (node: HTMLDivElement | null) => void;
	seek: (sec: number) => void;
	removeLayer: (id: number) => void;
	addMark: (layerId: number, track: MotionStudioTrack, t: number) => void;
	moveKeyframeTo: (
		layer: CompositionLayer,
		track: MotionStudioTrack,
		index: number,
		timelineSec: number,
	) => void;
}

export function MotionStudioTimeline({
	rows: motionRows,
	layers,
	selectedId,
	mark,
	durationSec,
	playheadSec,
	pxPerSec: motionPxPerSec,
	projection: projected,
	gutterRef,
	gutterTailRef,
	attachScroller,
	seek,
	removeLayer,
	addMark,
	moveKeyframeTo,
}: MotionStudioTimelineProps): JSX.Element {
	return (
		<div
			className="vui-timeline-grid tl2-tlmain tl2-motion-timeline"
			data-vui-lane-count={motionRows.length}
			data-vui-slot="timeline-grid"
		>
			{/* The gutter: labels and per-row actions, drawn here because only
			    the studio knows what a row IS — a layer, or one of its nested
			    property tracks. */}
			<div ref={gutterRef} className="vui-timeline-gutter tl2-gutter" data-vui-slot="gutter">
				<div className="tl2-gutter-body">
					<div className="tl2-stick tl2-gutter-head tl2-gutter-spacer" />
					{motionRows.map((row) => (
						<div key={row.id} className="tl2-gutter-row" data-vui-slot="gutter-row">
							<span className="vui-gutter-label">{row.label}</span>
							{row.id.startsWith("layer-") && !row.depth ? (
								<button
									type="button"
									className="tl2-motion-preset-del"
									title="Delete layer"
									aria-label={`Delete ${row.label}`}
									onClick={() => removeLayer(Number(row.id.slice("layer-".length)))}
								>
									×
								</button>
							) : null}
						</div>
					))}
				</div>
				<div ref={gutterTailRef} className="tl2-gutter-tail" />
			</div>
			<MotionTimelineViewport
				scrollerRef={attachScroller}
				widthPx={Math.max(320, durationSec * motionPxPerSec)}
			>
				{/* The ruler seeks. It is a real control rather than a painted
				    strip: a person has to be able to reach the playhead without a
				    pointer. */}
				<div className="tl2-stick tl2-head">
					<div
						className="vui-ruler tl2-ruler"
						data-vui-slot="ruler"
						role="slider"
						tabIndex={0}
						aria-label="Motion timeline"
						aria-valuemin={0}
						aria-valuemax={Math.round(durationSec * 100) / 100}
						aria-valuenow={Math.round(playheadSec * 100) / 100}
						style={{ width: `${Math.max(320, durationSec * motionPxPerSec)}px` }}
						onPointerDown={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							seek(
								Math.max(0, Math.min(durationSec, (event.clientX - rect.left) / motionPxPerSec)),
							);
						}}
						onKeyDown={(event) => {
							const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
							if (direction === 0) return;
							event.preventDefault();
							seek(
								Math.max(0, Math.min(durationSec, playheadSec + direction / MOTION_PREVIEW_FPS)),
							);
						}}
					>
						{rulerMarks({
							startSec: 0,
							endSec: durationSec,
							totalSec: durationSec,
							pxPerSec: motionPxPerSec,
							fps: MOTION_PREVIEW_FPS,
						}).ticks.map((tick) => (
							<div
								key={`${tick.t}-${tick.major}`}
								className={`tl2-tick${tick.major ? " major" : ""}${tick.t === 0 ? " origin" : ""}`}
								style={{ left: `${tick.t * motionPxPerSec}px` }}
							>
								{tick.label && <em>{tick.label}</em>}
							</div>
						))}
					</div>
				</div>
				<div
					className="vui-playhead tl2-playhead"
					data-vui-slot="playhead"
					style={{ left: `${playheadSec * motionPxPerSec}px` }}
				/>
				{motionRows.map((row) => {
					const layerId = motionLayerIdFromRow(row.id);
					const layer = layerId === null ? undefined : layers.find((item) => item.id === layerId);
					const track = parseMotionTrackRow(row.id);
					if (!layer) return <div key={row.id} className="vui-timeline-row tl2-lane" />;
					const layerStart =
						projected?.kind === "layer" && projected.id === motionRowId(layer.id)
							? projected.timelineSec
							: layer.start;
					if (!track) {
						return (
							<div key={row.id} className="vui-timeline-row tl2-lane" data-vui-slot="row">
								<button
									type="button"
									/* What the surface hit-tests. The bar owns no pointer. */
									data-motion-layer={motionRowId(layer.id)}
									data-vui-slot="item"
									role="option"
									aria-selected={layer.id === selectedId}
									aria-label={`${layerLabel(layer)}, starts at ${layerStart.toFixed(2)} seconds`}
									className={`vui-range tl2-clip tl2-clip-compact tl2-studio-bar${layer.id === selectedId ? " on is-sel" : ""}`}
									style={{
										left: `${layerStart * motionPxPerSec}px`,
										width: `${Math.max(2, layer.dur * motionPxPerSec)}px`,
									}}
								>
									<span className="tl2-clip-body">
										<b>{layerLabel(layer)}</b>
									</span>
								</button>
							</div>
						);
					}
					return (
						<div key={row.id} className="vui-timeline-row tl2-lane" data-vui-slot="row">
							<div
								className="vui-range tl2-studio-subclip"
								data-vui-slot="track"
								style={{
									left: `${layerStart * motionPxPerSec}px`,
									width: `${Math.max(2, layer.dur * motionPxPerSec)}px`,
								}}
								onDoubleClick={(event) => {
									event.stopPropagation();
									const rect = event.currentTarget.getBoundingClientRect();
									addMark(
										layer.id,
										track,
										layer.dur > 0 ? (event.clientX - rect.left) / rect.width : 0,
									);
								}}
							>
								<TrackCurve track={track} anim={layer.anim} />
								{motionTrackMarkers(layer, track, mark).map((marker, index) => {
									const markerId = motionMarkerId(layer.id, track, index);
									const at =
										projected?.kind === "keyframe" && projected.id === markerId
											? projected.timelineSec
											: layer.start + marker.timeSec;
									return (
										<button
											key={marker.id}
											type="button"
											/* Hit-tested by identity: a keyframe survives its row
											   re-rendering around it mid-drag. */
											data-motion-marker={markerId}
											data-vui-slot="marker"
											className="tl2-keypoint"
											aria-label={`${marker.label} at ${at.toFixed(2)} seconds`}
											aria-pressed={marker.selected}
											style={{ left: `${(at - layer.start) * motionPxPerSec}px` }}
											onKeyDown={(event) => {
												const direction =
													event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
												if (direction === 0) return;
												event.preventDefault();
												moveKeyframeTo(layer, track, index, at + direction / MOTION_PREVIEW_FPS);
											}}
										>
											<span aria-hidden="true">◆</span>
										</button>
									);
								})}
							</div>
						</div>
					);
				})}
			</MotionTimelineViewport>
		</div>
	);
}
