/* Maleo — where a scene sits on the timeline, and which scene covers a time.
 *
 * A scene's start is its explicit `start` once it has been moved, else its
 * sequential position by order. That lets scenes be moved and gapped independently
 * clips while an untouched run still lays itself out end to end.
 *
 * Both are memoized on `scenes` because they are read inside render and inside a
 * playhead subscription; a fresh identity each render would defeat every memo
 * boundary downstream. */
import { useCallback } from "react";
import type { Scene } from "@maleo/shared";

export interface SceneTiming {
	/** Timeline start of a scene, in seconds. */
	sceneStart: (id: number) => number;
	/** The scene covering `t`, or undefined in a gap — callers render blank. */
	sceneAt: (t: number) => Scene | undefined;
}

export function useSceneTiming(scenes: Scene[]): SceneTiming {
	const sceneStart = useCallback(
		(id: number): number => {
			let acc = 0;
			for (const s of scenes) {
				if (s.id === id) return s.start ?? acc;
				acc += Math.max(1, s.dur);
			}
			return 0;
		},
		[scenes],
	);

	const sceneAt = useCallback(
		(t: number): Scene | undefined => {
			// With explicit positions, prefer the topmost track / latest start.
			let best: Scene | undefined;
			let bestStart = -1;
			let acc = 0;
			for (const s of scenes) {
				const start = s.start ?? acc;
				acc += Math.max(1, s.dur);
				if (
					t >= start &&
					t < start + Math.max(1, s.dur) &&
					(start >= bestStart || (s.track ?? 0) > (best?.track ?? 0))
				) {
					best = s;
					bestStart = start;
				}
			}
			return best;
		},
		[scenes],
	);

	return { sceneStart, sceneAt };
}
