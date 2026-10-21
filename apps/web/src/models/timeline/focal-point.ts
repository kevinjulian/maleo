/* The point a scene's camera zooms toward, in percent of the frame.
 *
 * Picked by clicking the frame, or by arrow keys from where it is now — the
 * keyboard path the picker would otherwise lack. */

export interface FocalPoint {
	xPct: number;
	yPct: number;
}

/** How far one arrow press moves the point, in percent of the frame. */
export const FOCAL_STEP_PCT = 5;

const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

/** The point under a click inside the picker's box. */
export function focalPointAt(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number; width: number; height: number },
): FocalPoint {
	return {
		xPct: clampPct(((clientX - rect.left) / rect.width) * 100),
		yPct: clampPct(((clientY - rect.top) / rect.height) * 100),
	};
}

/** The point after an arrow key, starting from the centre when none is set;
 *  null for any other key, which is not a focal edit. */
export function nudgeFocalPoint(
	point: FocalPoint | null | undefined,
	key: string,
): FocalPoint | null {
	const from = point ?? { xPct: 50, yPct: 50 };
	switch (key) {
		case "ArrowLeft":
			return { ...from, xPct: clampPct(from.xPct - FOCAL_STEP_PCT) };
		case "ArrowRight":
			return { ...from, xPct: clampPct(from.xPct + FOCAL_STEP_PCT) };
		case "ArrowUp":
			return { ...from, yPct: clampPct(from.yPct - FOCAL_STEP_PCT) };
		case "ArrowDown":
			return { ...from, yPct: clampPct(from.yPct + FOCAL_STEP_PCT) };
		default:
			return null;
	}
}
