/* Per-category retry policy — bounded retries with no real waiting (injected
 * sleep). Verifies each category's attempt count and that a persistent failure
 * throws the last error. */
import { describe, expect, test } from "vite-plus/test";
import { withCategoryRetry } from "./retry-policy.ts";

const noSleep = async (): Promise<void> => {};

describe("withCategoryRetry", () => {
	test("returns on first success without retrying", async () => {
		let calls = 0;
		const r = await withCategoryRetry(
			"decide",
			async () => {
				calls++;
				return "ok";
			},
			noSleep,
		);
		expect(r).toBe("ok");
		expect(calls).toBe(1);
	});

	test("decide retries once then succeeds (2 attempts)", async () => {
		let calls = 0;
		const r = await withCategoryRetry(
			"decide",
			async () => {
				calls++;
				if (calls < 2) throw new Error("flaky");
				return "ok";
			},
			noSleep,
		);
		expect(r).toBe("ok");
		expect(calls).toBe(2);
	});

	test("generate allows 3 attempts", async () => {
		let calls = 0;
		const r = await withCategoryRetry(
			"generate",
			async () => {
				calls++;
				if (calls < 3) throw new Error("transient");
				return "img";
			},
			noSleep,
		);
		expect(r).toBe("img");
		expect(calls).toBe(3);
	});

	test("throws the last error after exhausting attempts", async () => {
		let calls = 0;
		await expect(
			withCategoryRetry(
				"read",
				async () => {
					calls++;
					throw new Error(`fail-${calls}`);
				},
				noSleep,
			),
		).rejects.toThrow("fail-2");
		expect(calls).toBe(2);
	});
});
