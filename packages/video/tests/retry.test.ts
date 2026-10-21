import { describe, expect, it } from "vite-plus/test";
import { backoffDelay, HttpError, isTransientError, withRetry } from "../src/lib/retry";

const noSleep = async () => {};

describe("isTransientError", () => {
	it("classifies 5xx / 408 / 429 HttpError as transient", () => {
		expect(isTransientError(new HttpError(500, ""))).toBe(true);
		expect(isTransientError(new HttpError(503, ""))).toBe(true);
		expect(isTransientError(new HttpError(429, ""))).toBe(true);
		expect(isTransientError(new HttpError(408, ""))).toBe(true);
	});

	it("classifies 4xx (except 408/429) as permanent", () => {
		expect(isTransientError(new HttpError(400, ""))).toBe(false);
		expect(isTransientError(new HttpError(404, ""))).toBe(false);
		expect(isTransientError(new HttpError(422, ""))).toBe(false);
	});

	it("classifies network error messages as transient", () => {
		expect(isTransientError(new Error("fetch failed"))).toBe(true);
		expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
		expect(isTransientError(new Error("socket hang up"))).toBe(true);
	});

	it("classifies plain validation errors as permanent", () => {
		expect(isTransientError(new Error("invalid storyboard"))).toBe(false);
	});
});

describe("backoffDelay", () => {
	it("grows exponentially and respects the cap", () => {
		// jitter is +/-25%, so check bounds rather than exact values
		const d0 = backoffDelay(0, 500, 8000);
		expect(d0).toBeGreaterThanOrEqual(375);
		expect(d0).toBeLessThanOrEqual(625);
		const dBig = backoffDelay(10, 500, 8000);
		expect(dBig).toBeLessThanOrEqual(8000 * 1.25);
	});
});

describe("withRetry", () => {
	it("returns on first success without retrying", async () => {
		let calls = 0;
		const out = await withRetry(
			async () => {
				calls++;
				return "ok";
			},
			{ sleep: noSleep },
		);
		expect(out).toBe("ok");
		expect(calls).toBe(1);
	});

	it("retries transient failures up to attempts then succeeds", async () => {
		let calls = 0;
		const out = await withRetry(
			async () => {
				calls++;
				if (calls < 3) throw new HttpError(503, "down");
				return "recovered";
			},
			{ attempts: 3, sleep: noSleep },
		);
		expect(out).toBe("recovered");
		expect(calls).toBe(3);
	});

	it("does not retry permanent errors", async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new HttpError(400, "bad");
				},
				{ attempts: 5, sleep: noSleep },
			),
		).rejects.toThrow();
		expect(calls).toBe(1);
	});

	it("throws the last error after exhausting attempts", async () => {
		let calls = 0;
		await expect(
			withRetry(
				async () => {
					calls++;
					throw new HttpError(500, `fail-${calls}`);
				},
				{ attempts: 3, sleep: noSleep },
			),
		).rejects.toThrow("fail-3");
		expect(calls).toBe(3);
	});
});
