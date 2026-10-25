/* Two touch pointers on the canvas as a pinch and a twist (`p2-preview-editing` D7).
 *
 * Input handling, not geometry: the helper reports how far apart the two
 * fingers are relative to when the second one landed (`scale`) and how far the
 * line between them has turned (`angle`, degrees, continuous past ±180). The
 * engine scales and rotates the selection from those. It reads only the
 * pointers it was given. */

interface Point {
	x: number;
	y: number;
}

export interface TwoPointerSample {
	scale: number;
	angle: number;
}

export interface TwoPointer {
	/** A pointer landed; true when it is the second, so a pinch begins. */
	down(id: number, at: Point): boolean;
	/** A pointer moved; the sample while two are down, else null. */
	move(id: number, at: Point): TwoPointerSample | null;
	/** A pointer lifted or was cancelled; true when that ended a pinch. */
	up(id: number): boolean;
	/** Two pointers are down. */
	pinching(): boolean;
}

const distance = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);
const heading = (a: Point, b: Point): number => (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;

export function createTwoPointer(): TwoPointer {
	const points = new Map<number, Point>();
	let start: { distance: number; heading: number } | null = null;
	let angle = 0;
	let last = 0;
	const pair = (): [Point, Point] | null => {
		const [a, b] = [...points.values()];
		return a && b ? [a, b] : null;
	};
	return {
		down(id, at) {
			if (points.size >= 2) return false;
			points.set(id, at);
			const both = pair();
			if (!both) return false;
			start = { distance: distance(...both) || 1, heading: heading(...both) };
			angle = 0;
			last = start.heading;
			return true;
		},
		move(id, at) {
			if (!points.has(id)) return null;
			points.set(id, at);
			const both = pair();
			if (!both || !start) return null;
			const now = heading(...both);
			// Unwrap: the smallest turn since the last sample, so a twist past ±180 keeps counting.
			const step = ((((now - last + 180) % 360) + 360) % 360) - 180;
			angle += step;
			last = now;
			return { scale: distance(...both) / start.distance, angle };
		},
		up(id) {
			const was = points.size === 2;
			points.delete(id);
			if (was) start = null;
			return was;
		},
		pinching: () => points.size === 2 && start !== null,
	};
}
