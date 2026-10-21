/* The workspace_settings → global_settings rename, verified against a populated
 * database rather than a fresh one.
 *
 * The failure this guards against is silent by construction: the schema uses
 * CREATE TABLE IF NOT EXISTS, so without the guarded ALTER an existing database
 * gets an empty `global_settings` alongside the populated `workspace_settings`,
 * and every stored setting reads back as `undefined` with nothing thrown and
 * nothing logged. A fresh-database test cannot see that — it has no rows to
 * strand — which is why the populated case is the one that matters here. */
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema } from "../../src/db/unified-schema.ts";
import { sqliteDb } from "../../src/db/handle.ts";
import { getGlobalSetting, setGlobalSetting } from "../../src/db/global-settings.ts";

function tableNames(db: Database): string[] {
	return (
		db.query(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`).all() as {
			name: string;
		}[]
	).map((r) => r.name);
}

// A database as it stood before this change: the old table name, with rows.
function populatedLegacyDb(): Database {
	const db = new Database(":memory:");
	db.exec(`
		CREATE TABLE workspace_settings (
		  key TEXT PRIMARY KEY,
		  value TEXT NOT NULL,
		  updated_at INTEGER NOT NULL
		);
	`);
	db.run(
		`INSERT INTO workspace_settings (key, value, updated_at) VALUES (?, ?, ?)`,
		// A provider that still exists, so the rename tests below measure the rename
		// rather than the retired-provider cleanup that also runs during apply.
		["media.provider.image", "cloudflare-ai", 1_700_000_000_000],
	);
	db.run(`INSERT INTO workspace_settings (key, value, updated_at) VALUES (?, ?, ?)`, [
		"content.preset.default",
		"preset-abc",
		1_700_000_000_001,
	]);
	return db;
}

describe("global_settings migration on a populated database", () => {
	test("every stored setting survives the rename", async () => {
		const db = populatedLegacyDb();
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBe("cloudflare-ai");
		expect(await getGlobalSetting("content.preset.default", sqliteDb(db))).toBe("preset-abc");
		db.close();
	});

	test("no empty duplicate table is left behind", () => {
		const db = populatedLegacyDb();
		applyUnifiedSchema(db);

		const names = tableNames(db);
		expect(names).toContain("global_settings");
		// The whole point of the guard: the old name must be gone, not shadowed.
		expect(names).not.toContain("workspace_settings");
		db.close();
	});

	test("updated_at is preserved, so the rename is not a rewrite", () => {
		const db = populatedLegacyDb();
		applyUnifiedSchema(db);

		const row = db
			.query(`SELECT updated_at FROM global_settings WHERE key = ?`)
			.get("media.provider.image") as { updated_at: number };
		expect(row.updated_at).toBe(1_700_000_000_000);
		db.close();
	});

	test("re-applying the schema is idempotent", async () => {
		const db = populatedLegacyDb();
		applyUnifiedSchema(db);
		applyUnifiedSchema(db);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBe("cloudflare-ai");
		expect(tableNames(db)).not.toContain("workspace_settings");
		db.close();
	});

	test("a database already carrying both tables keeps the new one untouched", async () => {
		// Defends the second half of the guard. If the ALTER ran here it would fail
		// outright; if the guard were absent in the other direction, live settings
		// could be clobbered by a stale legacy table.
		const db = populatedLegacyDb();
		db.exec(`
			CREATE TABLE global_settings (
			  key TEXT PRIMARY KEY,
			  value TEXT NOT NULL,
			  updated_at INTEGER NOT NULL
			);
		`);
		db.run(`INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)`, [
			"media.provider.image",
			"already-migrated",
			1_700_000_000_500,
		]);

		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBe("already-migrated");
		db.close();
	});
});

describe("global_settings on a fresh database", () => {
	test("creates only global_settings, never the legacy name", () => {
		const db = new Database(":memory:");
		applyUnifiedSchema(db);

		const names = tableNames(db);
		expect(names).toContain("global_settings");
		expect(names).not.toContain("workspace_settings");
		db.close();
	});

	test("reads and writes round-trip", async () => {
		const db = new Database(":memory:");
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("ai.text.provider", sqliteDb(db))).toBeUndefined();
		await setGlobalSetting("ai.text.provider", '{"default":{"providerId":"codex"}}', sqliteDb(db));
		expect(await getGlobalSetting("ai.text.provider", sqliteDb(db))).toBe(
			'{"default":{"providerId":"codex"}}',
		);
		// Clearing removes the row rather than storing an empty string.
		await setGlobalSetting("ai.text.provider", null, sqliteDb(db));
		expect(await getGlobalSetting("ai.text.provider", sqliteDb(db))).toBeUndefined();
		db.close();
	});
});

/* Retiring a provider strands whatever rows named it. The row was a valid choice
 * when it was made — the provider was removed underneath it — so it is cleared
 * rather than left to make the settings picker offer something that cannot run. */
describe("retired provider settings are cleared", () => {
	async function dbHolding(entries: [string, string][]): Promise<Database> {
		const db = new Database(":memory:");
		applyUnifiedSchema(db);
		for (const [key, value] of entries) await setGlobalSetting(key, value, sqliteDb(db));
		return db;
	}

	test("a persisted gemini-canvas image provider is removed", async () => {
		const db = await dbHolding([["media.provider.image", "gemini-canvas"]]);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBeUndefined();
		db.close();
	});

	test("a persisted gemini-canvas TTS provider is removed too", async () => {
		// The retired provider implemented both capabilities, so a tts row could
		// name it just as an image row could.
		const db = await dbHolding([["media.provider.tts", "gemini-canvas"]]);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.tts", sqliteDb(db))).toBeUndefined();
		db.close();
	});

	test("a persisted supertonic TTS provider is removed", async () => {
		const db = await dbHolding([["media.provider.tts", "supertonic"]]);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.tts", sqliteDb(db))).toBeUndefined();
		db.close();
	});

	test("a provider that still exists is left alone", async () => {
		const db = await dbHolding([["media.provider.image", "cloudflare-ai"]]);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBe("cloudflare-ai");
		db.close();
	});

	test("unrelated settings that happen to hold the same string are untouched", async () => {
		// Scoped by key prefix, not by value: a note or preset naming the retired
		// provider is text, not configuration.
		const db = await dbHolding([["content.preset.default", "gemini-canvas"]]);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("content.preset.default", sqliteDb(db))).toBe("gemini-canvas");
		db.close();
	});

	test("clearing is idempotent and safe on a database with nothing to clear", async () => {
		const db = await dbHolding([["media.provider.image", "cloudflare-ai"]]);
		applyUnifiedSchema(db);
		applyUnifiedSchema(db);

		expect(await getGlobalSetting("media.provider.image", sqliteDb(db))).toBe("cloudflare-ai");
		db.close();
	});
});
