import { readBack } from "@maleo/db/row-json";
import { randomUUID } from "node:crypto";
import { serialize, type Db } from "@maleo/db/handle";
import {
	evaluateCreditLimit,
	quoteCredits,
	type CreditLimitDecision,
	type CreditLimitPolicy,
	type CreditOperation,
	type CreditQuote,
	type CreditQuoteInput,
	type CreditTransactionType,
} from "@maleo/shared";
import { openDb } from "@maleo/db/connection";

export type CreditScopeType = "workspace" | "user" | "project";

export interface CreditAccount {
	id: string;
	scope_type: CreditScopeType;
	scope_id: string;
	available_credits: number;
	reserved_credits: number;
	created_at: number;
	updated_at: number;
}

export interface CreditReservation {
	id: string;
	account_id: string;
	reference_type: string;
	reference_id: string;
	requested_credits: number;
	reserved_credits: number;
	captured_credits: number;
	status: "active" | "captured" | "released" | "cancelled" | "expired";
	expires_at: number | null;
	created_at: number;
	updated_at: number;
}

export interface CreditTransaction {
	id: string;
	account_id: string;
	type: CreditTransactionType;
	amount_credits: number;
	balance_available_after: number;
	balance_reserved_after: number;
	reference_type: string | null;
	reference_id: string | null;
	idempotency_key: string | null;
	description: string | null;
	metadata_json: string | null;
	created_at: number;
}

export interface UsageRecordInput {
	operation: CreditOperation;
	provider?: string;
	model?: string;
	quantity: number;
	unit: string;
	providerCostUsd?: number;
	chargedCredits: number;
	pricingVersion?: string;
	metadata?: Record<string, unknown>;
}

export interface BillableOperationInput<T> {
	scopeType?: CreditScopeType;
	scopeId?: string;
	referenceType: string;
	referenceId: string;
	idempotencyKey: string;
	quote: CreditQuote;
	usageRecord: Omit<UsageRecordInput, "chargedCredits"> & { chargedCredits?: number };
	run: () => Promise<T>;
}

export interface CreditUsageRecord {
	id: string;
	account_id: string;
	reservation_id: string | null;
	operation: CreditOperation;
	provider: string | null;
	model: string | null;
	quantity: number;
	unit: string;
	provider_cost_usd: number;
	charged_credits: number;
	pricing_version: string;
	metadata_json: string | null;
	created_at: number;
}

export interface CreditSummary {
	account: CreditAccount;
	policy: CreditLimitPolicy;
	dailyUsedCredits: number;
	rolling5hUsedCredits: number;
	dailyRemainingCredits: number | null;
	rolling5hRemainingCredits: number | null;
	dailyRefreshAt: string;
	rolling5hRefreshAt: string | null;
	enforcementEnabled: boolean;
}

export interface ReserveCreditsInput {
	scopeType?: CreditScopeType;
	scopeId?: string;
	credits: number;
	referenceType: string;
	referenceId: string;
	idempotencyKey: string;
	expiresAt?: number | null;
	description?: string;
	metadata?: Record<string, unknown>;
}

const DEFAULT_SCOPE_TYPE: CreditScopeType = "workspace";
const DEFAULT_SCOPE_ID = "local";
const DEFAULT_POLICY: Required<CreditLimitPolicy> = {
	dailyLimitCredits: 10_000,
	rolling5hLimitCredits: 3_000,
	perRunLimitCredits: 1_500,
	requireApprovalAboveCredits: 1_000,
};

function nowMs(): number {
	return Date.now();
}

function credits(value: number): number {
	if (!Number.isFinite(value) || value < 0)
		throw new Error("credits must be a non-negative number");
	return Math.ceil(value);
}

function metadataJson(value: Record<string, unknown> | undefined): string | null {
	if (!value || Object.keys(value).length === 0) return null;
	return JSON.stringify(value);
}

/** The `credit_policies` row as SQLite returns it. The limits are nullable
 *  because "no limit" is stored as NULL, which is why every field below is
 *  checked against `null` before it is turned into a number. */
interface CreditPolicyRow {
	daily_limit_credits: number | null;
	rolling_5h_limit_credits: number | null;
	per_run_limit_credits: number | null;
	require_approval_above_credits: number | null;
}

function parsePolicy(row: CreditPolicyRow | null | undefined): CreditLimitPolicy {
	if (!row) return { ...DEFAULT_POLICY };
	return {
		dailyLimitCredits: row.daily_limit_credits == null ? null : Number(row.daily_limit_credits),
		rolling5hLimitCredits:
			row.rolling_5h_limit_credits == null ? null : Number(row.rolling_5h_limit_credits),
		perRunLimitCredits:
			row.per_run_limit_credits == null ? null : Number(row.per_run_limit_credits),
		requireApprovalAboveCredits:
			row.require_approval_above_credits == null
				? null
				: Number(row.require_approval_above_credits),
	};
}

export function quoteCreditUsage(input: CreditQuoteInput): CreditQuote {
	return quoteCredits(input);
}

/* Concurrent first uses of a scope must not both insert an account: the loser's
 * insert does nothing and both read the winner's row. */
export async function getOrCreateCreditAccount(
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	db: Db = openDb(),
): Promise<CreditAccount> {
	const existing = await db.get<CreditAccount>(
		"SELECT * FROM credit_accounts WHERE scope_type = ? AND scope_id = ?",
		[scopeType, scopeId],
	);
	if (existing) return existing;
	const ts = nowMs();
	await db.run(
		`INSERT INTO credit_accounts (id, scope_type, scope_id, available_credits, reserved_credits, created_at, updated_at)
		 VALUES (?, ?, ?, 0, 0, ?, ?)
		 ON CONFLICT(scope_type, scope_id) DO NOTHING`,
		[randomUUID(), scopeType, scopeId, ts, ts],
	);
	await db.run(
		`INSERT INTO credit_policies
		 (id, scope_type, scope_id, daily_limit_credits, rolling_5h_limit_credits, per_run_limit_credits, require_approval_above_credits, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT DO NOTHING`,
		[
			randomUUID(),
			scopeType,
			scopeId,
			DEFAULT_POLICY.dailyLimitCredits,
			DEFAULT_POLICY.rolling5hLimitCredits,
			DEFAULT_POLICY.perRunLimitCredits,
			DEFAULT_POLICY.requireApprovalAboveCredits,
			ts,
			ts,
		],
	);
	return readBack(
		await db.get<CreditAccount>(
			"SELECT * FROM credit_accounts WHERE scope_type = ? AND scope_id = ?",
			[scopeType, scopeId],
		),
		"credit_accounts",
	);
}

export async function getCreditPolicy(
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	db: Db = openDb(),
): Promise<CreditLimitPolicy> {
	await getOrCreateCreditAccount(scopeType, scopeId, db);
	const row = await db.get<CreditPolicyRow>(
		"SELECT * FROM credit_policies WHERE scope_type = ? AND scope_id = ?",
		[scopeType, scopeId],
	);
	return parsePolicy(row);
}

export async function setCreditPolicy(
	policy: CreditLimitPolicy,
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	db: Db = openDb(),
): Promise<CreditLimitPolicy> {
	const ts = nowMs();
	await db.run(
		`INSERT INTO credit_policies
		 (id, scope_type, scope_id, daily_limit_credits, rolling_5h_limit_credits, per_run_limit_credits, require_approval_above_credits, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(scope_type, scope_id) DO UPDATE SET
		 	daily_limit_credits = excluded.daily_limit_credits,
		 	rolling_5h_limit_credits = excluded.rolling_5h_limit_credits,
		 	per_run_limit_credits = excluded.per_run_limit_credits,
		 	require_approval_above_credits = excluded.require_approval_above_credits,
		 	updated_at = excluded.updated_at`,
		[
			randomUUID(),
			scopeType,
			scopeId,
			policy.dailyLimitCredits ?? null,
			policy.rolling5hLimitCredits ?? null,
			policy.perRunLimitCredits ?? null,
			policy.requireApprovalAboveCredits ?? null,
			ts,
			ts,
		],
	);
	return getCreditPolicy(scopeType, scopeId, db);
}

async function insertTransaction(
	db: Db,
	input: {
		account: CreditAccount;
		type: CreditTransactionType;
		amountCredits: number;
		referenceType?: string | null;
		referenceId?: string | null;
		idempotencyKey?: string | null;
		description?: string | null;
		metadata?: Record<string, unknown>;
		createdAt?: number;
	},
): Promise<CreditTransaction> {
	const ts = input.createdAt ?? nowMs();
	const id = randomUUID();
	await db.run(
		`INSERT INTO credit_transactions
		 (id, account_id, type, amount_credits, balance_available_after, balance_reserved_after, reference_type, reference_id, idempotency_key, description, metadata_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.account.id,
			input.type,
			input.amountCredits,
			input.account.available_credits,
			input.account.reserved_credits,
			input.referenceType ?? null,
			input.referenceId ?? null,
			input.idempotencyKey ?? null,
			input.description ?? null,
			metadataJson(input.metadata),
			ts,
		],
	);
	return readBack(
		await db.get<CreditTransaction>("SELECT * FROM credit_transactions WHERE id = ?", [id]),
		"credit_transactions",
	);
}

async function accountById(db: Db, id: string): Promise<CreditAccount> {
	const account = await db.get<CreditAccount>("SELECT * FROM credit_accounts WHERE id = ?", [id]);
	if (!account) throw new Error("credit account not found");
	return account;
}

/* Every balance change runs inside one transaction that first takes the account's
 * lock: the idempotency lookup, the limit check and the write then see one
 * consistent balance. SQLite's single writer gave this for free; on Postgres two
 * captures of one reservation could otherwise both pass the "remaining" check. */
const accountLock = (accountId: string): string => `credit-account:${accountId}`;

export async function grantCredits(
	input: {
		scopeType?: CreditScopeType;
		scopeId?: string;
		credits: number;
		idempotencyKey: string;
		description?: string;
		metadata?: Record<string, unknown>;
	},
	db: Db = openDb(),
): Promise<CreditTransaction> {
	const account = await getOrCreateCreditAccount(input.scopeType, input.scopeId, db);
	const amount = credits(input.credits);
	return db.transaction(async (tx) => {
		await serialize(tx, accountLock(account.id));
		const existing = await tx.get<CreditTransaction>(
			"SELECT * FROM credit_transactions WHERE idempotency_key = ?",
			[input.idempotencyKey],
		);
		if (existing) return existing;
		const ts = nowMs();
		await tx.run(
			"UPDATE credit_accounts SET available_credits = available_credits + ?, updated_at = ? WHERE id = ?",
			[amount, ts, account.id],
		);
		return insertTransaction(tx, {
			account: await accountById(tx, account.id),
			type: "grant",
			amountCredits: amount,
			referenceType: "manual",
			referenceId: input.idempotencyKey,
			idempotencyKey: input.idempotencyKey,
			description: input.description ?? "Credit grant",
			metadata: input.metadata,
			createdAt: ts,
		});
	});
}

/** Credits already spent in the two windows a limit is evaluated against. */
export interface CreditUsageWindow {
	dailyUsedCredits: number;
	rolling5hUsedCredits: number;
}

export async function getCreditUsageWindow(
	accountId: string,
	db: Db = openDb(),
): Promise<CreditUsageWindow> {
	const now = nowMs();
	const dayStart = new Date(now);
	dayStart.setHours(0, 0, 0, 0);
	const rollingStart = now - 5 * 60 * 60 * 1000;
	const daily = await db.get<{ total: number }>(
		"SELECT COALESCE(SUM(charged_credits), 0) AS total FROM usage_records WHERE account_id = ? AND created_at >= ?",
		[accountId, dayStart.getTime()],
	);
	const rolling = await db.get<{ total: number }>(
		"SELECT COALESCE(SUM(charged_credits), 0) AS total FROM usage_records WHERE account_id = ? AND created_at >= ?",
		[accountId, rollingStart],
	);
	// `COALESCE(SUM(…), 0)` without GROUP BY always returns exactly one row, so a
	// missing row means no usage rather than an error.
	return {
		dailyUsedCredits: Number(daily?.total ?? 0),
		rolling5hUsedCredits: Number(rolling?.total ?? 0),
	};
}

async function rolling5hRefreshAt(accountId: string, db: Db): Promise<string | null> {
	const rollingStart = nowMs() - 5 * 60 * 60 * 1000;
	const row = await db.get<{ first: number | null }>(
		"SELECT MIN(created_at) AS first FROM usage_records WHERE account_id = ? AND created_at >= ?",
		[accountId, rollingStart],
	);
	return row?.first ? new Date(Number(row.first) + 5 * 60 * 60 * 1000).toISOString() : null;
}

function dailyRefreshAt(): string {
	const d = new Date();
	d.setHours(24, 0, 0, 0);
	return d.toISOString();
}

export async function checkCreditLimit(
	input: {
		scopeType?: CreditScopeType;
		scopeId?: string;
		requestedCredits: number;
	},
	db: Db = openDb(),
): Promise<CreditLimitDecision> {
	const account = await getOrCreateCreditAccount(input.scopeType, input.scopeId, db);
	const policy = await getCreditPolicy(input.scopeType, input.scopeId, db);
	const usage = await getCreditUsageWindow(account.id, db);
	return evaluateCreditLimit(
		policy,
		{
			...usage,
			availableCredits: account.available_credits,
			reservedCredits: account.reserved_credits,
		},
		input.requestedCredits,
	);
}

export async function reserveCredits(
	input: ReserveCreditsInput,
	db: Db = openDb(),
): Promise<CreditReservation> {
	const account = await getOrCreateCreditAccount(input.scopeType, input.scopeId, db);
	const amount = credits(input.credits);
	return db.transaction(async (tx) => {
		await serialize(tx, accountLock(account.id));
		const existing = await tx.get<CreditReservation>(
			`SELECT r.* FROM credit_reservations r
			 JOIN credit_transactions t ON t.reference_type = 'credit_reservation' AND t.reference_id = r.id
			 WHERE t.idempotency_key = ?`,
			[input.idempotencyKey],
		);
		if (existing) return existing;
		const decision = await checkCreditLimit(
			{ scopeType: input.scopeType, scopeId: input.scopeId, requestedCredits: amount },
			tx,
		);
		if (!decision.ok)
			throw new Error(decision.message ?? decision.reason ?? "credit limit exceeded");
		const ts = nowMs();
		const reservationId = randomUUID();
		await tx.run(
			"UPDATE credit_accounts SET available_credits = available_credits - ?, reserved_credits = reserved_credits + ?, updated_at = ? WHERE id = ?",
			[amount, amount, ts, account.id],
		);
		await tx.run(
			`INSERT INTO credit_reservations
			 (id, account_id, reference_type, reference_id, requested_credits, reserved_credits, captured_credits, status, expires_at, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)`,
			[
				reservationId,
				account.id,
				input.referenceType,
				input.referenceId,
				amount,
				amount,
				input.expiresAt ?? null,
				ts,
				ts,
			],
		);
		await insertTransaction(tx, {
			account: await accountById(tx, account.id),
			type: "reserve",
			amountCredits: -amount,
			referenceType: "credit_reservation",
			referenceId: reservationId,
			idempotencyKey: input.idempotencyKey,
			description: input.description ?? `Reserved ${amount} credits`,
			metadata: input.metadata,
			createdAt: ts,
		});
		return readBack(
			await tx.get<CreditReservation>("SELECT * FROM credit_reservations WHERE id = ?", [
				reservationId,
			]),
			"credit_reservations",
		);
	});
}

/* A replayed idempotency key returns the reservation it already produced. A
 * missing row there is a broken reference, not a normal absence. */
async function replayed(tx: Db, idempotencyKey: string): Promise<CreditReservation | null> {
	const existing = await tx.get<{ reference_id: string }>(
		"SELECT reference_id FROM credit_transactions WHERE idempotency_key = ?",
		[idempotencyKey],
	);
	if (!existing?.reference_id) return null;
	const prior = await tx.get<CreditReservation>("SELECT * FROM credit_reservations WHERE id = ?", [
		existing.reference_id,
	]);
	if (!prior)
		throw new Error("credit_reservations: idempotent replay points at a missing reservation");
	return prior;
}

/** The reservation's account, read before locking: the lock is per account. */
async function reservationAccount(db: Db, reservationId: string): Promise<string> {
	const row = await db.get<{ account_id: string }>(
		"SELECT account_id FROM credit_reservations WHERE id = ?",
		[reservationId],
	);
	if (!row) throw new Error("credit reservation not found");
	return row.account_id;
}

export async function captureCredits(
	input: {
		reservationId: string;
		credits: number;
		usageRecords?: UsageRecordInput[];
		idempotencyKey: string;
		description?: string;
		metadata?: Record<string, unknown>;
	},
	db: Db = openDb(),
): Promise<CreditReservation> {
	const replay = await replayed(db, input.idempotencyKey);
	if (replay) return replay;
	const accountId = await reservationAccount(db, input.reservationId);
	return db.transaction(async (tx) => {
		await serialize(tx, accountLock(accountId));
		const again = await replayed(tx, input.idempotencyKey);
		if (again) return again;
		const reservation = await tx.get<CreditReservation>(
			"SELECT * FROM credit_reservations WHERE id = ?",
			[input.reservationId],
		);
		if (!reservation) throw new Error("credit reservation not found");
		if (reservation.status !== "active")
			throw new Error(`credit reservation is ${reservation.status}`);
		const amount = credits(input.credits);
		const remaining = reservation.reserved_credits - reservation.captured_credits;
		if (amount > remaining) throw new Error("capture exceeds remaining reservation");
		const ts = nowMs();
		await tx.run(
			"UPDATE credit_accounts SET reserved_credits = reserved_credits - ?, updated_at = ? WHERE id = ?",
			[amount, ts, reservation.account_id],
		);
		await tx.run(
			"UPDATE credit_reservations SET captured_credits = captured_credits + ?, status = CASE WHEN captured_credits + ? >= reserved_credits THEN 'captured' ELSE status END, updated_at = ? WHERE id = ?",
			[amount, amount, ts, reservation.id],
		);
		for (const record of input.usageRecords ?? []) {
			await tx.run(
				`INSERT INTO usage_records
				 (id, account_id, reservation_id, operation, provider, model, quantity, unit, provider_cost_usd, charged_credits, pricing_version, metadata_json, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					randomUUID(),
					reservation.account_id,
					reservation.id,
					record.operation,
					record.provider ?? null,
					record.model ?? null,
					record.quantity,
					record.unit,
					record.providerCostUsd ?? 0,
					credits(record.chargedCredits),
					record.pricingVersion ?? "2026-07-15",
					metadataJson(record.metadata),
					ts,
				],
			);
		}
		await insertTransaction(tx, {
			account: await accountById(tx, reservation.account_id),
			type: "capture",
			amountCredits: -amount,
			referenceType: "credit_reservation",
			referenceId: reservation.id,
			idempotencyKey: input.idempotencyKey,
			description: input.description ?? `Captured ${amount} credits`,
			metadata: input.metadata,
			createdAt: ts,
		});
		return readBack(
			await tx.get<CreditReservation>("SELECT * FROM credit_reservations WHERE id = ?", [
				reservation.id,
			]),
			"credit_reservations",
		);
	});
}

export async function releaseCredits(
	input: {
		reservationId: string;
		credits?: number;
		idempotencyKey: string;
		description?: string;
		metadata?: Record<string, unknown>;
	},
	db: Db = openDb(),
): Promise<CreditReservation> {
	const replay = await replayed(db, input.idempotencyKey);
	if (replay) return replay;
	const accountId = await reservationAccount(db, input.reservationId);
	return db.transaction(async (tx) => {
		await serialize(tx, accountLock(accountId));
		const again = await replayed(tx, input.idempotencyKey);
		if (again) return again;
		const reservation = await tx.get<CreditReservation>(
			"SELECT * FROM credit_reservations WHERE id = ?",
			[input.reservationId],
		);
		if (!reservation) throw new Error("credit reservation not found");
		if (reservation.status !== "active") return reservation;
		const remaining = reservation.reserved_credits - reservation.captured_credits;
		const amount = input.credits == null ? remaining : credits(input.credits);
		if (amount > remaining) throw new Error("release exceeds remaining reservation");
		const ts = nowMs();
		await tx.run(
			"UPDATE credit_accounts SET available_credits = available_credits + ?, reserved_credits = reserved_credits - ?, updated_at = ? WHERE id = ?",
			[amount, amount, ts, reservation.account_id],
		);
		await tx.run(
			"UPDATE credit_reservations SET status = CASE WHEN captured_credits + ? >= reserved_credits THEN 'captured' ELSE 'released' END, updated_at = ? WHERE id = ?",
			[amount, ts, reservation.id],
		);
		await insertTransaction(tx, {
			account: await accountById(tx, reservation.account_id),
			type: "release",
			amountCredits: amount,
			referenceType: "credit_reservation",
			referenceId: reservation.id,
			idempotencyKey: input.idempotencyKey,
			description: input.description ?? `Released ${amount} credits`,
			metadata: input.metadata,
			createdAt: ts,
		});
		return readBack(
			await tx.get<CreditReservation>("SELECT * FROM credit_reservations WHERE id = ?", [
				reservation.id,
			]),
			"credit_reservations",
		);
	});
}

export async function getCreditSummary(
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	db: Db = openDb(),
): Promise<CreditSummary> {
	const account = await getOrCreateCreditAccount(scopeType, scopeId, db);
	const usage = await getCreditUsageWindow(account.id, db);
	const policy = await getCreditPolicy(scopeType, scopeId, db);
	const dailyLimit = policy.dailyLimitCredits ?? null;
	const rollingLimit = policy.rolling5hLimitCredits ?? null;
	return {
		account,
		policy,
		...usage,
		dailyRemainingCredits:
			dailyLimit == null ? null : Math.max(0, Number(dailyLimit) - usage.dailyUsedCredits),
		rolling5hRemainingCredits:
			rollingLimit == null ? null : Math.max(0, Number(rollingLimit) - usage.rolling5hUsedCredits),
		dailyRefreshAt: dailyRefreshAt(),
		rolling5hRefreshAt: await rolling5hRefreshAt(account.id, db),
		enforcementEnabled: creditEnforcementEnabled(),
	};
}

export async function listCreditTransactions(
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	limit = 50,
	db: Db = openDb(),
): Promise<CreditTransaction[]> {
	const account = await getOrCreateCreditAccount(scopeType, scopeId, db);
	return db.all<CreditTransaction>(
		"SELECT * FROM credit_transactions WHERE account_id = ? ORDER BY created_at DESC LIMIT ?",
		[account.id, Math.max(1, Math.min(200, Math.floor(limit)))],
	);
}

export async function listUsageRecords(
	scopeType: CreditScopeType = DEFAULT_SCOPE_TYPE,
	scopeId = DEFAULT_SCOPE_ID,
	limit = 50,
	db: Db = openDb(),
): Promise<CreditUsageRecord[]> {
	const account = await getOrCreateCreditAccount(scopeType, scopeId, db);
	return db.all<CreditUsageRecord>(
		"SELECT * FROM usage_records WHERE account_id = ? ORDER BY created_at DESC LIMIT ?",
		[account.id, Math.max(1, Math.min(200, Math.floor(limit)))],
	);
}

export async function recordUsage(
	input: {
		scopeType?: CreditScopeType;
		scopeId?: string;
		reservationId?: string | null;
		record: UsageRecordInput;
		/** Written once per key: a repeat returns the first record. */
		idempotencyKey?: string;
	},
	db: Db = openDb(),
): Promise<CreditUsageRecord> {
	const account = await getOrCreateCreditAccount(input.scopeType, input.scopeId, db);
	const id = randomUUID();
	const ts = nowMs();
	await db.run(
		`INSERT INTO usage_records
		 (id, account_id, reservation_id, operation, provider, model, quantity, unit, provider_cost_usd, charged_credits, pricing_version, metadata_json, created_at, idempotency_key)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,
		[
			id,
			account.id,
			input.reservationId ?? null,
			input.record.operation,
			input.record.provider ?? null,
			input.record.model ?? null,
			input.record.quantity,
			input.record.unit,
			input.record.providerCostUsd ?? 0,
			credits(input.record.chargedCredits),
			input.record.pricingVersion ?? "2026-07-15",
			metadataJson(input.record.metadata),
			ts,
			input.idempotencyKey ?? null,
		],
	);
	const written = input.idempotencyKey
		? await db.get<CreditUsageRecord>("SELECT * FROM usage_records WHERE idempotency_key = ?", [
				input.idempotencyKey,
			])
		: await db.get<CreditUsageRecord>("SELECT * FROM usage_records WHERE id = ?", [id]);
	return readBack(written, "usage_records");
}

export function creditEnforcementEnabled(): boolean {
	return (process.env.MALEO_CREDITS_ENFORCE ?? "").trim() === "1";
}

/* A retried operation reuses its key and so its reservation and capture — unless
 * that attempt failed and gave its reservation back, which makes the retry a new
 * attempt: its key and reference carry this suffix. */
async function attemptSuffix(key: string, db: Db = openDb()): Promise<string> {
	for (let attempt = 1; ; attempt++) {
		const suffix = attempt === 1 ? "" : `:attempt-${attempt}`;
		if (!(await replayed(db, `${key}${suffix}:failed-release`))) return suffix;
	}
}

export async function runBillableOperation<T>(input: BillableOperationInput<T>): Promise<T> {
	const chargedCredits = credits(input.usageRecord.chargedCredits ?? input.quote.estimatedCredits);
	if (!creditEnforcementEnabled()) {
		const result = await input.run();
		await recordUsage({
			scopeType: input.scopeType,
			scopeId: input.scopeId,
			idempotencyKey: input.idempotencyKey,
			record: {
				...input.usageRecord,
				chargedCredits,
				pricingVersion: input.usageRecord.pricingVersion ?? input.quote.pricingVersion,
			},
		});
		return result;
	}
	const suffix = await attemptSuffix(input.idempotencyKey);
	const key = `${input.idempotencyKey}${suffix}`;
	const reservation = await reserveCredits({
		scopeType: input.scopeType,
		scopeId: input.scopeId,
		credits: input.quote.maximumCredits,
		referenceType: input.referenceType,
		referenceId: `${input.referenceId}${suffix}`,
		idempotencyKey: `${key}:reserve`,
		description: `Reserve ${input.quote.operation} generation`,
		metadata: { quote: input.quote },
	});
	try {
		const result = await input.run();
		await captureCredits({
			reservationId: reservation.id,
			credits: chargedCredits,
			idempotencyKey: `${key}:capture`,
			usageRecords: [
				{
					...input.usageRecord,
					chargedCredits,
					pricingVersion: input.usageRecord.pricingVersion ?? input.quote.pricingVersion,
				},
			],
		});
		await releaseCredits({ reservationId: reservation.id, idempotencyKey: `${key}:release` });
		return result;
	} catch (err) {
		await releaseCredits({
			reservationId: reservation.id,
			idempotencyKey: `${key}:failed-release`,
			description: "Released failed generation reservation",
		});
		throw err;
	}
}
