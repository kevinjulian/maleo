/* The one-time move from the SQLite runtime database into Postgres.
 *
 * Source: a SQLite file brought up to the last SQLite schema. Target: an
 * isolated, migrated Postgres database. What is pinned: row counts match and are
 * reported; an interrupted run finishes without duplicating; a value that cannot
 * be represented stops the run naming table, row and column; YAML workspaces are
 * carried, and a file that does not parse or validate stops the run naming it. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyUnifiedSchema } from "../packages/db/src/db/unified-schema.ts";
import { createTestDatabase, type TestDatabase } from "../packages/db/src/db/pg-testing.ts";
import { pgDb, type Db } from "../packages/db/src/db/handle.ts";
import { carryOver, CarryOverError } from "./migrate-to-postgres.ts";
import {
	assertVisualContractReady,
	VISUAL_CONTRACT_SETTING,
} from "../packages/db/src/db/visual-contract.ts";

let dir: string;
let source: Database;
let target: TestDatabase;
let db: Db;

const AUTH_DDL = `
	CREATE TABLE auth_user (id text PRIMARY KEY, name text NOT NULL, email text NOT NULL, "emailVerified" boolean NOT NULL,
	  image text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, role text);
	CREATE TABLE auth_session (id text PRIMARY KEY, "expiresAt" timestamptz NOT NULL, token text NOT NULL,
	  "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL, "ipAddress" text, "userAgent" text, "userId" text NOT NULL);
	CREATE TABLE auth_account (id text PRIMARY KEY, "accountId" text NOT NULL, "providerId" text NOT NULL, "userId" text NOT NULL,
	  "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz,
	  scope text, password text, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);
	CREATE TABLE auth_verification (id text PRIMARY KEY, identifier text NOT NULL, value text NOT NULL,
	  "expiresAt" timestamptz NOT NULL, "createdAt" timestamptz NOT NULL, "updatedAt" timestamptz NOT NULL);`;

function seedSource(): void {
	source.run(`INSERT INTO workspaces (name, display_name, status, workspace_dir, config_path, created_at, updated_at)
		VALUES ('acme', 'Acme', 'active', '/w/acme', '/w/acme/config.yaml', 1, 1)`);
	for (let i = 0; i < 25; i++) {
		source.run(
			`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
			VALUES (?, 'acme', ?, 'video', 'draft', ?, ?)`,
			[`p${i}`, `Project ${i}`, 1_759_999_999_000 + i, 1_759_999_999_000 + i],
		);
		source.run(
			`INSERT INTO content_storyboards (id, project_id, version, status, storyboard_json, created_at)
			VALUES (?, ?, 1, 'draft', ?, ?)`,
			[
				`s${i}`,
				`p${i}`,
				JSON.stringify({ schemaVersion: 2, clips: [{ id: `c${i}`, text: "ümlaut 👍" }] }),
				1,
			],
		);
	}
	source.run(
		`INSERT INTO image_generation_log (workspace, kind, created_at, cost_usd) VALUES ('acme', 'post', 1, 0.04), ('acme', 'post', 2, 0.04)`,
	);
	source.exec(`CREATE TABLE auth_user (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, emailVerified INTEGER NOT NULL,
		image TEXT, createdAt date NOT NULL, updatedAt date NOT NULL, role TEXT)`);
	source.run(
		`INSERT INTO auth_user VALUES ('u1', 'Owner', 'o@example.com', 0, NULL, '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z', 'instance_owner')`,
	);
}

function workspaceFile(name: string, body: string): void {
	mkdirSync(join(dir, "workspaces", name), { recursive: true });
	writeFileSync(join(dir, "workspaces", name, "config.yaml"), body);
}

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "maleo-carry-"));
	source = new Database(join(dir, "maleo.db"));
	applyUnifiedSchema(source);
	target = await createTestDatabase();
	await target.sql.unsafe(AUTH_DDL);
	db = pgDb(target.sql);
	seedSource();
	workspaceFile("acme", "# owner notes\nname: acme\nimage_generation:\n  enabled: false\n");
});

afterEach(async () => {
	source.close();
	await target.drop();
	rmSync(dir, { recursive: true, force: true });
});

const count = async (table: string) =>
	(await db.get<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))!.n;

describe("every row is carried and counted", () => {
	test("row counts match per table and are reported", async () => {
		const report = await carryOver({ source, target: db, dataDir: dir });
		expect(report.tables.find((t) => t.table === "content_projects")).toEqual({
			table: "content_projects",
			source: 25,
			target: 25,
		});
		expect(report.tables.find((t) => t.table === "content_storyboards")).toEqual({
			table: "content_storyboards",
			source: 25,
			target: 25,
		});
		expect(report.tables.every((t) => t.source === t.target)).toBe(true);
		expect(await count("content_storyboards")).toBe(25);
		await expect(assertVisualContractReady(db)).rejects.toThrow("migration is incomplete");
	});

	test("a legacy source cannot claim readiness for imported heads", async () => {
		source.run("INSERT INTO global_settings (key, value, updated_at) VALUES (?, '1', 0)", [
			VISUAL_CONTRACT_SETTING,
		]);
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			"cannot declare Postgres visual-contract readiness",
		);
		expect(await count("content_projects")).toBe(0);
	});

	test("documents arrive byte for byte", async () => {
		await carryOver({ source, target: db, dataDir: dir });
		const before = source
			.query<{ j: string }, []>(
				`SELECT storyboard_json AS j FROM content_storyboards WHERE id = 's7'`,
			)
			.get()!.j;
		expect(
			(await db.get<{ j: string }>(
				`SELECT storyboard_json AS j FROM content_storyboards WHERE id = 's7'`,
			))!.j,
		).toBe(before);
	});

	test("identity columns keep their ids and the sequence continues after them", async () => {
		await carryOver({ source, target: db, dataDir: dir });
		await db.run(
			`INSERT INTO image_generation_log (workspace, kind, created_at) VALUES ('acme', 'post', 3)`,
		);
		expect(
			(await db.all<{ id: number }>(`SELECT id FROM image_generation_log ORDER BY id`)).map(
				(r) => r.id,
			),
		).toEqual([1, 2, 3]);
	});

	test("the auth library's rows are carried, dates and flags converted", async () => {
		await carryOver({ source, target: db, dataDir: dir });
		const user = await db.get<{ emailVerified: boolean; createdAt: Date }>(
			`SELECT "emailVerified", "createdAt" FROM auth_user WHERE id = 'u1'`,
		);
		expect(user!.emailVerified).toBe(false);
		expect(new Date(user!.createdAt).toISOString()).toBe("2026-09-01T10:00:00.000Z");
	});

	test("a retired table that still holds rows stops the run naming it", async () => {
		source.exec(`CREATE TABLE prompt_library (id TEXT); INSERT INTO prompt_library VALUES ('x')`);
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/prompt_library.*1 row/,
		);
		expect(await count("content_projects")).toBe(0);
	});
});

describe("an interrupted run", () => {
	test("the maintenance CLI resumes before visual readiness and keeps runtime blocked", async () => {
		await expect(
			carryOver({
				source,
				target: db,
				dataDir: dir,
				batchSize: 10,
				onBatch: () => {
					throw new Error("interrupted");
				},
			}),
		).rejects.toThrow("interrupted");
		for (let attempt = 0; attempt < 2; attempt++) {
			const child = Bun.spawn(
				[process.execPath, join(import.meta.dirname, "migrate-to-postgres.ts")],
				{
					cwd: join(import.meta.dirname, ".."),
					env: {
						...process.env,
						MALEO_DATABASE_URL: target.url,
						MALEO_DATA_DIR: dir,
						MALEO_DB_PATH: join(dir, "maleo.db"),
					},
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const [code, stdout, stderr] = await Promise.all([
				child.exited,
				new Response(child.stdout).text(),
				new Response(child.stderr).text(),
			]);
			if (code !== 0) throw new Error(`${stdout}\n${stderr}`);
			expect(stdout).toContain("every count matches");
			await expect(assertVisualContractReady(db)).rejects.toThrow("migration is incomplete");
			expect(await count("content_projects")).toBe(25);
		}
	}, 30_000);
	test("finishes on the next run without duplicating a row", async () => {
		let batches = 0;
		await expect(
			carryOver({
				source,
				target: db,
				dataDir: dir,
				batchSize: 10,
				onBatch: () => {
					if (++batches === 3) throw new Error("interrupted");
				},
			}),
		).rejects.toThrow("interrupted");
		await expect(assertVisualContractReady(db)).rejects.toThrow("migration is incomplete");
		const partial = (await count("content_projects")) + (await count("content_storyboards"));
		expect(partial).toBeGreaterThan(0);
		expect(partial).toBeLessThan(50);

		const report = await carryOver({ source, target: db, dataDir: dir, batchSize: 10 });
		expect(report.tables.every((t) => t.source === t.target)).toBe(true);
		expect(await count("content_projects")).toBe(25);
	});
});

describe("a value that cannot be carried", () => {
	test("stops naming table, row and column instead of coercing", async () => {
		// SQLite's dynamic typing lets text into an INTEGER column; Postgres bigint cannot hold it.
		source.run(
			`UPDATE content_projects SET target_duration_sec = 'about a minute' WHERE id = 'p3'`,
		);
		const error = await carryOver({ source, target: db, dataDir: dir }).catch((e: unknown) => e);
		expect(error).toBeInstanceOf(CarryOverError);
		expect(String(error)).toContain("content_projects");
		expect(String(error)).toContain("p3");
		expect(String(error)).toContain("target_duration_sec");
	});

	test("a missing value for a required column stops too", async () => {
		source.exec(`ALTER TABLE content_projects RENAME TO cp_old;
			CREATE TABLE content_projects AS SELECT * FROM cp_old; DROP TABLE cp_old;`);
		source.run(`UPDATE content_projects SET title = NULL WHERE id = 'p4'`);
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/content_projects.*p4.*title/,
		);
	});

	test("a missing value for a column with a declared default takes the default", async () => {
		// A column SQLite gained by ALTER TABLE ADD COLUMN is nullable there even
		// where the declared schema says NOT NULL DEFAULT; rows older than the
		// column hold NULL, which the schema defines as the default.
		source.exec(`ALTER TABLE content_projects RENAME TO cp_old;
			CREATE TABLE content_projects AS SELECT * FROM cp_old; DROP TABLE cp_old;`);
		source.run(`UPDATE content_projects SET workspace = NULL WHERE id = 'p5'`);
		await carryOver({ source, target: db, dataDir: dir });
		expect(
			(await db.get<{ w: string }>(`SELECT workspace AS w FROM content_projects WHERE id = 'p5'`))!
				.w,
		).toBe("default");
	});
});

describe("YAML workspaces", () => {
	test("every workspace's configuration is carried intact, comments included", async () => {
		await carryOver({ source, target: db, dataDir: dir });
		expect(
			(await db.get<{ t: string }>(
				`SELECT config_yaml AS t FROM workspace_config WHERE workspace = 'acme'`,
			))!.t,
		).toBe("# owner notes\nname: acme\nimage_generation:\n  enabled: false\n");
	});

	test("an unparseable file stops the run naming the file, creating nothing from defaults", async () => {
		workspaceFile("acme", "name: [unclosed\n");
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/workspaces\/acme\/config\.yaml/,
		);
		expect(await count("workspace_config")).toBe(0);
	});

	test("a file that fails validation stops the run naming the file and the field", async () => {
		workspaceFile("acme", "name: acme\nimage_generation:\n  enabled: sometimes\n");
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/acme\/config\.yaml.*image_generation\.enabled/,
		);
	});

	test("a registered workspace with no file stops the run rather than defaulting", async () => {
		rmSync(join(dir, "workspaces", "acme"), { recursive: true });
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/acme.*no config\.yaml/,
		);
	});

	test("a credential in a file stops the run", async () => {
		workspaceFile("acme", "name: acme\ntelegram_bot_token: 1:abc\n");
		await expect(carryOver({ source, target: db, dataDir: dir })).rejects.toThrow(
			/telegram_bot_token/,
		);
	});
});
