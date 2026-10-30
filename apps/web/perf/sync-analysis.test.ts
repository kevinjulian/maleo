import { expect, test } from "vite-plus/test";
import { analyzeSync, percentile } from "./sync-analysis.ts";

test("offsets and settling follow audible clicks against drawn marker frames", () => {
	// 2x from timeline 10 s at epoch 1000: frame f is drawn at 1000 + (f - 300) / 60 s, 80 ms settle.
	const draws = Array.from({ length: 120 }, (_, index) => ({
		frame: 300 + index,
		at: 1080 + (index * 1000) / 60,
	}));
	// Markers every 0.5 s of timeline = every 250 ms of wall time; audio 30 ms late.
	const clicks = [0.5, 1, 1.5].map((sec) => 1080 + sec * 500 + 30);
	const [result] = analyzeSync({
		draws,
		clicks,
		onsets: [1050],
		segments: [{ label: "2x", command: 1000, end: 3000, rate: 2, target: 10 }],
		fps: 30,
		clickIntervalSec: 0.5,
	});
	expect(result?.settleMs).toBeCloseTo(80);
	expect(result?.offsetsMs).toHaveLength(3);
	for (const offset of result!.offsetsMs) expect(offset).toBeCloseTo(30, 0);
});

test("no settling without a drawn target frame", () => {
	const [result] = analyzeSync({
		draws: [{ frame: 0, at: 1100 }],
		clicks: [1200],
		onsets: [1050],
		segments: [{ label: "seek", command: 1000, end: 2000, rate: 1, target: 300 }],
		fps: 30,
		clickIntervalSec: 0.5,
	});
	expect(result?.settleMs).toBeNull();
	expect(percentile([3, 1, 2, 10], 0.95)).toBe(10);
});
