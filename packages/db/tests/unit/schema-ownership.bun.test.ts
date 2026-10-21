/* The migration sequence declares every table and column — nobody adds one
 * behind its back.
 *
 * On 2026-07-30 the `content_projects` rebuild destroyed `editor_state_json` for
 * 141 projects (2,883 chat messages). The column was real on disk but invisible
 * to the schema: `openMaleoDb` ALTER-added it outside the declaration, so the
 * rebuild reconstructed a shape that had never heard of it. Schema looked
 * healthy; data was gone.
 *
 * The declaration is now the ordered migration sequence rather than a block
 * reconciled at every open, and these tests pin the same property against it:
 * the tables a database has are exactly the tables the sequence creates, plus
 * the auth library's own, listed by name. */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { loadMigrations, MIGRATIONS_TABLE } from "../../src/db/migrate.ts";
import { createTestDatabase, type TestDatabase } from "../../src/db/pg-testing.ts";
import {
	AUTH_OWNED_TABLES,
	AUTH_TABLE_PREFIX,
	RUNTIME_TABLES,
	tablesCreatedBy,
	unownedTables,
} from "../../src/db/schema.ts";

const REPO = join(import.meta.dir, "../../../..");

let db: TestDatabase;
beforeAll(async () => {
	db = await createTestDatabase();
});
afterAll(async () => {
	await db.drop();
});

async function tableNames(target: TestDatabase = db): Promise<string[]> {
	const rows = await target.sql<{ table_name: string }[]>`
		SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`;
	return rows.map((r) => r.table_name);
}

/* Stand-ins for what better-auth's migrator produces. The real library is not a
 * dependency of @maleo/db and must not become one — this package owns the
 * boundary, not the thing on the other side of it. */
async function createAuthTables(target: TestDatabase): Promise<void> {
	await target.sql.unsafe(`
		CREATE TABLE auth_user (id text PRIMARY KEY, email text NOT NULL, name text);
		CREATE TABLE auth_session (id text PRIMARY KEY, user_id text NOT NULL, expires_at bigint);
		CREATE TABLE auth_account (id text PRIMARY KEY, user_id text NOT NULL, password text);
		CREATE TABLE auth_verification (id text PRIMARY KEY, identifier text NOT NULL);
	`);
}

describe("the migration sequence declares every table", () => {
	test("the runtime table list is exactly what the migrations leave in place", async () => {
		const onDisk = (await tableNames()).filter((t) => t !== MIGRATIONS_TABLE);
		expect([...RUNTIME_TABLES].sort()).toEqual(onDisk);
	});

	test("the list is derived from the sequence, so a table a migration adds appears without a second edit", () => {
		const extended = [
			...loadMigrations(),
			{ version: 9999, name: "probe", sql: "CREATE TABLE probe_table (id text PRIMARY KEY);" },
		];
		expect(tablesCreatedBy(extended)).toEqual([...RUNTIME_TABLES, "probe_table"]);
		const dropped = [...extended, { version: 10000, name: "drop", sql: "DROP TABLE probe_table;" }];
		expect(tablesCreatedBy(dropped)).toEqual([...RUNTIME_TABLES]);
	});

	test("content_projects declares editor_state_json", async () => {
		const cols = await db.sql<{ column_name: string }[]>`
			SELECT column_name FROM information_schema.columns WHERE table_name = 'content_projects'`;
		expect(cols.map((c) => c.column_name)).toContain("editor_state_json");
	});

	test("the credit tables are migration-owned, not created by credit-service", () => {
		const source = readFileSync(join(REPO, "apps/api/src/lib/credit-service.ts"), "utf8");
		expect(source).not.toContain("CREATE TABLE");
		for (const table of [
			"credit_accounts",
			"credit_policies",
			"credit_reservations",
			"credit_transactions",
			"usage_records",
		]) {
			expect(RUNTIME_TABLES).toContain(table);
		}
	});
});

/* Source files that may legitimately create a table or add a column, each for a
 * stated reason. Everything else that does is a schema change outside the
 * sequence. */
const DDL_ALLOWED = new Map<string, string>([
	["packages/db/src/db/migrate.ts", "creates its own bookkeeping table"],
	["packages/db/src/db/unified-schema.ts", "the SQLite declaration, retired with the SQLite path"],
	[
		"packages/media/src/generation/store.ts",
		"the media worker's process-local job store, not the runtime database",
	],
]);

function sourceFiles(dir: string): string[] {
	const out: string[] = [];
	for (const entry of readdirSync(dir)) {
		if (entry.startsWith(".") || entry === "node_modules" || entry === "dist") continue;
		const path = join(dir, entry);
		const stat = statSync(path, { throwIfNoEntry: false });
		if (!stat) continue;
		if (stat.isDirectory()) out.push(...sourceFiles(path));
		else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(path);
	}
	return out;
}

describe("nothing creates a table or adds a column outside the sequence", () => {
	test("no runtime source outside the allowlist issues CREATE TABLE or ADD COLUMN", () => {
		const roots = [
			"packages/db/src",
			"apps/api/src",
			"packages/media/src",
			"packages/inngest/src",
			"apps/web/src",
		];
		const offenders = roots
			.flatMap((root) => sourceFiles(join(REPO, root)))
			.map((file) => relative(REPO, file))
			.filter((file) => !DDL_ALLOWED.has(file))
			.flatMap((file) =>
				readFileSync(join(REPO, file), "utf8")
					.split("\n")
					.map((line, i) => ({ line: line.trim(), at: `${file}:${i + 1}` }))
					.filter((l) => /\bCREATE TABLE\b|\bADD COLUMN\b/i.test(l.line))
					.map((l) => `${l.at}: ${l.line}`),
			);
		expect(offenders).toEqual([]);
	});

	test("a database the auth migrator has touched is still fully accounted for", async () => {
		const target = await createTestDatabase();
		try {
			await createAuthTables(target);
			expect(unownedTables(await tableNames(target))).toEqual([]);
		} finally {
			await target.drop();
		}
	});

	test("a table under the auth prefix that nobody declared is a violation", async () => {
		const target = await createTestDatabase();
		try {
			await createAuthTables(target);
			// What a library upgrade looks like on disk. The exemption is a list, so
			// this must surface rather than be forgiven by its prefix.
			await target.sql.unsafe(
				`CREATE TABLE ${AUTH_TABLE_PREFIX}passkey (id text PRIMARY KEY, user_id text NOT NULL)`,
			);
			expect(unownedTables(await tableNames(target))).toEqual(["auth_passkey"]);
		} finally {
			await target.drop();
		}
	});

	test("no schema-owned table has a foreign key into an auth-owned table", async () => {
		const target = await createTestDatabase();
		try {
			await createAuthTables(target);
			const crossing = await target.sql<{ source: string; referenced: string }[]>`
				SELECT src.relname AS source, ref.relname AS referenced
				FROM pg_constraint con
				JOIN pg_class src ON src.oid = con.conrelid
				JOIN pg_class ref ON ref.oid = con.confrelid
				WHERE con.contype = 'f'`;
			// The two schemas migrate independently. A constraint across that line
			// makes one migrator's ordering the other's problem.
			expect(
				crossing
					.filter(
						(c) => RUNTIME_TABLES.includes(c.source) && AUTH_OWNED_TABLES.includes(c.referenced),
					)
					.map((c) => `${c.source} -> ${c.referenced}`),
			).toEqual([]);
		} finally {
			await target.drop();
		}
	});

	test("workspace_members is schema-owned, not exempt, and borrows the account id without a foreign key", async () => {
		expect(RUNTIME_TABLES).toContain("workspace_members");
		expect(AUTH_OWNED_TABLES).not.toContain("workspace_members");
		expect(unownedTables(["workspace_members"])).toEqual([]);

		const cols = await db.sql<{ column_name: string }[]>`
			SELECT column_name FROM information_schema.columns WHERE table_name = 'workspace_members' ORDER BY column_name`;
		expect(cols.map((c) => c.column_name)).toEqual(["created_at", "role", "user_id", "workspace"]);
		const fks = await db.sql`
			SELECT 1 FROM pg_constraint con JOIN pg_class t ON t.oid = con.conrelid
			WHERE t.relname = 'workspace_members' AND con.contype = 'f'`;
		expect(fks.length).toBe(0);
	});
});
