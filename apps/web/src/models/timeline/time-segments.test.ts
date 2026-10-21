import { describe, expect, test } from "vite-plus/test";
import { boundaryTimes, segmentIndexAt } from "./time-segments.ts";

describe("time segments", () => {
	test("zero is always a boundary", () => {
		expect(boundaryTimes([])).toEqual([0]);
		expect(boundaryTimes([{ start: 2, end: 4 }])).toEqual([0, 2, 4]);
	});

	test("boundaries are sorted and de-duplicated", () => {
		const spans = [
			{ start: 4, end: 6 },
			{ start: 1, end: 4 },
			{ start: 1, end: 2 },
		];
		expect(boundaryTimes(spans)).toEqual([0, 1, 2, 4, 6]);
	});

	test("a time inside a segment keeps the same index", () => {
		const b = boundaryTimes([{ start: 2, end: 5 }]);
		expect(segmentIndexAt(b, 2)).toBe(segmentIndexAt(b, 4.999));
		expect(segmentIndexAt(b, 1.9)).not.toBe(segmentIndexAt(b, 2));
	});

	test("crossing a boundary changes the index", () => {
		const b = boundaryTimes([
			{ start: 1, end: 2 },
			{ start: 3, end: 4 },
		]);
		const seen = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5].map((t) => segmentIndexAt(b, t));
		expect(seen).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
	});

	test("a boundary belongs to the segment it opens", () => {
		const b = boundaryTimes([{ start: 2, end: 5 }]);
		// The clip is live from exactly 2, so 2 must not read as the segment before it.
		expect(segmentIndexAt(b, 2)).toBeGreaterThan(segmentIndexAt(b, 1.999));
	});

	test("a time past everything is the last segment", () => {
		const b = boundaryTimes([{ start: 1, end: 2 }]);
		expect(segmentIndexAt(b, 1000)).toBe(b.length);
	});

	test("non-finite spans are ignored rather than poisoning the list", () => {
		expect(boundaryTimes([{ start: Number.NaN, end: 3 }])).toEqual([0, 3]);
	});
});
