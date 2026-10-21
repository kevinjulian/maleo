import { describe, expect, test } from "vite-plus/test";
import { calculateCredits, evaluateCreditLimit, quoteCredits } from "../src/credits.ts";

describe("credits", () => {
	test("calculates credits from provider cost, infra, markup, and risk", () => {
		expect(
			calculateCredits({
				providerCostUsd: 0.8,
				infrastructureCostUsd: 0.05,
				markupMultiplier: 1.3,
				riskBufferPercent: 0.1,
				creditsPerUsd: 1000,
			}),
		).toBe(1216);
	});

	test("quotes maximum charge above estimated charge", () => {
		const quote = quoteCredits(
			{
				operation: "image",
				quantity: 1,
				unit: "image",
				providerCostUsd: 0.04,
				infrastructureCostUsd: 0.005,
				markupMultiplier: 1.4,
				riskBufferPercent: 0.1,
				maximumMultiplier: 1.2,
			},
			Date.UTC(2026, 6, 15),
		);
		expect(quote.estimatedCredits).toBe(70);
		expect(quote.maximumCredits).toBe(84);
		expect(quote.pricingVersion).toBe("2026-07-15");
	});

	test("blocks daily and rolling 5-hour overages", () => {
		const daily = evaluateCreditLimit(
			{ dailyLimitCredits: 100, rolling5hLimitCredits: 80 },
			{
				dailyUsedCredits: 90,
				rolling5hUsedCredits: 20,
				availableCredits: 1000,
				reservedCredits: 0,
			},
			20,
		);
		expect(daily.ok).toBe(false);
		expect(daily.reason).toBe("daily_limit");

		const rolling = evaluateCreditLimit(
			{ dailyLimitCredits: 500, rolling5hLimitCredits: 80 },
			{
				dailyUsedCredits: 90,
				rolling5hUsedCredits: 70,
				availableCredits: 1000,
				reservedCredits: 0,
			},
			20,
		);
		expect(rolling.ok).toBe(false);
		expect(rolling.reason).toBe("rolling_5h_limit");
	});
});
