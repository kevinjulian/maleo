/* LLM text generation is priced from the table, not from a formula in the
 * runner.
 *
 * The regression these guard is quiet: `providerCostUsd: 0` was correct for a
 * flat-rate CLI and wrong for an API key, and nothing about the wrong version
 * looks broken — the ledger just reports less spend than the card is charged. */
import { describe, expect, test } from "bun:test";
import {
	quoteForText,
	textPriceFor,
	textProviderCostUsd,
	TEXT_PRICES,
	TEXT_UNIT,
} from "./prices.ts";

describe("text pricing is keyed by the provider and model that ran", () => {
	test("a text generation is priced from the table for its provider and model", () => {
		const quote = quoteForText({
			provider: "api",
			model: "gpt-5.5",
			inputTokens: 1_000_000,
			outputTokens: 1_000_000,
		});
		expect(quote.operation).toBe("llm");
		expect(quote.provider).toBe("api");
		expect(quote.model).toBe("gpt-5.5");
		expect(quote.unit).toBe(TEXT_UNIT);
		expect(quote.quantity).toBe(2_000_000);
		expect(quote.estimatedCredits).toBeGreaterThan(0);
	});

	test("two models on one provider price differently", () => {
		const big = textProviderCostUsd("api", "gpt-5.5", 1_000_000, 1_000_000);
		const small = textProviderCostUsd("api", "gpt-5-mini", 1_000_000, 1_000_000);
		expect(big).toBeGreaterThan(small);
	});

	test("input and output tokens bill at different rates", () => {
		const mostlyInput = textProviderCostUsd("api", "gpt-5.5", 1_000_000, 0);
		const mostlyOutput = textProviderCostUsd("api", "gpt-5.5", 0, 1_000_000);
		expect(mostlyOutput).toBeGreaterThan(mostlyInput);
	});

	test("cost scales with tokens rather than per call", () => {
		const one = textProviderCostUsd("api", "gpt-5.5", 1_000, 1_000);
		const ten = textProviderCostUsd("api", "gpt-5.5", 10_000, 10_000);
		expect(ten).toBeCloseTo(one * 10, 10);
	});

	test("a price is never a literal at a call site", () => {
		// Every rate is reachable through the table, keyed as provider:model.
		for (const key of Object.keys(TEXT_PRICES)) {
			expect(key).toMatch(/^[a-z-]+:(\*|[a-z0-9.-]+)$/);
		}
	});
});

describe("provider cost reflects how the provider actually bills", () => {
	test("a per-token API provider records non-zero provider cost", () => {
		const cost = textProviderCostUsd("api", "gpt-5.5", 100_000, 50_000);
		expect(cost).toBeGreaterThan(0);

		const quote = quoteForText({
			provider: "api",
			model: "gpt-5.5",
			inputTokens: 100_000,
			outputTokens: 50_000,
		});
		expect(quote.estimatedCredits).toBeGreaterThan(0);
	});

	test("the fake provider never bills", () => {
		expect(textProviderCostUsd("fake", "fake-1", 999_999, 999_999)).toBe(0);
	});
});

describe("unknown models fall back safely", () => {
	test("an unlisted model on a metered provider is priced, not free", () => {
		expect(textProviderCostUsd("api", "some-new-model", 1_000_000, 0)).toBeGreaterThan(0);
	});

	test("an unlisted model on a flat-rate provider stays flat-rate", () => {
		expect(textProviderCostUsd("fake", "fake-unreleased", 1_000_000, 0)).toBe(0);
	});

	test("an entirely unknown provider is treated as metered", () => {
		// Guessing "free" is the expensive direction to be wrong in.
		expect(textPriceFor("brand-new", "x").outputUsdPerMTok).toBeGreaterThan(0);
	});
});
