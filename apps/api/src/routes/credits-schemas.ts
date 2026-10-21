/* Request-body schemas for the credit routes.
 *
 * Every numeric field here was read as `Number(body.x ?? default)` and then
 * checked by hand — `Number.isFinite`, `> 0`, `>= 0`. `z.coerce.number()`
 * reproduces the coercion, and the handlers keep their own checks because their
 * messages are specific ("credits must be positive") and worth more than a
 * generic parse error.
 *
 * `metadata` stays an open record on purpose: it is caller-supplied billing
 * metadata, whose key set belongs to whoever spent the credits. That is the same
 * cause `oxlint.config.ts` scopes `credit-service.ts` for.
 */
import { z } from "zod";

const metadata = z.record(z.string(), z.unknown()).optional();
const creditOperation = z.enum(["llm", "image", "audio", "video", "render", "workflow"]);

export const quoteBody = z.object({
	operation: z.unknown().optional(),
	quantity: z.coerce.number().optional(),
	unit: z.coerce.string().optional(),
	providerCostUsd: z.coerce.number().optional(),
	infrastructureCostUsd: z.coerce.number().optional(),
	minimumChargeUsd: z.coerce.number().optional(),
	markupMultiplier: z.coerce.number().optional(),
	riskBufferPercent: z.coerce.number().optional(),
	creditsPerUsd: z.coerce.number().optional(),
	maximumMultiplier: z.coerce.number().optional(),
	provider: z.string().optional(),
	model: z.string().optional(),
	pricingVersion: z.string().optional(),
});

export const policyBody = z
	.object({
		dailyLimitCredits: z.number().nullish(),
		rolling5hLimitCredits: z.number().nullish(),
		perRunLimitCredits: z.number().nullish(),
		requireApprovalAboveCredits: z.number().nullish(),
	})
	.partial();

export const grantBody = z.object({
	credits: z.coerce.number().optional(),
	idempotencyKey: z.string().optional(),
	description: z.string().optional(),
	metadata,
});

export const checkBody = z.object({ credits: z.coerce.number().optional() });

export const reservationBody = z.object({
	credits: z.coerce.number().optional(),
	referenceType: z.string().optional(),
	referenceId: z.string().optional(),
	idempotencyKey: z.string().optional(),
	description: z.string().optional(),
	metadata,
});

const usageRecord = z.object({
	operation: creditOperation,
	provider: z.string().optional(),
	model: z.string().optional(),
	quantity: z.number(),
	unit: z.string(),
	providerCostUsd: z.number().optional(),
	chargedCredits: z.number(),
	pricingVersion: z.string().optional(),
	metadata,
});

export const captureBody = z.object({
	credits: z.coerce.number().optional(),
	idempotencyKey: z.string().optional(),
	usageRecords: z.array(usageRecord).optional(),
	description: z.string().optional(),
	metadata,
});

export const releaseBody = z.object({
	credits: z.coerce.number().nullish(),
	idempotencyKey: z.string().optional(),
	description: z.string().optional(),
	metadata,
});
