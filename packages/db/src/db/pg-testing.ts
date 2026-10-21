/* Isolated Postgres databases for tests.
 *
 * TEST SUPPORT ONLY. One embedded server per test process, started on first use;
 * every call gets its own database, so a test sees no other test's rows and
 * needs no environment variable and no singleton reset.
 *
 * A migrated database is a clone of a template migrated once per process.
 * `STRATEGY file_copy` makes a clone a file copy (~64 ms in the spike) instead
 * of a WAL-logged one, which is what makes a database per test affordable. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadMigrations, migrate } from "./migrate.ts";
import { createSql, type Sql } from "./pg.ts";
import { freePort, startEmbeddedPostgres, type EmbeddedServer } from "./pg-embedded.ts";

export interface TestDatabase {
	sql: Sql;
	url: string;
	name: string;
	/** Close the pool and drop the database. */
	drop(): Promise<void>;
}

const TEMPLATE = "maleo_template";

let server: Promise<EmbeddedServer> | null = null;
let template: Promise<void> | null = null;
let counter = 0;

function testServer(): Promise<EmbeddedServer> {
	server ??= startEmbeddedPostgres({
		dir: mkdtempSync(join(tmpdir(), "maleo-test-pg-")),
		port: freePort(),
		ephemeral: true,
	});
	return server;
}

async function admin<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
	const sql = createSql((await testServer()).url("postgres"), { max: 1 });
	try {
		return await fn(sql);
	} finally {
		await sql.end();
	}
}

function migratedTemplate(): Promise<void> {
	template ??= (async () => {
		await admin((sql) => sql.unsafe(`CREATE DATABASE ${TEMPLATE}`));
		// Closed before any clone: a template with open connections cannot be copied.
		const sql = createSql((await testServer()).url(TEMPLATE), { max: 1 });
		try {
			await migrate(sql, loadMigrations());
		} finally {
			await sql.end();
		}
	})();
	return template;
}

export interface TestDatabaseOptions {
	/** false gives an empty database, for testing the migrations themselves. */
	migrated?: boolean;
}

export async function createTestDatabase(options: TestDatabaseOptions = {}): Promise<TestDatabase> {
	const migrated = options.migrated ?? true;
	if (migrated) await migratedTemplate();
	const name = `t_${process.pid}_${++counter}`;
	const source = migrated ? TEMPLATE : "template0";
	await admin((sql) => sql.unsafe(`CREATE DATABASE ${name} TEMPLATE ${source} STRATEGY file_copy`));
	const url = (await testServer()).url(name);
	const sql = createSql(url, { max: 4 });
	return {
		sql,
		url,
		name,
		drop: async () => {
			await sql.end();
			await admin((a) => a.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`));
		},
	};
}
