import { expect, test } from "vite-plus/test";
import { compositionLayerTiming } from "./composition-timing.ts";

test("late layers retain original span and rendered-frame rounding", () => {
	for (const fps of [24, 30, 60])
		for (const frames of [1, 31, 120, 251]) {
			const layer = { relStart: 4.1, dur: 2.03 },
				spanSec = 10;
			const scale = frames / fps / spanSec;
			expect(compositionLayerTiming(layer, spanSec, frames, fps)).toEqual({
				from: Math.floor(4.1 * scale * fps),
				durationInFrames: Math.max(1, Math.floor(2.03 * scale * fps)),
			});
		}
	expect(compositionLayerTiming({ relStart: 4, dur: 2 }, 10, 120, 30)).toEqual({
		from: 48,
		durationInFrames: 24,
	});
	expect(compositionLayerTiming({ relStart: 0, dur: 0.001 }, 10, 120, 30).durationInFrames).toBe(1);
});

test("invalid timing fails instead of producing NaN frames", () => {
	for (const spanSec of [0, -1, NaN, Infinity])
		expect(() => compositionLayerTiming({ relStart: 0, dur: 1 }, spanSec, 30, 30)).toThrow(
			RangeError,
		);
});
