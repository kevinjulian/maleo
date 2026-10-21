import { describe, expect, it } from "vite-plus/test";
import {
	MIN_LABEL_SPACING_PX,
	MIN_TICK_SPACING_PX,
	rulerMarks,
	rulerTicks,
} from "./ruler-ticks.ts";

describe("rulerTicks — adaptive density", () => {
	it("labels every second at high zoom", () => {
		const ticks = rulerTicks(10, 120);
		const majors = ticks.filter((t) => t.major);
		expect(majors.map((t) => t.t)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		expect(majors[1]!.label).toBe("0:01");
	});

	it("spreads labels out at low zoom so they never overlap", () => {
		const ticks = rulerTicks(600, 4); // 10 min at minimum zoom
		const majors = ticks.filter((t) => t.major);
		// Label step must give each label >= 72px: 72/4 = 18s → next nice step 30s.
		expect(majors.map((t) => t.t)).toEqual([
			0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330, 360, 390, 420, 450, 480, 510, 540, 570,
			600,
		]);
	});

	it("keeps the DOM small on long timelines", () => {
		const ticks = rulerTicks(600, 4);
		// Minor step 10s at 4px/s (>= 24px) → ~61 ticks, not 600.
		expect(ticks.length).toBeLessThan(100);
	});

	it("emits sub-second ticks only when there is room", () => {
		expect(rulerTicks(4, 240).some((t) => t.t === 0.5)).toBe(true);
		expect(rulerTicks(4, 24).some((t) => t.t === 0.5)).toBe(false);
	});

	it("degrades to a single origin tick on an empty timeline", () => {
		expect(rulerTicks(0, 80)).toEqual([{ t: 0, major: true, label: "0:00" }]);
	});

	it("formats labels mm:ss", () => {
		const ticks = rulerTicks(120, 24);
		const at60 = ticks.find((t) => t.t === 60);
		expect(at60?.label).toBe("1:00");
	});
});

describe("rulerMarks — frame-aware, windowed", () => {
	const at = (options: Partial<Parameters<typeof rulerMarks>[0]> = {}) =>
		rulerMarks({ startSec: 0, endSec: 10, totalSec: 10, pxPerSec: 36, fps: 30, ...options });

	it("labels whole seconds as M:SS and puts 0:00 at the origin", () => {
		const { ticks } = at();
		expect(ticks[0]).toEqual({ t: 0, major: true, label: "0:00" });
		expect(ticks.filter((tick) => tick.major).every((tick) => /^\d+:\d\d$/.test(tick.label!))).toBe(
			true,
		);
	});

	it("descends to frame labels when zoomed in", () => {
		const { ticks } = at({ endSec: 2, totalSec: 2, pxPerSec: 240 });
		const labels = ticks.filter((tick) => tick.major).map((tick) => tick.label);
		expect(labels).toContain("15f");
		expect(labels).toContain("0:01");
		// Ticks go finer than labels.
		expect(ticks.length).toBeGreaterThan(labels.length);
	});

	it("puts every label on a tick time", () => {
		for (const pxPerSec of [4, 9, 36, 80, 150, 240]) {
			const { ticks, tickStepSec, labelStepSec } = at({ endSec: 60, totalSec: 60, pxPerSec });
			const ratio = labelStepSec / tickStepSec;
			expect(Math.abs(ratio - Math.round(ratio))).toBeLessThan(1e-6);
			for (const tick of ticks)
				expect(Math.abs(tick.t / tickStepSec - Math.round(tick.t / tickStepSec))).toBeLessThan(
					1e-6,
				);
		}
	});

	it("keeps labels a readable distance apart", () => {
		for (const pxPerSec of [4, 9, 36, 80, 150, 240]) {
			const { labelStepSec } = at({ endSec: 600, totalSec: 600, pxPerSec });
			expect(labelStepSec * pxPerSec).toBeGreaterThanOrEqual(MIN_LABEL_SPACING_PX);
		}
	});

	it("creates marks for the window only, not the whole project", () => {
		const windowPx = 1400;
		const { ticks } = rulerMarks({
			startSec: 300,
			endSec: 300 + windowPx / 240,
			totalSec: 600,
			pxPerSec: 240,
			fps: 30,
		});
		expect(ticks.length).toBeLessThanOrEqual(windowPx / MIN_TICK_SPACING_PX + 2);
		expect(ticks[0]!.t).toBeGreaterThanOrEqual(300 - 1);
	});

	it("never marks past the project, nor before zero", () => {
		const { ticks } = rulerMarks({ startSec: -5, endSec: 50, totalSec: 3, pxPerSec: 36, fps: 30 });
		expect(ticks[0]!.t).toBe(0);
		expect(ticks.at(-1)!.t).toBeLessThanOrEqual(3);
	});
});
