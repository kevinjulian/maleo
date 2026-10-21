/* What a generation costs — one table, not a literal at each call site.
 *
 * `0.04` appeared three times in visual-gen alone, and the tts numbers lived in
 * the old generation gateway, so changing a price meant finding every place that
 * had quoted one. The multipliers matter as much as the raw cost: they decide the
 * credits reserved before a run and captured after it.
 *
 * Provider cost is a function of quantity because the units differ per operation —
 * an image is billed per image, speech per character. */
import type { CreditQuote } from "@maleo/shared";
import { quoteCreditUsage } from "../credit-service.ts";

export type MeteredOperation = "image" | "audio" | "video";

interface Price {
	/** The unit the provider bills in, recorded on every usage row. */
	unit: string;
	/** Provider charge in USD for `quantity` units. */
	providerCostUsd: (quantity: number) => number;
	/** Our own cost per operation (storage, proxying, worker time). */
	infrastructureCostUsd: number;
	markupMultiplier: number;
	riskBufferPercent: number;
	/** Reserve headroom: the maximum a run may capture above its estimate. */
	maximumMultiplier: number;
}

export const PRICES = {
	image: {
		unit: "image",
		providerCostUsd: (quantity) => 0.04 * quantity,
		infrastructureCostUsd: 0.005,
		markupMultiplier: 1.4,
		riskBufferPercent: 0.1,
		maximumMultiplier: 1.15,
	},
	audio: {
		unit: "character",
		// Floored: a one-word line still costs a provider round-trip.
		providerCostUsd: (quantity) => Math.max(0.001, (quantity / 1000) * 0.015),
		infrastructureCostUsd: 0.002,
		markupMultiplier: 1.6,
		riskBufferPercent: 0.1,
		maximumMultiplier: 1.15,
	},
	video: {
		unit: "second",
		// Image-to-video, billed per second of output. Priced from the fal
		// distilled-i2v tier; a second provider tier belongs in this table, not at
		// the call site. Verify against the current provider rate card before
		// relying on the credit amounts this produces.
		providerCostUsd: (quantity) => Math.max(0.02, quantity * 0.02),
		infrastructureCostUsd: 0.01,
		markupMultiplier: 1.4,
		riskBufferPercent: 0.15,
		// Output length can overrun the requested duration by a frame budget.
		maximumMultiplier: 1.3,
	},
} satisfies Record<MeteredOperation, Price>;

/* LLM text generation, keyed by the provider and model that actually ran.
 *
 * Text is the one operation whose price is not a function of one quantity:
 * input and output tokens are billed at different rates, and the rates differ
 * per model by an order of magnitude. So it gets its own table rather than
 * being forced into the shape above.
 *
 * This table exists because the price used to live in the runner —
 * `ceil(in/1000 * 1 + out/1000 * 4)` inlined at the call site, with
 * `providerCostUsd: 0` hardcoded beside it. That was accurate while the only
 * runner was a flat-rate subscription CLI, where the marginal cost of a call
 * genuinely was zero. With an API-key provider it understates spend instead of
 * rounding it. */
export interface TextPrice {
	/** USD per million input tokens. */
	inputUsdPerMTok: number;
	/** USD per million output tokens. */
	outputUsdPerMTok: number;
	infrastructureCostUsd: number;
	markupMultiplier: number;
	riskBufferPercent: number;
	maximumMultiplier: number;
}

/* Flat-rate CLI runners: the subscription is already paid, so the marginal cost
 * of one call really is zero. They still bill credits — the credit charge is
 * what meters internal consumption — but their provider cost is honestly zero
 * rather than zero-by-oversight. */
const FLAT_RATE: TextPrice = {
	inputUsdPerMTok: 0,
	outputUsdPerMTok: 0,
	infrastructureCostUsd: 0,
	markupMultiplier: 1,
	riskBufferPercent: 0,
	maximumMultiplier: 1.2,
};

/* Per-token rates. Verify against the current vendor rate card before relying
 * on the credit amounts these produce — a stale rate here understates spend the
 * same way the inlined formula did. */
const METERED_DEFAULTS = {
	infrastructureCostUsd: 0.0001,
	markupMultiplier: 1.4,
	riskBufferPercent: 0.1,
	// Output length is not knowable in advance, so a text quote needs real
	// headroom between its estimate and its cap.
	maximumMultiplier: 1.5,
};

export const TEXT_PRICES: Record<string, TextPrice> = {
	// Fake provider — free by construction, and must never make a test bill.
	"fake:*": FLAT_RATE,

	// Per-token API models, reached through the OpenAI-compatible `api` provider.
	"api:gpt-5.5": { inputUsdPerMTok: 1.25, outputUsdPerMTok: 10, ...METERED_DEFAULTS },
	"api:gpt-5-mini": { inputUsdPerMTok: 0.25, outputUsdPerMTok: 2, ...METERED_DEFAULTS },
	"api:claude-opus-4-5": { inputUsdPerMTok: 5, outputUsdPerMTok: 25, ...METERED_DEFAULTS },
	"api:claude-sonnet-4-5": { inputUsdPerMTok: 3, outputUsdPerMTok: 15, ...METERED_DEFAULTS },
	"api:claude-haiku-4-5": { inputUsdPerMTok: 1, outputUsdPerMTok: 5, ...METERED_DEFAULTS },
	// Unknown model on a metered provider. Priced at the most expensive declared
	// tier rather than free: an unrecognised model on an API key still costs
	// money, and under-billing it is the failure this table exists to prevent.
	"api:*": { inputUsdPerMTok: 5, outputUsdPerMTok: 25, ...METERED_DEFAULTS },
};

/** Look up a text price, falling back to the provider's wildcard entry. An
 *  unregistered provider is treated as metered, for the same reason `api:*` is:
 *  guessing "free" is the expensive direction to be wrong in. */
export function textPriceFor(provider: string, model: string): TextPrice {
	return (
		TEXT_PRICES[`${provider}:${model}`] ?? TEXT_PRICES[`${provider}:*`] ?? TEXT_PRICES["api:*"]!
	);
}

export function textProviderCostUsd(
	provider: string,
	model: string,
	inputTokens: number,
	outputTokens: number,
): number {
	const price = textPriceFor(provider, model);
	return (
		(inputTokens / 1_000_000) * price.inputUsdPerMTok +
		(outputTokens / 1_000_000) * price.outputUsdPerMTok
	);
}

/** Quote one text generation against the table. The only place an LLM price is
 *  turned into credits. */
export function quoteForText(input: {
	provider: string;
	model: string;
	inputTokens: number;
	outputTokens: number;
}): CreditQuote {
	const price = textPriceFor(input.provider, input.model);
	return quoteCreditUsage({
		operation: "llm",
		quantity: input.inputTokens + input.outputTokens,
		unit: TEXT_UNIT,
		provider: input.provider,
		model: input.model,
		providerCostUsd: textProviderCostUsd(
			input.provider,
			input.model,
			input.inputTokens,
			input.outputTokens,
		),
		infrastructureCostUsd: price.infrastructureCostUsd,
		markupMultiplier: price.markupMultiplier,
		riskBufferPercent: price.riskBufferPercent,
		maximumMultiplier: price.maximumMultiplier,
	});
}

/* CLI runners report no token counts, so quantities are estimated from
 * character length. Recorded under its own unit so a measured count is never
 * mistaken for a guess on the ledger. */
export const TEXT_UNIT = "estimated_token";

export function providerCostUsd(
	operation: MeteredOperation,
	quantity: number,
	provider?: string,
): number {
	if (operation === "video" && provider === "sandbox") return 0;
	return PRICES[operation].providerCostUsd(quantity);
}

export function unitFor(operation: MeteredOperation): string {
	return PRICES[operation].unit;
}

/** Quote one operation against the table. The only place a generation price is
 *  turned into credits. */
export function quoteFor(input: {
	operation: MeteredOperation;
	quantity: number;
	provider: string;
	model: string;
}): CreditQuote {
	const price =
		input.operation === "video" && input.provider === "sandbox"
			? { ...PRICES.video, providerCostUsd: () => 0, infrastructureCostUsd: 0 }
			: PRICES[input.operation];
	return quoteCreditUsage({
		operation: input.operation,
		quantity: input.quantity,
		unit: price.unit,
		provider: input.provider,
		model: input.model,
		providerCostUsd: price.providerCostUsd(input.quantity),
		infrastructureCostUsd: price.infrastructureCostUsd,
		markupMultiplier: price.markupMultiplier,
		riskBufferPercent: price.riskBufferPercent,
		maximumMultiplier: price.maximumMultiplier,
	});
}
