/* Spend goes through one module.
 *
 * Before this, the agent path billed the credit ledger and the route path checked
 * a per-workspace quota, and neither could see the other: a route generation never
 * reached the ledger, an agent generation never counted against the quota, and the
 * price of an image was a literal in three different places. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { putWorkspaceConfigText } from "@maleo/db/workspace-config";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { listUsageRecords } from "../credit-service.ts";
import { PRICES, providerCostUsd, quoteFor, unitFor } from "./prices.ts";
import { meter, QuotaExceededError } from "./meter.ts";
import { synthesizeBilledTts } from "../generation/billed-tts.ts";

const priorDataDir = process.env.MALEO_DATA_DIR;

const testDbDir = join(tmpdir(), `maleo-metering-${randomUUID().slice(0, 8)}`);
const testDbPath = join(testDbDir, "maleo.db");

describe("the price table is the only place a price lives", () => {
	test("an image costs the same however it is quoted", () => {
		expect(providerCostUsd("image", 1)).toBe(0.04);
		expect(providerCostUsd("image", 3)).toBeCloseTo(0.12, 10);
	});

	test("speech is billed per character, with a floor for very short lines", () => {
		expect(unitFor("audio")).toBe("character");
		expect(providerCostUsd("audio", 10_000)).toBeCloseTo(0.15, 10);
		expect(providerCostUsd("audio", 1)).toBe(0.001);
	});

	test("a quote carries the reserve headroom, not just the estimate", () => {
		const quote = quoteFor({
			operation: "image",
			quantity: 1,
			provider: "image-service",
			model: "m",
		});
		expect(quote.estimatedCredits).toBeGreaterThan(0);
		expect(quote.maximumCredits).toBeGreaterThanOrEqual(quote.estimatedCredits);
	});

	test("video is billed per second of output", () => {
		expect(unitFor("video")).toBe("second");
		expect(providerCostUsd("video", 5)).toBeCloseTo(0.1, 10);
		// Floored like speech: a sub-second clip still costs a provider round-trip.
		expect(providerCostUsd("video", 0)).toBe(0.02);
	});

	test("every metered operation declares its multipliers", () => {
		for (const price of Object.values(PRICES)) {
			expect(price.markupMultiplier).toBeGreaterThan(1);
			expect(price.maximumMultiplier).toBeGreaterThanOrEqual(1);
		}
	});
});

describe("meter records what a run spent", () => {
	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		mkdirSync(dirname(testDbPath), { recursive: true });
		await closeMaleoDb();
		for (const suffix of ["", "-shm", "-wal"]) rmSync(`${testDbPath}${suffix}`, { force: true });
		openDb();
	});

	afterEach(async () => {
		await closeMaleoDb();
		delete process.env.MALEO_DB_PATH;
		if (existsSync(testDbDir)) rmSync(testDbDir, { recursive: true, force: true });
	});

	test("a successful image generation lands one usage record", async () => {
		const out = await meter({
			operation: "image",
			quantity: 1,
			provider: "image-service",
			model: "image-service+refs",
			reference: "image:scene",
			metadata: { scene: "S1" },
			run: async () => "https://cdn.test/a.png",
		});

		expect(out).toBe("https://cdn.test/a.png");
		const records = await listUsageRecords();
		expect(records).toHaveLength(1);
		expect(records[0]!.operation).toBe("image");
		expect(records[0]!.provider_cost_usd).toBe(0.04);
	});

	test("a failed generation records nothing", async () => {
		await expect(
			meter({
				operation: "image",
				quantity: 1,
				provider: "image-service",
				model: "image-service",
				reference: "image:scene",
				run: async () => {
					throw new Error("provider exploded");
				},
			}),
		).rejects.toThrow("provider exploded");

		expect(await listUsageRecords()).toHaveLength(0);
	});

	test("speech is metered by character count", async () => {
		await meter({
			operation: "audio",
			quantity: 500,
			provider: "kokoro",
			model: "default-voice",
			reference: "tts",
			run: async () => ({ bytes: new Uint8Array(), ext: "wav" }),
		});

		const record = (await listUsageRecords())[0]!;
		expect(record.unit).toBe("character");
		expect(record.quantity).toBe(500);
		expect(record.provider).toBe("kokoro");
	});
});

describe("the workspace quota gates the same call the ledger bills", () => {
	const dataDir = join(tmpdir(), `maleo-metering-data-${randomUUID().slice(0, 8)}`);
	const workspace = "acme";

	beforeEach(async () => {
		process.env.MALEO_DB_PATH = testDbPath;
		process.env.MALEO_DATA_DIR = dataDir;
		mkdirSync(join(dataDir, "workspaces", workspace), { recursive: true });
		mkdirSync(dirname(testDbPath), { recursive: true });
		await closeMaleoDb();
		for (const suffix of ["", "-shm", "-wal"]) rmSync(`${testDbPath}${suffix}`, { force: true });
		openDb();
	});

	afterEach(async () => {
		await closeMaleoDb();
		delete process.env.MALEO_DB_PATH;
		// Restore, never delete: the guard pins this to a temp dir, and removing it
		// sends every later suite back to <repo>/data.
		process.env.MALEO_DATA_DIR = priorDataDir;
		for (const dir of [dataDir, testDbDir])
			if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
	});

	const writePolicy = (policy: Record<string, unknown>): Promise<void> =>
		putWorkspaceConfigText(
			workspace,
			`image_policy:\n${Object.entries(policy)
				.map(([k, v]) => `  ${k}: ${String(v)}`)
				.join("\n")}\n`,
		);

	test("a workspace inside its limits generates and is billed", async () => {
		await writePolicy({ daily_limit: 5, cost_per_image_usd: 0.04 });

		const out = await meter({
			operation: "image",
			quantity: 1,
			provider: "image-service",
			model: "image-service",
			reference: "image:scene",
			workspace,
			run: async () => "ok",
		});

		expect(out).toBe("ok");
		// The route path used to bypass the ledger entirely; now the same call that
		// passes the quota gate also lands a usage record — on the gated workspace's
		// own account, without the caller having to restate that as a `scope`.
		const billed = await listUsageRecords("workspace", workspace);
		expect(billed).toHaveLength(1);
		expect(JSON.parse(billed[0]!.metadata_json ?? "{}").workspace).toBe(workspace);
	});

	test("spend lands on the workspace's account, not the default one", async () => {
		await writePolicy({ daily_limit: 5 });

		await meter({
			operation: "image",
			quantity: 1,
			provider: "image-service",
			model: "image-service",
			reference: "image:scene",
			workspace,
			scope: { type: "workspace", id: workspace },
			run: async () => "ok",
		});

		// Every agent generation used to land here regardless of whose project it was.
		expect(await listUsageRecords("workspace", "local")).toHaveLength(0);
		expect(await listUsageRecords("workspace", workspace)).toHaveLength(1);
	});

	test("a workspace outside its allowed hours never runs the operation", async () => {
		// A one-hour window that never contains the hour this test runs in.
		const nextHour = (new Date().getHours() + 2) % 24;
		await writePolicy({ daily_limit: 0, allowed_hours: `[${nextHour}, ${(nextHour + 1) % 24}]` });
		let ran = false;

		await expect(
			meter({
				operation: "image",
				quantity: 1,
				provider: "image-service",
				model: "image-service",
				reference: "image:scene",
				workspace,
				run: async () => {
					ran = true;
					return "should not happen";
				},
			}),
		).rejects.toBeInstanceOf(QuotaExceededError);

		expect(ran).toBe(false);
		// Nothing ran, so nothing was billed.
		expect(await listUsageRecords()).toHaveLength(0);
	});

	/* Video generation reached fal.run directly: no ledger row, no quota, and no
	 * seam to test it through. It is the same generation as an image as far as a
	 * workspace's budget is concerned. */
	test("animating a frame is billed to the workspace that asked for it", async () => {
		await writePolicy({ daily_limit: 5 });
		expect(
			await meter({
				operation: "video",
				quantity: 4,
				provider: "fal",
				model: "test",
				reference: "video:animate",
				workspace,
				run: async () => "https://cdn.test/clip.mp4",
			}),
		).toBe("https://cdn.test/clip.mp4");

		const record = (await listUsageRecords("workspace", workspace))[0]!;
		expect(record.operation).toBe("video");
		expect(record.unit).toBe("second");
		expect(record.quantity).toBe(4);
	});

	test("a workspace out of quota cannot animate a frame either", async () => {
		const nextHour = (new Date().getHours() + 2) % 24;
		await writePolicy({ daily_limit: 0, allowed_hours: `[${nextHour}, ${(nextHour + 1) % 24}]` });
		let reached = false;
		await expect(
			meter({
				operation: "video",
				quantity: 4,
				provider: "fal",
				model: "test",
				reference: "video:animate",
				workspace,
				run: async () => {
					reached = true;
					return "should not happen";
				},
			}),
		).rejects.toBeInstanceOf(QuotaExceededError);
		expect(reached).toBe(false);
		expect(await listUsageRecords()).toHaveLength(0);
	});

	/* Speech is gated by the same call that bills it. `synthesizeBilledTts` used to
	 * pass `scope` without `workspace`, so it charged a workspace's ledger without
	 * ever asking whether that workspace had a generation left — and the agent's
	 * short-form voiceovers skipped the price table too, quoting the audio row from
	 * five literals of their own. The refusal is asserted rather than the success
	 * case because a refused run never reaches the provider. */
	test("a workspace out of quota cannot synthesize speech either", async () => {
		const nextHour = (new Date().getHours() + 2) % 24;
		await writePolicy({ daily_limit: 0, allowed_hours: `[${nextHour}, ${(nextHour + 1) % 24}]` });

		await expect(
			synthesizeBilledTts({ text: "a line of narration", workspace }),
		).rejects.toBeInstanceOf(QuotaExceededError);

		expect(await listUsageRecords()).toHaveLength(0);
	});
});
