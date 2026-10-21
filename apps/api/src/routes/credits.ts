import { Hono } from "hono";
import type { CreditOperation } from "@maleo/shared";
import {
	captureBody,
	checkBody,
	grantBody,
	policyBody,
	quoteBody,
	releaseBody,
	reservationBody,
} from "./credits-schemas.ts";
import {
	captureCredits,
	checkCreditLimit,
	getCreditSummary,
	grantCredits,
	listCreditTransactions,
	listUsageRecords,
	quoteCreditUsage,
	releaseCredits,
	reserveCredits,
	setCreditPolicy,
	type CreditScopeType,
} from "../lib/credit-service.ts";

/* Credits are GLOBAL, and this scope is deliberately not the active workspace.
 *
 * `scope_id` defaults to "local" and the web client sends no parameters at all,
 * so every request today resolves to one account. That makes the balance global
 * in practice while the scope model is workspace-shaped, and the obvious move
 * when scoping the rest of the app — pass the active workspace as `scope_id` —
 * would silently split one ledger into one per workspace: balances would appear
 * to change on switch, historical usage would scatter across accounts that
 * never held it, and nothing would error.
 *
 * Do NOT thread the active workspace here. Credits are app/admin scope; the
 * unscoped read is intended, not an omission the scoping sweep missed. */
function scope(c: { req: { query: (key: string) => string | undefined } }) {
	const rawType = c.req.query("scope_type");
	const scopeType: CreditScopeType =
		rawType === "user" || rawType === "project" ? rawType : "workspace";
	const scopeId = c.req.query("scope_id")?.trim() || "local";
	return { scopeType, scopeId };
}

function limit(c: { req: { query: (key: string) => string | undefined } }): number {
	const n = Number(c.req.query("limit") ?? 50);
	return Number.isFinite(n) ? n : 50;
}

function op(value: unknown): CreditOperation {
	return value === "llm" ||
		value === "image" ||
		value === "audio" ||
		value === "video" ||
		value === "render" ||
		value === "workflow"
		? value
		: "workflow";
}

export function creditsRoutes(): Hono {
	const app = new Hono();

	app.get("/balance", async (c) => {
		const s = scope(c);
		return c.json(await getCreditSummary(s.scopeType, s.scopeId));
	});

	app.get("/transactions", async (c) => {
		const s = scope(c);
		return c.json({ items: await listCreditTransactions(s.scopeType, s.scopeId, limit(c)) });
	});

	app.get("/usage", async (c) => {
		const s = scope(c);
		return c.json({ items: await listUsageRecords(s.scopeType, s.scopeId, limit(c)) });
	});

	app.post("/quote", async (c) => {
		const parsed = quoteBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const providerCostUsd = Number(body.providerCostUsd ?? 0);
		const quantity = Number(body.quantity ?? 1);
		if (!Number.isFinite(providerCostUsd) || providerCostUsd < 0)
			return c.json({ error: "providerCostUsd must be non-negative" }, 400);
		if (!Number.isFinite(quantity) || quantity <= 0)
			return c.json({ error: "quantity must be positive" }, 400);
		const quote = quoteCreditUsage({
			operation: op(body.operation),
			quantity,
			unit: String(body.unit ?? "unit"),
			providerCostUsd,
			infrastructureCostUsd: Number(body.infrastructureCostUsd ?? 0),
			minimumChargeUsd: Number(body.minimumChargeUsd ?? 0),
			markupMultiplier: Number(body.markupMultiplier ?? 1.4),
			riskBufferPercent: Number(body.riskBufferPercent ?? 0.1),
			creditsPerUsd: Number(body.creditsPerUsd ?? 1000),
			maximumMultiplier: Number(body.maximumMultiplier ?? 1.15),
			provider: body.provider,
			model: body.model,
			pricingVersion: body.pricingVersion,
		});
		return c.json(quote);
	});

	app.post("/policy", async (c) => {
		const s = scope(c);
		const parsed = policyBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const policy = await setCreditPolicy(
			{
				dailyLimitCredits: body.dailyLimitCredits ?? null,
				rolling5hLimitCredits: body.rolling5hLimitCredits ?? null,
				perRunLimitCredits: body.perRunLimitCredits ?? null,
				requireApprovalAboveCredits: body.requireApprovalAboveCredits ?? null,
			},
			s.scopeType,
			s.scopeId,
		);
		return c.json({ policy });
	});

	app.post("/grant", async (c) => {
		const s = scope(c);
		const parsed = grantBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.idempotencyKey) return c.json({ error: "idempotencyKey is required" }, 400);
		const credits = Number(body.credits ?? 0);
		if (!Number.isFinite(credits) || credits <= 0)
			return c.json({ error: "credits must be positive" }, 400);
		return c.json({
			transaction: await grantCredits({
				scopeType: s.scopeType,
				scopeId: s.scopeId,
				credits,
				idempotencyKey: body.idempotencyKey,
				description: body.description,
				metadata: body.metadata,
			}),
		});
	});

	app.post("/check", async (c) => {
		const s = scope(c);
		const parsed = checkBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const credits = Number(body.credits ?? 0);
		if (!Number.isFinite(credits) || credits < 0)
			return c.json({ error: "credits must be non-negative" }, 400);
		return c.json(
			await checkCreditLimit({
				scopeType: s.scopeType,
				scopeId: s.scopeId,
				requestedCredits: credits,
			}),
		);
	});

	app.post("/reservations", async (c) => {
		const s = scope(c);
		const parsed = reservationBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.idempotencyKey || !body.referenceType || !body.referenceId)
			return c.json({ error: "idempotencyKey, referenceType, and referenceId are required" }, 400);
		const credits = Number(body.credits ?? 0);
		if (!Number.isFinite(credits) || credits <= 0)
			return c.json({ error: "credits must be positive" }, 400);
		try {
			return c.json(
				{
					reservation: await reserveCredits({
						scopeType: s.scopeType,
						scopeId: s.scopeId,
						credits,
						referenceType: body.referenceType,
						referenceId: body.referenceId,
						idempotencyKey: body.idempotencyKey,
						description: body.description,
						metadata: body.metadata,
					}),
				},
				201,
			);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 402);
		}
	});

	app.post("/reservations/:id/capture", async (c) => {
		const parsed = captureBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.idempotencyKey) return c.json({ error: "idempotencyKey is required" }, 400);
		const credits = Number(body.credits ?? 0);
		if (!Number.isFinite(credits) || credits < 0)
			return c.json({ error: "credits must be non-negative" }, 400);
		return c.json({
			reservation: await captureCredits({
				reservationId: c.req.param("id"),
				credits,
				idempotencyKey: body.idempotencyKey,
				usageRecords: body.usageRecords,
				description: body.description,
				metadata: body.metadata,
			}),
		});
	});

	app.post("/reservations/:id/release", async (c) => {
		const parsed = releaseBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.idempotencyKey) return c.json({ error: "idempotencyKey is required" }, 400);
		return c.json({
			reservation: await releaseCredits({
				reservationId: c.req.param("id"),
				credits: body.credits == null ? undefined : Number(body.credits),
				idempotencyKey: body.idempotencyKey,
				description: body.description,
				metadata: body.metadata,
			}),
		});
	});

	return app;
}
