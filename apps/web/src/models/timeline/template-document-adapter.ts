/* The template editor's preview timeline, spoken to `@maleo/vui`.
 *
 * A timeline template is not a document with clips in it. It is a set of
 * numbers — a title duration, a lead-in, a gap, a maximum beat — and the
 * timeline the editor draws is a MOCK built from them, so an author can see
 * what the numbers mean before any video exists. That is why nothing here reads
 * or writes a template: it turns the mock into the library's model, and the
 * panel turns a committed trim back into the one number that produced the edge.
 *
 * The lane shape below is the editor's own, declared here rather than imported
 * from the library. A preview lane is a template concept — "Max VO segment" is
 * not a track — and a consumer type that lived in the library would be a
 * consumer schema the library had to keep working.
 */
import { RENDER_FPS } from "@maleo/shared";
import { framesToProject, projectTime } from "@models/timeline-view/tick.ts";
import { rational } from "@models/timeline-view/rational.ts";
import { timebase, type Timebase } from "@models/timeline-view/timebase.ts";
import { type TimelineItem, type TimelineState } from "@models/timeline-view/types.ts";

/** The preview's rate. One rate, so an edge lands on a frame. */
export const TEMPLATE_PREVIEW_FPS = RENDER_FPS;
export const TEMPLATE_TIMEBASE: Timebase = timebase(rational(TEMPLATE_PREVIEW_FPS, 1));

/** How a preview range reads. Colour only; the library never interprets it. */
export type TemplateRangeTone = "section" | "hold" | "scene" | "voice" | "audio" | "data";

/** One bar on the preview timeline, and the setting its edges stand for. */
export interface TemplateRange {
	readonly id: string;
	readonly laneId: string;
	readonly label: string;
	readonly startSec: number;
	readonly durationSec: number;
	readonly tone: TemplateRangeTone;
	/** Which edges this range's setting can actually be changed from. */
	readonly resizeStart?: boolean;
	readonly resizeEnd?: boolean;
	readonly selected?: boolean;
}

/** One row of the preview timeline. */
export interface TemplateLane {
	readonly id: string;
	readonly label: string;
	readonly ranges: readonly TemplateRange[];
}

function secondsToTicks(seconds: number): number {
	return framesToProject(Math.round(seconds * TEMPLATE_PREVIEW_FPS), TEMPLATE_TIMEBASE).ticks;
}

export function templateTicksToSeconds(ticks: number): number {
	return ticks / (TEMPLATE_TIMEBASE.ticksPerFrame * TEMPLATE_PREVIEW_FPS);
}

/** Where a range's dragged edge currently sits, in preview seconds. */
export function templateEdgeSeconds(range: TemplateRange, edge: "start" | "end"): number {
	return edge === "start" ? range.startSec : range.startSec + Math.max(0, range.durationSec);
}

/** The preview lanes as the library's model. */
export function templateStateOf(
	lanes: readonly TemplateLane[],
	durationSec: number,
	pxPerSec: number,
): TimelineState {
	const items: TimelineItem[] = lanes.flatMap((lane) =>
		lane.ranges.map((range) => ({
			id: range.id,
			rowId: lane.id,
			/* The tone, because it is the only thing about a preview range that is
			 * not time, and the library treats a kind as opaque. */
			kind: range.tone,
			label: range.label,
			start: projectTime(secondsToTicks(range.startSec)),
			duration: projectTime(secondsToTicks(Math.max(0, range.durationSec))),
			/* A range whose setting has no draggable edge is read-only rather than
			 * absent: it is still worth selecting, because selecting it is what opens
			 * the inspector section that owns the number behind it. */
			locked: range.resizeStart !== true && range.resizeEnd !== true,
		})),
	);
	return {
		timebase: TEMPLATE_TIMEBASE,
		duration: projectTime(secondsToTicks(durationSec)),
		/* Free and overlapping. The lanes are separate readings of the same
		 * settings — a title over a section, a breath inside a scene — so two bars
		 * at the same time is the ordinary case rather than a collision. */
		rows: lanes.map((lane) => ({
			id: lane.id,
			placement: "free" as const,
			overlap: "permit" as const,
		})),
		items: new Map(items.map((item) => [item.id, item])),
		order: items.map((item) => item.id),
		markers: [],
		selection: new Set(
			lanes.flatMap((lane) =>
				lane.ranges.filter((range) => range.selected).map((range) => range.id),
			),
		),
		viewport: {
			start: projectTime(0),
			scale: pxPerSec / (TEMPLATE_PREVIEW_FPS * TEMPLATE_TIMEBASE.ticksPerFrame),
			widthPx: Math.max(1, durationSec * pxPerSec),
			end: projectTime(secondsToTicks(durationSec)),
		},
		gestures: new Map(),
	};
}
