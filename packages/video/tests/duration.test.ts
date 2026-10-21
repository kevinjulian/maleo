import { describe, expect, test } from "vite-plus/test";
import { storyboardSeconds } from "../src/lib/duration";

describe("storyboardSeconds", () => {
	test("packed mode: sums sequential scene durations", () => {
		expect(storyboardSeconds({ scenes: [{ durationSec: 2 }, { durationSec: 3 }] })).toBe(5);
	});

	test("explicit starts: honors gaps (end = last scene end past the gap)", () => {
		// scene A [0-2], gap [2-4], scene B [4-6] -> total 6
		const total = storyboardSeconds({
			scenes: [
				{ durationSec: 2, startSec: 0 },
				{ durationSec: 2, startSec: 4 },
			],
		});
		expect(total).toBe(6);
	});

	test("explicit starts: scenes without start pack at the running cursor", () => {
		// A packed [0-3], B moved to 8 [8-10] -> total 10
		expect(
			storyboardSeconds({ scenes: [{ durationSec: 3 }, { durationSec: 2, startSec: 8 }] }),
		).toBe(10);
	});

	test("trailing text overlay extends total past the last scene", () => {
		// scenes end at 4, overlay [7-10] -> total 10
		const total = storyboardSeconds({
			scenes: [
				{ durationSec: 2, startSec: 0 },
				{ durationSec: 2, startSec: 2 },
			],
			textOverlays: [{ startSec: 7, durationSec: 3 }],
		});
		expect(total).toBe(10);
	});

	test("visualTimeline clip extends total past its beat", () => {
		// beat ends at 4, but a decoupled visual runs 3-8 -> total 8
		expect(
			storyboardSeconds({
				scenes: [{ durationSec: 4 }],
				visualTimeline: [{ startSec: 3, durationSec: 5 }],
			}),
		).toBe(8);
	});

	test("trailing audio + video overlays counted", () => {
		const total = storyboardSeconds({
			scenes: [{ durationSec: 4 }],
			audioOverlays: [{ startSec: 5, durationSec: 1 }],
			videoOverlays: [{ startSec: 2, durationSec: 9 }],
		});
		expect(total).toBe(11);
	});
});
