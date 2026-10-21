/* The timeline's sticky head: the ruler with its beat marks and marked range,
 * then the bookmark band, the pacing insights strip and the story-beat markers.
 *
 * Split out of `timeline-tracks.tsx` by ownership: everything here is drawn
 * from values handed in, and the gutter mirrors exactly these bands with its own
 * spacers, so they are one region to read. */
import type { JSX, PointerEvent as ReactPointerEvent } from "react";
import type { Bookmark } from "@maleo/shared";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { fmtMMSS } from "@models/core/measures.ts";
import type { RulerTick } from "@models/timeline/ruler-ticks.ts";
import type { usePacingInsights } from "@hooks/timeline/use-pacing-insights.ts";
import { InsightsCanvas } from "./insights-canvas.tsx";
import { BookmarkRuler } from "./timeline-bookmarks.tsx";

type Pacing = ReturnType<typeof usePacingInsights>["pacing"];

export interface TimelineMarker {
	id: number;
	title: string;
	startSec: number;
	endSec: number;
}

export interface TimelineHeadProps {
	ticks: readonly RulerTick[];
	pxPerSec: number;
	total: number;
	/** Music onsets drawn in the ruler; empty while the beat grid is off. */
	beats: readonly number[];
	/** The span a ruler drag marked out, or null. */
	range: { start: number; end: number } | null;
	onClearRange: () => void;
	onRulerPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
	bookmarks: readonly Bookmark[] | undefined;
	onOpenBookmark: (id: string) => void;
	onSeek: (sec: number) => void;
	/** Null while the insights strip is off. */
	pacing: Pacing | null;
	markers: readonly TimelineMarker[];
	selectedSceneId?: number;
	onSelectScene: (sceneId: number) => void;
}

export function TimelineHead({
	ticks,
	pxPerSec,
	total,
	beats,
	range,
	onClearRange,
	onRulerPointerDown,
	bookmarks,
	onOpenBookmark,
	onSeek,
	pacing,
	markers,
	selectedSceneId,
	onSelectScene,
}: TimelineHeadProps): JSX.Element {
	return (
		<div className="tl2-stick tl2-head">
			<div className="tl2-ruler" data-vui-slot="ruler" onPointerDown={onRulerPointerDown}>
				{ticks.map((tick) => (
					<span
						key={tick.t}
						className={`tl2-tick ${tick.major ? "major" : ""} ${tick.t === 0 ? "origin" : ""}`}
						style={{ left: tick.t * pxPerSec }}
					>
						{tick.label != null && <em>{tick.label}</em>}
					</span>
				))}
				{beats.map((b, i) => (
					<span key={`bt${i}`} className="tl2-beat" style={{ left: b * pxPerSec }} />
				))}
				{/* The marked range, drawn where it was marked. Without this the
				    operator has a selection they cannot see, which is the failure
				    the contextual bar exists to avoid for clips. The clear control
				    is explicit for the same reason deselect is: "tap to dismiss"
				    on a surface whose taps also seek is not a dismissal. */}
				{range && (
					<span
						className="tl2-rulerrange"
						style={{
							left: range.start * pxPerSec,
							width: Math.max((range.end - range.start) * pxPerSec, 2),
						}}
					>
						<em>{fmtMMSS(range.end - range.start)}</em>
						<button
							type="button"
							className="tl2-rulerrange-x"
							aria-label="Clear timeline range"
							onPointerDown={(e) => e.stopPropagation()}
							onClick={(e) => {
								e.stopPropagation();
								onClearRange();
							}}
						>
							{Ic.x(ICON.xs)}
						</button>
					</span>
				)}
			</div>

			{Boolean(bookmarks?.length) && (
				<BookmarkRuler
					bookmarks={[...bookmarks!]}
					total={total}
					pxPerSec={pxPerSec}
					onOpen={onOpenBookmark}
					onSeek={onSeek}
				/>
			)}

			{/* Pacing insights strip: retention heatmap background, density bars,
			    lint badges (click = seek to the finding). */}
			{pacing && (
				<div className="tl2-insights" aria-label="Pacing insights">
					<InsightsCanvas
						retention={pacing.retention}
						density={pacing.density}
						pxPerSec={pxPerSec}
					/>
					{pacing.findings.map((f, i) => (
						<button
							key={`lf${i}`}
							className={`tl2-lint ${f.severity}`}
							style={{
								left: f.startSec * pxPerSec,
								width: Math.max(10, (f.endSec - f.startSec) * pxPerSec),
							}}
							title={`${fmtMMSS(f.startSec)}–${fmtMMSS(f.endSec)} · ${f.message}`}
							onClick={() => onSeek(f.startSec)}
						/>
					))}
				</div>
			)}

			{/* Story-beat markers — thin annotation band, NOT clip containers. Clicking
			    a beat selects/scrubs to it; it never resizes the clips it groups. */}
			{markers.length > 0 && (
				<div className="tl2-markband">
					{markers.map((m) => (
						<button
							key={`mk${m.id}`}
							className={`tl2-mark ${selectedSceneId === m.id ? "on" : ""}`}
							style={{
								left: m.startSec * pxPerSec,
								width: Math.max((m.endSec - m.startSec) * pxPerSec - 2, 8),
							}}
							title={`${m.title} · ${fmtMMSS(m.startSec)}–${fmtMMSS(m.endSec)}`}
							onClick={() => onSelectScene(m.id)}
						>
							<span className="tl2-mark-label">{m.title}</span>
						</button>
					))}
				</div>
			)}
		</div>
	);
}
