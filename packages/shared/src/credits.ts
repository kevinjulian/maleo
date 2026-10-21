export type CreditOperation = "llm" | "image" | "audio" | "video" | "render" | "workflow";

export type CreditTransactionType =
	| "grant"
	| "purchase"
	| "reserve"
	| "capture"
	| "release"
	| "refund"
	| "adjustment"
	| "expiration";

export interface CreditPricingFormulaInput {
	providerCostUsd: number;
	infrastructureCostUsd?: number;
	minimumChargeUsd?: number;
	markupMultiplier?: number;
	riskBufferPercent?: number;
	creditsPerUsd?: number;
}

export interface CreditQuoteInput extends CreditPricingFormulaInput {
	operation: CreditOperation;
	quantity: number;
	unit: string;
	provider?: string;
	model?: string;
	pricingVersion?: string;
	maximumMultiplier?: number;
}

export interface CreditQuote {
	operation: CreditOperation;
	estimatedCredits: number;
	maximumCredits: number;
	quantity: number;
	unit: string;
	provider?: string;
	model?: string;
	pricingVersion: string;
	expiresAt: string;
}

export interface CreditLimitPolicy {
	dailyLimitCredits?: number | null;
	rolling5hLimitCredits?: number | null;
	perRunLimitCredits?: number | null;
	requireApprovalAboveCredits?: number | null;
}

export interface CreditUsageWindow {
	dailyUsedCredits: number;
	rolling5hUsedCredits: number;
	availableCredits: number;
	reservedCredits: number;
}

export interface CreditLimitDecision {
	ok: boolean;
	reason?:
		| "insufficient_credits"
		| "daily_limit"
		| "rolling_5h_limit"
		| "per_run_limit"
		| "approval_required";
	message?: string;
	availableAt?: string;
}

export const DEFAULT_CREDITS_PER_USD = 1000;
export const DEFAULT_PRICING_VERSION = "2026-07-15";
export const DEFAULT_QUOTE_TTL_MS = 15 * 60 * 1000;

function finiteNonNegative(value: number | undefined, fallback: number): number {
	return Number.isFinite(value) && value !== undefined && value >= 0 ? value : fallback;
}

export function calculateCredits(input: CreditPricingFormulaInput): number {
	const providerCostUsd = finiteNonNegative(input.providerCostUsd, 0);
	const infrastructureCostUsd = finiteNonNegative(input.infrastructureCostUsd, 0);
	const minimumChargeUsd = finiteNonNegative(input.minimumChargeUsd, 0);
	const markupMultiplier = finiteNonNegative(input.markupMultiplier, 1);
	const riskBufferPercent = finiteNonNegative(input.riskBufferPercent, 0);
	const creditsPerUsd = finiteNonNegative(input.creditsPerUsd, DEFAULT_CREDITS_PER_USD);
	const baseCost = providerCostUsd + infrastructureCostUsd;
	const bufferedCost = baseCost * (1 + riskBufferPercent);
	const sellingPriceUsd = Math.max(bufferedCost * markupMultiplier, minimumChargeUsd);
	return Math.ceil(sellingPriceUsd * creditsPerUsd);
}

export function quoteCredits(input: CreditQuoteInput, now = Date.now()): CreditQuote {
	const estimatedCredits = calculateCredits(input);
	const maximumMultiplier = finiteNonNegative(input.maximumMultiplier, 1);
	const maximumCredits = Math.max(
		estimatedCredits,
		Math.ceil(estimatedCredits * maximumMultiplier),
	);
	return {
		operation: input.operation,
		estimatedCredits,
		maximumCredits,
		quantity: input.quantity,
		unit: input.unit,
		provider: input.provider,
		model: input.model,
		pricingVersion: input.pricingVersion ?? DEFAULT_PRICING_VERSION,
		expiresAt: new Date(now + DEFAULT_QUOTE_TTL_MS).toISOString(),
	};
}

export function evaluateCreditLimit(
	policy: CreditLimitPolicy,
	window: CreditUsageWindow,
	requestedCredits: number,
	now = Date.now(),
): CreditLimitDecision {
	const requested = Math.max(0, Math.ceil(requestedCredits));
	if (
		(policy.perRunLimitCredits ?? null) != null &&
		requested > Number(policy.perRunLimitCredits)
	) {
		return {
			ok: false,
			reason: "per_run_limit",
			message: `Request exceeds per-run limit of ${policy.perRunLimitCredits} credits.`,
		};
	}
	if (
		(policy.requireApprovalAboveCredits ?? null) != null &&
		requested > Number(policy.requireApprovalAboveCredits)
	) {
		return {
			ok: false,
			reason: "approval_required",
			message: `Request requires approval above ${policy.requireApprovalAboveCredits} credits.`,
		};
	}
	if (window.availableCredits < requested) {
		return {
			ok: false,
			reason: "insufficient_credits",
			message: `Only ${window.availableCredits} credits available.`,
		};
	}
	if (
		(policy.dailyLimitCredits ?? null) != null &&
		window.dailyUsedCredits + requested > Number(policy.dailyLimitCredits)
	) {
		const d = new Date(now);
		d.setHours(24, 0, 0, 0);
		return {
			ok: false,
			reason: "daily_limit",
			message: `Daily credit limit reached.`,
			availableAt: d.toISOString(),
		};
	}
	if (
		(policy.rolling5hLimitCredits ?? null) != null &&
		window.rolling5hUsedCredits + requested > Number(policy.rolling5hLimitCredits)
	) {
		return {
			ok: false,
			reason: "rolling_5h_limit",
			message: `Rolling 5-hour credit limit reached.`,
		};
	}
	return { ok: true };
}
