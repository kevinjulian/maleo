import { describe, it, expect } from "vite-plus/test";
import { mapWithConcurrency } from "./concurrency.ts";

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe("mapWithConcurrency", () => {
	it("returns results in input order regardless of completion order", async () => {
		// Later items resolve first, so an order-preserving impl must still line up.
		const out = await mapWithConcurrency([30, 10, 20], 3, async (ms, i) => {
			await tick(ms);
			return `${i}:${ms}`;
		});
		expect(out).toEqual(["0:30", "1:10", "2:20"]);
	});

	it("never exceeds the concurrency limit in flight", async () => {
		let inFlight = 0;
		let peak = 0;
		await mapWithConcurrency(
			Array.from({ length: 10 }, (_, i) => i),
			3,
			async () => {
				inFlight++;
				peak = Math.max(peak, inFlight);
				await tick(5);
				inFlight--;
			},
		);
		expect(peak).toBe(3);
	});

	it("processes strictly one at a time when limit is 1", async () => {
		let inFlight = 0;
		let peak = 0;
		await mapWithConcurrency([1, 2, 3], 1, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await tick(1);
			inFlight--;
		});
		expect(peak).toBe(1);
	});

	it("clamps a limit larger than the input to the item count", async () => {
		let inFlight = 0;
		let peak = 0;
		await mapWithConcurrency([1, 2], 99, async () => {
			inFlight++;
			peak = Math.max(peak, inFlight);
			await tick(1);
			inFlight--;
		});
		expect(peak).toBe(2);
	});

	it("treats a non-positive or NaN limit as 1", async () => {
		const out = await mapWithConcurrency([1, 2, 3], 0, async (n) => n * 2);
		expect(out).toEqual([2, 4, 6]);
	});

	it("resolves to an empty array for empty input without invoking fn", async () => {
		let called = false;
		const out = await mapWithConcurrency([], 4, async () => {
			called = true;
			return 1;
		});
		expect(out).toEqual([]);
		expect(called).toBe(false);
	});

	it("rejects (fail-fast) when fn throws", async () => {
		await expect(
			mapWithConcurrency([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom");
				return n;
			}),
		).rejects.toThrow("boom");
	});
});
