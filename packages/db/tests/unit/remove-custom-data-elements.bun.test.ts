/* Migration 0012: custom data elements are deleted, and nothing else is.
 *
 * Run against a database migrated to the version before this one, seeded with
 * one custom element of each relevant shape, because the property is about what
 * survives. */
import { afterEach, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../../src/db/pg-testing.ts";
import { loadMigrations, migrate } from "../../src/db/migrate.ts";

const VERSION = 12;
const opened: TestDatabase[] = [];
afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.drop()));
});

const NOW = 1_700_000_000_000;

async function seeded(): Promise<TestDatabase> {
	const db = await createTestDatabase({ migrated: false });
	opened.push(db);
	await migrate(
		db.sql,
		loadMigrations().filter((migration) => migration.version < VERSION),
	);
	const element = (id: string, kind: string, category: string) => db.sql`
		INSERT INTO content_clip_templates (id, kind, label, intent, category, base, config_json, created_at, updated_at)
		VALUES (${id}, ${kind}, ${id}, '', ${category}, 'title', '{}', ${NOW}, ${NOW})`;
	await element("data-1", "data", "data");
	await element("text-1", "text", "text");
	await element("text-filed-as-data", "text", "data");
	return db;
}

const rows = async (db: TestDatabase) => [
	...(await db.sql<
		{ id: string; kind: string; category: string }[]
	>`SELECT id, kind, category FROM content_clip_templates ORDER BY id`),
];

describe("removing custom data elements", () => {
	test("only the data element is deleted", async () => {
		const db = await seeded();
		await migrate(db.sql, loadMigrations());
		expect((await rows(db)).map((row) => row.id)).toEqual(["text-1", "text-filed-as-data"]);
	});

	test("a text element filed under the data category moves to text", async () => {
		const db = await seeded();
		await migrate(db.sql, loadMigrations());
		expect(await rows(db)).toEqual([
			{ id: "text-1", kind: "text", category: "text" },
			{ id: "text-filed-as-data", kind: "text", category: "text" },
		]);
	});
});
