/* Adaptive timeline-ruler ticks: pick tick density from the zoom level so
 * labels never overlap at low zoom and the DOM stays small on long timelines.
 * Pure — unit-testable without the editor. */

export interface RulerTick {
	/** Tick time in seconds. */
	t: number;
	/** Major ticks are taller and carry the time label. */
	major: boolean;
	label?: string;
}

// Candidate tick intervals in seconds, in "nice" increments.
const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300] as const;
// A minor tick needs at least this many px; a labelled tick needs more room.
const MIN_TICK_PX = 24;
const MIN_LABEL_PX = 72;

const fmt = (sec: number): string => {
	const m = Math.floor(sec / 60);
	const s = Math.floor(sec % 60);
	return `${m}:${String(s).padStart(2, "0")}`;
};

const pickStep = (pxPerSec: number, minPx: number): number =>
	STEPS.find((s) => s * pxPerSec >= minPx) ?? STEPS[STEPS.length - 1]!;

/** Tick positions for a ruler of `totalSec` seconds at `pxPerSec` zoom. Major
 *  (labelled) ticks land on multiples of the label step; minor ticks fill in
 *  between at the minor step. */
export function rulerTicks(totalSec: number, pxPerSec: number): RulerTick[] {
	if (totalSec <= 0 || pxPerSec <= 0) return [{ t: 0, major: true, label: fmt(0) }];
	const minor = pickStep(pxPerSec, MIN_TICK_PX);
	const labelStep = Math.max(minor, pickStep(pxPerSec, MIN_LABEL_PX));
	const ticks: RulerTick[] = [];
	const eps = 1e-6;
	for (let t = 0; t <= totalSec + eps; t += minor) {
		const time = Math.round(t * 1000) / 1000;
		const major = Math.abs(time / labelStep - Math.round(time / labelStep)) < eps;
		ticks.push(major ? { t: time, major, label: fmt(time) } : { t: time, major });
	}
	return ticks;
}

/* ── Frame-aware, windowed marks for the main timeline ──
 *
 * Ported from OpenCut's ruler: labels and ticks pick their intervals
 * independently, each the smallest "nice" step that keeps its minimum spacing,
 * first in frames and then in seconds, and the tick step is then forced to
 * divide the label step so every label lands on a tick. Zoomed in far enough,
 * both descend to frames, which `rulerTicks` above cannot express (its finest
 * step is half a second).
 *
 * Only the window asked for is marked: a ten-minute project at full zoom is
 * tens of thousands of ticks, and the ruler only ever shows a viewport of them. */

/** Label steps in frames. Starts at 2 so a tick always sits between labels. */
const LABEL_FRAME_STEPS = [2, 3, 5, 10, 15] as const;
/** Tick steps in frames, down to one. */
const TICK_FRAME_STEPS = [1, 2, 3, 5, 10, 15] as const;
/** Steps in seconds, for zoom levels past frame detail. */
const SECOND_STEPS = [1, 2, 3, 5, 10, 15, 30, 60, 120, 300, 600] as const;
/** Labels need room to read; ticks can be much denser. */
export const MIN_LABEL_SPACING_PX = 90;
export const MIN_TICK_SPACING_PX = 18;
/** Floating-point slack when deciding whether a time is a multiple of a step. */
const EPS = 1e-6;

export interface RulerMarksOptions {
	/** The visible window, in seconds; clamped to [0, totalSec]. */
	startSec: number;
	endSec: number;
	totalSec: number;
	pxPerSec: number;
	fps: number;
}

export interface RulerMarks {
	ticks: RulerTick[];
	tickStepSec: number;
	labelStepSec: number;
}

function smallestStep(
	pxPerSec: number,
	fps: number,
	minPx: number,
	frameSteps: readonly number[],
): number {
	const pxPerFrame = pxPerSec / fps;
	const frames = frameSteps.find((step) => step * pxPerFrame >= minPx);
	if (frames !== undefined) return frames / fps;
	return (
		SECOND_STEPS.find((step) => step * pxPerSec >= minPx) ?? SECOND_STEPS[SECOND_STEPS.length - 1]!
	);
}

const isMultiple = (value: number, step: number): boolean =>
	Math.abs(value / step - Math.round(value / step)) < EPS;

/** The finest tick step that divides the label step and keeps tick spacing. */
function tickStepDividing(labelStep: number, pxPerSec: number, fps: number): number {
	const candidates = [...TICK_FRAME_STEPS.map((frames) => frames / fps), ...SECOND_STEPS];
	return (
		candidates.find(
			(step) =>
				step <= labelStep && step * pxPerSec >= MIN_TICK_SPACING_PX && isMultiple(labelStep, step),
		) ?? labelStep
	);
}

/** `M:SS` on a whole second, `Nf` between seconds. */
function markLabel(sec: number, fps: number): string {
	const frame = Math.round((sec - Math.floor(sec + EPS)) * fps);
	return frame === 0 ? fmt(Math.round(sec)) : `${frame}f`;
}

export function rulerMarks({
	startSec,
	endSec,
	totalSec,
	pxPerSec,
	fps,
}: RulerMarksOptions): RulerMarks {
	if (totalSec <= 0 || pxPerSec <= 0 || fps <= 0)
		return { ticks: [{ t: 0, major: true, label: fmt(0) }], tickStepSec: 1, labelStepSec: 1 };
	const labelStepSec = smallestStep(pxPerSec, fps, MIN_LABEL_SPACING_PX, LABEL_FRAME_STEPS);
	const tickStepSec = tickStepDividing(labelStepSec, pxPerSec, fps);
	const first = Math.max(0, Math.floor(Math.max(0, startSec) / tickStepSec));
	const last = Math.floor((Math.min(totalSec, endSec) + EPS) / tickStepSec);
	const ticks: RulerTick[] = [];
	for (let index = first; index <= last; index += 1) {
		const t = index * tickStepSec;
		ticks.push(
			isMultiple(t, labelStepSec)
				? { t, major: true, label: markLabel(t, fps) }
				: { t, major: false },
		);
	}
	return { ticks, tickStepSec, labelStepSec };
}
