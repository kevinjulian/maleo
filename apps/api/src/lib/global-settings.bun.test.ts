import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createTestDatabase } from "@maleo/db/pg-testing";
import { pgDb } from "@maleo/db/handle";
import { createSql } from "@maleo/db/pg";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { getGlobalImageProvider, setGlobalImageProvider } from "@maleo/db/global-settings";
import { readTextProviderSelection, writeTextProviderSelection } from "./text-provider-settings.ts";

const dbPath = join(tmpdir(), "maleo-global-settings.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

describe("workspace image provider setting", () => {
	test("persists provider selection across a new connection to the same database", async () => {
		const database = await createTestDatabase();
		try {
			await setGlobalImageProvider("sandbox", pgDb(database.sql));
			const second = createSql(database.url, { max: 1 });
			try {
				expect(await getGlobalImageProvider(pgDb(second))).toBe("sandbox");
			} finally {
				await second.end();
			}
		} finally {
			await database.drop();
		}
	});

	test("null clears the workspace override", async () => {
		await setGlobalImageProvider("cloudflare-ai");
		await setGlobalImageProvider(null);
		expect(await getGlobalImageProvider()).toBeUndefined();
	});
});

describe("text provider setting", () => {
	test("a selection is stored and read back as written", async () => {
		await writeTextProviderSelection({ providerId: "api", model: "gpt-5-mini", thinking: "low" });
		expect(await readTextProviderSelection()).toEqual({
			default: { providerId: "api", model: "gpt-5-mini", thinking: "low" },
		});
	});
});
