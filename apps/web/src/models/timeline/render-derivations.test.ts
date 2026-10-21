/* 17.2 — the linear-work requirement, asserted rather than reviewed.
 *
 * These count TOUCHES, not milliseconds. An elapsed-time ceiling cannot tell a
 * quadratic derivation from a slow machine, and a suite that used one would be
 * measuring the CI runner. Counting how many times the source array is read
 * says exactly what the requirement says.
 */
import { describe, expect, test } from "vite-plus/test";
import { groupByLane, indexById } from "./render-derivations.ts";

/** An array and a tally of the index reads made through it. */
interface CountedArray<T> {
	readonly array: T[];
	reads(): number;
}

/**
 * An array that records every index read through it.
 *
 * A proxy rather than a wrapper, because the derivations under test take a
 * plain array and must keep taking one — a bespoke reader would measure the
 * test's own indirection instead of theirs.
 */
function counted<T>(items: T[]): CountedArray<T> {
	let reads = 0;
	const array = new Proxy(items, {
		get(target, property) {
			if (typeof property !== "string" || !/^\d+$/.test(property)) {
				/* Everything that is not an index — `length`, `Symbol.iterator`, the
				 * array methods — is forwarded untouched and uncounted. */
				return target[property as keyof T[]];
			}
			reads += 1;
			return target[Number(property)];
		},
	});
	return { array, reads: () => reads };
}

const clips = (count: number, lanes: number): { id: number; track: number }[] =>
	Array.from({ length: count }, (_unused, index) => ({ id: index, track: index % lanes }));

describe("lane membership is one pass over the clips", () => {
	test("grouping reads each clip exactly once, whatever the lane count", () => {
		/* The same clips over four lanes and over forty. A pass PER LANE would
		 * multiply the reads by the lane count; one pass does not move at all. */
		for (const lanes of [4, 40]) {
			const source = counted(clips(500, lanes));
			const grouped = groupByLane(source.array);
			expect(source.reads(), `${lanes} lanes cost more than one pass`).toBe(500);
			expect([...grouped.values()].reduce((total, lane) => total + lane.length, 0)).toBe(500);
			expect(grouped.size).toBe(lanes);
		}
	});

	test("every clip lands in its own lane, in document order", () => {
		const grouped = groupByLane([
			{ id: 1, track: 0 },
			{ id: 2, track: 1 },
			{ id: 3, track: 0 },
		]);
		expect(grouped.get(0)!.map((clip) => clip.id)).toEqual([1, 3]);
		expect(grouped.get(1)!.map((clip) => clip.id)).toEqual([2]);
		/* A lane nothing occupies is absent rather than empty, so a caller cannot
		 * mistake "no clips here" for "no such lane". */
		expect(grouped.has(2)).toBe(false);
	});
});

describe("a backing record is retrieved by key", () => {
	test("indexing reads each record once, and every lookup afterwards reads none", () => {
		const source = counted(clips(500, 4));
		const index = indexById(source.array);
		const afterBuild = source.reads();
		expect(afterBuild).toBe(500);

		/* Five hundred lookups — one per clip drawn — cost no further reads of the
		 * source array. A `.find()` at the draw site would cost up to 500 each. */
		for (let id = 0; id < 500; id += 1) expect(index.get(id)!.id).toBe(id);
		expect(source.reads()).toBe(afterBuild);
	});

	test("a missing record is absent rather than the first one", () => {
		expect(indexById([{ id: 7 }]).get(9)).toBeUndefined();
	});
});
