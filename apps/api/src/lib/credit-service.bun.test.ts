import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, runtimeSql } from "@maleo/db/connection";
import {
	captureCredits,
	checkCreditLimit,
	getCreditSummary,
	grantCredits,
	listUsageRecords,
	releaseCredits,
	reserveCredits,
	runBillableOperation,
	setCreditPolicy,
	quoteCreditUsage,
} from "./credit-service.ts";

const testDbDir = join(tmpdir(), "maleo-dashboard-credit-tests");
const testDbPath = join(testDbDir, "credits.db");

async function resetDbFile(): Promise<void> {
	await closeMaleoDb();
	rmSync(testDbPath, { force: true });
	rmSync(`${testDbPath}-shm`, { force: true });
	rmSync(`${testDbPath}-wal`, { force: true });
}

describe("credit-service", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await resetDbFile();
	});

	afterEach(async () => {
		delete process.env.MALEO_CREDITS_ENFORCE;
		await resetDbFile();
		if (existsSync(testDbDir)) rmSync(testDbDir, { recursive: true, force: true });
	});

	/* Captures racing on one reservation, each within the remainder alone but
	 * not together. SQLite's single writer serialised these; on Postgres the
	 * account lock does. A blocker holds the account row while the racers start,
	 * so without that lock every racer would pass its "remaining" check against
	 * the same stale reservation and then queue on the row — deterministically,
	 * rather than whenever the scheduler happens to interleave them. */
	test("concurrent captures cannot overdraw a reservation", async () => {
		await grantCredits({ credits: 1000, idempotencyKey: "grant:race", description: "seed" });
		const reservation = await reserveCredits({
			credits: 100,
			referenceType: "tool_run",
			referenceId: "race-1",
			idempotencyKey: "reserve:race-1",
		});
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const blocker = (await runtimeSql()).begin(async (tx) => {
			await tx.unsafe("UPDATE credit_accounts SET updated_at = updated_at WHERE id = $1", [
				reservation.account_id,
			]);
			await gate;
		});
		const racers = Promise.allSettled(
			[0, 1, 2].map((i) =>
				captureCredits({
					reservationId: reservation.id,
					credits: 60,
					idempotencyKey: `capture:race-${i}`,
				}),
			),
		);
		await Bun.sleep(300); // let every racer reach the account row
		release();
		await blocker;
		const results = await racers;
		expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
		const summary = await getCreditSummary();
		expect(summary.account.reserved_credits).toBe(40);
		expect(summary.account.available_credits).toBe(900);
	});

	test("reserves, captures usage, and releases unused credits", async () => {
		await grantCredits({ credits: 1000, idempotencyKey: "grant:test", description: "seed" });
		const reservation = await reserveCredits({
			credits: 300,
			referenceType: "tool_run",
			referenceId: "image-1",
			idempotencyKey: "reserve:image-1",
		});

		let summary = await getCreditSummary();
		expect(summary.account.available_credits).toBe(700);
		expect(summary.account.reserved_credits).toBe(300);

		const captured = await captureCredits({
			reservationId: reservation.id,
			credits: 240,
			idempotencyKey: "capture:image-1",
			usageRecords: [
				{
					operation: "image",
					provider: "cloudflare-ai",
					model: "@cf/black-forest-labs/flux-2-klein-4b",
					quantity: 1,
					unit: "image",
					providerCostUsd: 0.04,
					chargedCredits: 240,
				},
			],
		});
		expect(captured.captured_credits).toBe(240);

		await releaseCredits({ reservationId: reservation.id, idempotencyKey: "release:image-1" });
		summary = await getCreditSummary();
		expect(summary.account.available_credits).toBe(760);
		expect(summary.account.reserved_credits).toBe(0);
		expect(summary.dailyUsedCredits).toBe(240);
		expect(await listUsageRecords()).toHaveLength(1);
	});

	test("enforces rolling 5-hour limit on new reservations", async () => {
		await setCreditPolicy({
			dailyLimitCredits: 1000,
			rolling5hLimitCredits: 200,
			perRunLimitCredits: 500,
			requireApprovalAboveCredits: null,
		});
		await grantCredits({ credits: 1000, idempotencyKey: "grant:test" });
		const reservation = await reserveCredits({
			credits: 200,
			referenceType: "tool_run",
			referenceId: "audio-1",
			idempotencyKey: "reserve:audio-1",
		});
		await captureCredits({
			reservationId: reservation.id,
			credits: 200,
			idempotencyKey: "capture:audio-1",
			usageRecords: [{ operation: "audio", quantity: 10, unit: "second", chargedCredits: 200 }],
		});
		const decision = await checkCreditLimit({ requestedCredits: 1 });
		expect(decision.ok).toBe(false);
		expect(decision.reason).toBe("rolling_5h_limit");
	});

	test("billable operation records usage in observe mode without requiring balance", async () => {
		const result = await runBillableOperation({
			referenceType: "tool_run",
			referenceId: "llm-1",
			idempotencyKey: "llm-1",
			quote: quoteCreditUsage({
				operation: "llm",
				quantity: 100,
				unit: "estimated_token",
				providerCostUsd: 0.002,
			}),
			usageRecord: { operation: "llm", quantity: 100, unit: "estimated_token", chargedCredits: 3 },
			run: async () => "ok",
		});
		expect(result).toBe("ok");
		expect((await listUsageRecords())[0]?.charged_credits).toBe(3);
	});

	test("billable operation reserves and releases when enforcement is enabled", async () => {
		process.env.MALEO_CREDITS_ENFORCE = "1";
		await grantCredits({ credits: 100, idempotencyKey: "grant:enforce" });
		const result = await runBillableOperation({
			referenceType: "tool_run",
			referenceId: "audio-2",
			idempotencyKey: "audio-2",
			quote: {
				...quoteCreditUsage({
					operation: "audio",
					quantity: 10,
					unit: "character",
					providerCostUsd: 0.001,
				}),
				estimatedCredits: 10,
				maximumCredits: 12,
			},
			usageRecord: { operation: "audio", quantity: 10, unit: "character", chargedCredits: 10 },
			run: async () => "audio",
		});
		expect(result).toBe("audio");
		const summary = await getCreditSummary();
		expect(summary.account.available_credits).toBe(90);
		expect(summary.account.reserved_credits).toBe(0);
		expect(summary.dailyUsedCredits).toBe(10);
	});
});
