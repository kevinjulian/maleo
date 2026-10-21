/* The template editor's timeline region: the lane gutter, the seeking ruler,
 * the playhead and one bar per preview range. The modal owns the playhead and
 * the gesture kernel; this draws what they report. */
import type { JSX, RefObject } from "react";
import type { TemplateLane } from "@models/timeline/template-document-adapter.ts";
import { TEMPLATE_PREVIEW_FPS } from "@models/timeline/template-document-adapter.ts";
import type { rulerMarks } from "@models/timeline/ruler-ticks.ts";
import { TemplateRangeBar, TemplateTimelineViewport } from "./template-timeline.tsx";

export function TemplateEditorTimeline({
	lanes,
	gutterRef,
	gutterTailRef,
	attachScroller,
	timelineWidthPx,
	startSec,
	endSec,
	templatePxPerSec,
	previewDurationSec,
	playheadSec,
	seek,
	ticks,
	gesturingRangeId,
	selectRange,
	updateRangeDuration,
}: {
	lanes: TemplateLane[];
	gutterRef: RefObject<HTMLDivElement | null>;
	gutterTailRef: RefObject<HTMLDivElement | null>;
	attachScroller: (node: HTMLDivElement | null) => void;
	timelineWidthPx: number;
	startSec: number;
	endSec: number;
	templatePxPerSec: number;
	previewDurationSec: number;
	playheadSec: number;
	seek: (sec: number) => void;
	ticks: ReturnType<typeof rulerMarks>["ticks"];
	gesturingRangeId: string | null;
	selectRange: (rangeId: string) => void;
	updateRangeDuration: (rangeId: string, edge: "start" | "end", sec: number) => void;
}): JSX.Element {
	return (
		<div
			className="vui-timeline-grid tl2-tlmain tl2-template-timeline"
			data-vui-slot="timeline-grid"
		>
			<div ref={gutterRef} className="vui-timeline-gutter tl2-gutter" data-vui-slot="gutter">
				<div className="tl2-gutter-body">
					<div className="tl2-stick tl2-gutter-head tl2-gutter-spacer" />
					{lanes.map((lane) => (
						<div key={lane.id} className="tl2-gutter-row" data-vui-slot="gutter-row">
							<span className="vui-gutter-label">{lane.label}</span>
						</div>
					))}
				</div>
				<div ref={gutterTailRef} className="tl2-gutter-tail" />
			</div>
			<TemplateTimelineViewport
				scrollerRef={attachScroller}
				widthPx={timelineWidthPx}
				startSec={startSec}
				endSec={endSec}
				pxPerSec={templatePxPerSec}
			>
				{/* The ruler seeks. It is a real control rather than a painted
						    strip: a person has to be able to reach the playhead without
						    a pointer. */}
				<div className="tl2-stick tl2-head">
					<div
						className="vui-ruler tl2-ruler"
						data-vui-slot="ruler"
						role="slider"
						tabIndex={0}
						aria-label="Timeline playhead"
						aria-valuemin={0}
						aria-valuemax={previewDurationSec}
						/* Unrounded, because it is the value a screen reader reads out
							   and the only place the frame the playhead is on is visible. */
						aria-valuenow={Math.min(previewDurationSec, playheadSec)}
						style={{ width: `${timelineWidthPx}px` }}
						onPointerDown={(event) => {
							const rect = event.currentTarget.getBoundingClientRect();
							seek(
								Math.max(
									0,
									Math.min(previewDurationSec, (event.clientX - rect.left) / templatePxPerSec),
								),
							);
						}}
						onKeyDown={(event) => {
							if (event.key === "Home" || event.key === "End") {
								event.preventDefault();
								seek(event.key === "Home" ? 0 : previewDurationSec);
								return;
							}
							const direction = event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0;
							if (direction === 0) return;
							event.preventDefault();
							seek(
								Math.max(
									0,
									Math.min(
										previewDurationSec,
										playheadSec + (direction * (event.shiftKey ? 10 : 1)) / TEMPLATE_PREVIEW_FPS,
									),
								),
							);
						}}
					>
						{ticks.map((tick) => (
							<div
								key={`${tick.t}-${tick.major}`}
								className={`tl2-tick${tick.major ? " major" : ""}${tick.t === 0 ? " origin" : ""}`}
								style={{ left: `${tick.t * templatePxPerSec}px` }}
							>
								{tick.label && <em>{tick.label}</em>}
							</div>
						))}
					</div>
				</div>
				<div
					className="vui-playhead tl2-playhead"
					data-vui-slot="playhead"
					style={{
						left: `${Math.min(previewDurationSec, playheadSec) * templatePxPerSec}px`,
					}}
				/>
				{lanes.map((lane) => (
					<div
						key={lane.id}
						className="vui-lane tl2-lane"
						data-vui-slot="row"
						data-vui-row={lane.id}
					>
						{lane.ranges.map((range) => (
							<TemplateRangeBar
								key={range.id}
								range={range}
								durationSec={previewDurationSec}
								pxPerSec={templatePxPerSec}
								gesturing={gesturingRangeId === range.id}
								onSelect={selectRange}
								onResize={updateRangeDuration}
							/>
						))}
					</div>
				))}
			</TemplateTimelineViewport>
		</div>
	);
}
