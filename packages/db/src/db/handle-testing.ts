/* A handle on an isolated database of either engine, for tests.
 *
 * TEST SUPPORT ONLY. A family module ported to the async handle is tested on
 * both engines while the runtime still opens SQLite; `ENGINES` goes to one
 * entry when the SQLite path is deleted. */
import { Database } from "bun:sqlite";
import { pgDb, sqliteDb, type Db } from "./handle.ts";
import { createTestDatabase } from "./pg-testing.ts";
import { applyUnifiedSchema } from "./unified-schema.ts";

export const ENGINES = ["postgres", "sqlite"] as const;
export type Engine = (typeof ENGINES)[number];

export interface TestDb {
	db: Db;
	close(): Promise<void>;
}

export async function openTestDb(
	engine: Engine,
	options: { migrated?: boolean } = {},
): Promise<TestDb> {
	const migrated = options.migrated ?? true;
	if (engine === "postgres") {
		const t = await createTestDatabase({ migrated });
		return { db: pgDb(t.sql), close: t.drop };
	}
	const database = new Database(":memory:");
	if (migrated) applyUnifiedSchema(database);
	return {
		db: sqliteDb(database),
		close: async () => database.close(),
	};
}
