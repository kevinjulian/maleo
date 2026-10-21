/* Time and pixels, owned here.
 *
 * These were four helpers imported from the library. They came back because
 * they are not the library's job: `@maleo/vui` resolves time in RATIONAL
 * ticks against a project timebase, and this file works in float seconds and
 * `pxPerSec` because that is what the editor's scroller, its ruler ticks and
 * its zoom control are expressed in. Importing float-second helpers from a
 * rational-time library was the seam admitting that mismatch rather than
 * stating it — four lines here say it plainly instead. */
const clampTime = (sec: number, durationSec: number): number =>
	Math.max(0, Math.min(Math.max(0, durationSec), Number.isFinite(sec) ? sec : 0));
const timeToPixels = (sec: number, pxPerSec: number): number => sec * Math.max(0, pxPerSec);
const pixelsToTime = (px: number, pxPerSec: number): number => px / Math.max(0.0001, pxPerSec);

/** Where a gesture is in its life. The editor's own vocabulary. */
export type ContentGesturePhase = "begin" | "update" | "commit" | "cancel";

/** What the content scroller currently shows, in seconds and pixels-per-second. */
export interface ContentViewport {
	startSec: number;
	endSec: number;
	pxPerSec: number;
	/** The time a focal zoom was anchored to, when one produced this viewport. */
	focalTimeSec?: number;
}

/**
 * Magnify about a fixed time, keeping that time where it is.
 *
 * The span is rescaled and the start re-anchored so the focal time stays at the
 * same fraction across the viewport. `focalTimeSec` is carried on the result
 * because the caller needs it to place the scroller, and recomputing it there
 * from the new scale would ask a slightly different question.
 */
function zoomAroundFocalTime(
	viewport: ContentViewport,
	factor: number,
	focalTimeSec: number,
	minPxPerSec: number,
	maxPxPerSec: number,
): ContentViewport {
	const pxPerSec = Math.max(
		minPxPerSec,
		Math.min(maxPxPerSec, viewport.pxPerSec * Math.max(0.01, factor)),
	);
	const focalRatio =
		viewport.endSec === viewport.startSec
			? 0.5
			: (focalTimeSec - viewport.startSec) / (viewport.endSec - viewport.startSec);
	const span = (viewport.endSec - viewport.startSec) * (viewport.pxPerSec / pxPerSec);
	const startSec = focalTimeSec - span * focalRatio;
	return { ...viewport, pxPerSec, startSec, endSec: startSec + span, focalTimeSec };
}

/**
 * Content timeline ownership left in Maleo.
 *
 * VUI may own neutral workspace, viewport geometry, ruler, range hit targets,
 * and gesture lifecycle. These boundaries remain domain-owned because they
 * read/write Maleo's document, policy, lane taxonomy, or persistence contract.
 */
export const CONTENT_TIMELINE_DOMAIN_OWNERS = [
	"document-writers",
	"lane-gutter",
	"lane-actions",
	"lane-reorder",
	"marquee-selection",
	"beat-grid",
	"typed-lanes",
	"selection-rules",
	"snapping-policy",
	"media-drops",
	"persistence",
] as const;

export type ContentTimelineDomainOwner = (typeof CONTENT_TIMELINE_DOMAIN_OWNERS)[number];

export function contentTimeAtClientX(
	clientX: number,
	timelineLeft: number,
	pxPerSec: number,
	durationSec: number,
): number {
	return clampTime(pixelsToTime(clientX - timelineLeft, pxPerSec), durationSec);
}

export function contentTimeToPixels(sec: number, pxPerSec: number): number {
	return timeToPixels(sec, pxPerSec);
}

export function contentViewportFromScroller(input: {
	scrollLeft: number;
	clientWidth: number;
	gutterWidth: number;
	pxPerSec: number;
}): ContentViewport {
	const visiblePx = Math.max(1, input.clientWidth - input.gutterWidth);
	const startSec = pixelsToTime(Math.max(0, input.scrollLeft - input.gutterWidth), input.pxPerSec);
	return {
		startSec,
		endSec: startSec + pixelsToTime(visiblePx, input.pxPerSec),
		pxPerSec: input.pxPerSec,
	};
}

/** What the content scroller must apply to land a focal zoom without drift. */
export interface ContentZoomCommand {
	pxPerSec: number;
	scrollLeft: number;
	viewport: ContentViewport;
}

export function contentZoomCommand(input: {
	scrollLeft: number;
	clientWidth: number;
	gutterWidth: number;
	pxPerSec: number;
	factor: number;
	focalClientPx: number;
	minPxPerSec: number;
	maxPxPerSec: number;
}): ContentZoomCommand {
	const viewport = contentViewportFromScroller(input);
	const focalTimeSec = pixelsToTime(
		input.focalClientPx + input.scrollLeft - input.gutterWidth,
		input.pxPerSec,
	);
	const next = zoomAroundFocalTime(
		viewport,
		input.factor,
		focalTimeSec,
		input.minPxPerSec,
		input.maxPxPerSec,
	);
	return {
		pxPerSec: next.pxPerSec,
		scrollLeft: Math.max(
			0,
			input.gutterWidth + timeToPixels(focalTimeSec, next.pxPerSec) - input.focalClientPx,
		),
		viewport: next,
	};
}

export interface ContentTimelineRange {
	start: number;
	end: number;
}

export type ContentScrubDecision = {
	seekSec: number;
	range: ContentTimelineRange | null | undefined;
};

/** Maps neutral VUI gesture phases to Maleo's coarse-pointer range policy. */
export function contentScrubDecision(input: {
	phase: ContentGesturePhase;
	initialPlayheadSec: number;
	anchorTimeSec: number;
	currentTimeSec: number;
	distancePx: number;
	coarse: boolean;
	previousRange: ContentTimelineRange | null;
	minimumRangePx?: number;
}): ContentScrubDecision {
	if (input.phase === "cancel")
		return { seekSec: input.initialPlayheadSec, range: input.previousRange };
	const crossedThreshold = input.distancePx >= (input.minimumRangePx ?? 24);
	if (!input.coarse) return { seekSec: input.currentTimeSec, range: undefined };
	if (!crossedThreshold)
		return { seekSec: input.currentTimeSec, range: input.phase === "commit" ? null : undefined };
	return {
		seekSec: input.currentTimeSec,
		range: {
			start: Math.min(input.anchorTimeSec, input.currentTimeSec),
			end: Math.max(input.anchorTimeSec, input.currentTimeSec),
		},
	};
}

/** Every range kind the content timeline puts on a lane. `scene` is the base
 *  track; the rest are the free-clip families that share a row. */
export type ContentRangeKind =
	| "scene"
	| "video"
	| "text"
	| "audio"
	| "infographic"
	| "effect"
	| "caption";
