import { afterEach, beforeEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { openTestDb, type TestDb } from "../packages/db/src/db/handle-testing.ts";
import { setGlobalSetting, getGlobalSetting } from "../packages/db/src/db/global-settings.ts";
import { seal, unseal, keyFingerprint } from "../packages/db/src/db/secret-crypto.ts";
import { convertBrandState } from "./rebrand-state.ts";
import { resolveConfig } from "../packages/db/src/db/config-resolution.ts";
import { getSecret, MASTER_KEY_ENV, openSealedValue } from "../packages/db/src/db/secret-store.ts";
import { createContentProject } from "../packages/db/src/db/project-detail.ts";
import { databaseConfig } from "../packages/db/src/db/database-config.ts";
import { createTestDatabase } from "../packages/db/src/db/pg-testing.ts";
import { freePort, startEmbeddedPostgres } from "../packages/db/src/db/pg-embedded.ts";
import { createSql } from "../packages/db/src/db/pg.ts";
import { pgDb } from "../packages/db/src/db/handle.ts";
import { loadMigrations, migrate } from "../packages/db/src/db/migrate.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getMcpServersWithHeaders } from "../packages/db/src/db/mcp-servers.ts";

let t: TestDb;
const master = Buffer.alloc(32, 7);
const dataKey = Buffer.alloc(32, 8);
const oldFingerprint = createHash("sha256")
	.update("aincer:master-key-fingerprint:v1")
	.update(master)
	.digest("base64url")
	.slice(0, 22);
const sealed = seal("synthetic-provider-key", dataKey);
const workspaceValue = seal("synthetic-workspace-value", dataKey);
const envelope = () => ({
	wrappings: [{ fingerprint: oldFingerprint, wrapped: seal(dataKey.toString("base64"), master) }],
});
const snapshot = () => t.db.all("SELECT * FROM global_settings ORDER BY key");
const previousMaster = process.env[MASTER_KEY_ENV];

beforeEach(async () => {
	t = await openTestDb("postgres");
	process.env[MASTER_KEY_ENV] = master.toString("base64");
	await setGlobalSetting("config.AINCER_KOKORO_URL", "http://synthetic.invalid", t.db);
	await setGlobalSetting("secret.AINCER_AI_API_KEY", sealed, t.db);
	await setGlobalSetting("secret.__envelope", JSON.stringify(envelope()), t.db);
	await setGlobalSetting("fixture.project-id", "unchanged-project-id", t.db);
	await t.db.run(
		"INSERT INTO mcp_servers (id, workspace, name, url, allow_json, headers_sealed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
		[
			"synthetic-server",
			"default",
			"synthetic",
			"http://synthetic.invalid",
			"[]",
			seal(JSON.stringify({ Authorization: "synthetic-workspace-value" }), dataKey),
			1,
			1,
		],
	);
});
afterEach(async () => {
	await t.close();
	if (previousMaster === undefined) delete process.env[MASTER_KEY_ENV];
	else process.env[MASTER_KEY_ENV] = previousMaster;
});

test("converted fixture reads through runtime APIs and preserves ciphertext, data key and owned identity", async () => {
	const project = await createContentProject(
		{
			title: "Synthetic cutover project",
			seed_storyboard: {
				storyboard_json: { scenes: [{ imageUrl: "/uploads/synthetic/media.png" }] },
			},
		},
		t.db,
	);
	const beforeProject = await t.db.all("SELECT * FROM content_projects WHERE id = ?", [
		project.project.id,
	]);
	const beforeMedia = await t.db.all("SELECT * FROM content_storyboards WHERE project_id = ?", [
		project.project.id,
	]);
	expect(unseal(sealed, dataKey)).toBe("synthetic-provider-key");
	const report = await convertBrandState(t.db, master);
	expect((await resolveConfig("MALEO_KOKORO_URL", {}, t.db)).value).toBe(
		"http://synthetic.invalid",
	);
	expect(await getSecret("MALEO_AI_API_KEY", t.db)).toBe("synthetic-provider-key");
	expect(await openSealedValue(workspaceValue, t.db)).toBe("synthetic-workspace-value");
	expect((await getMcpServersWithHeaders("default", t.db))[0]?.headers).toEqual({
		Authorization: "synthetic-workspace-value",
	});
	expect(
		await t.db.all("SELECT * FROM content_projects WHERE id = ?", [project.project.id]),
	).toEqual(beforeProject);
	expect(
		await t.db.all("SELECT * FROM content_storyboards WHERE project_id = ?", [project.project.id]),
	).toEqual(beforeMedia);
	expect(report).toEqual({ renamed: 2, envelope: true });
	expect(await getGlobalSetting("config.MALEO_KOKORO_URL", t.db)).toBe("http://synthetic.invalid");
	expect(await getGlobalSetting("secret.MALEO_AI_API_KEY", t.db)).toBe(sealed);
	expect(await getGlobalSetting("fixture.project-id", t.db)).toBe("unchanged-project-id");
	const raw = await getGlobalSetting("secret.__envelope", t.db);
	const converted = JSON.parse(raw!);
	const actual = Buffer.from(unseal(converted.wrappings[0].wrapped, master), "base64");
	expect(unseal(workspaceValue, actual)).toBe("synthetic-workspace-value");
	expect(converted.wrappings[0].fingerprint).toBe(
		createHash("sha256")
			.update("maleo:master-key-fingerprint:v1")
			.update(master)
			.digest("base64url")
			.slice(0, 22),
	);
	const before = await snapshot();
	expect(await convertBrandState(t.db, master)).toEqual({ renamed: 0, envelope: false });
	expect(await snapshot()).toEqual(before);
});

for (const kind of [
	"wrong-key",
	"missing-key",
	"collision",
	"mixed",
	"pending",
	"multiple",
	"malformed",
	"missing-envelope",
	"corrupt-secret",
	"corrupt-workspace-secret",
] as const) {
	test(`${kind} fails without writes`, async () => {
		if (kind === "collision") await setGlobalSetting("config.MALEO_KOKORO_URL", "conflict", t.db);
		if (kind === "mixed") await setGlobalSetting("config.MALEO_OTHER", "mixed", t.db);
		if (kind === "pending")
			await setGlobalSetting(
				"secret.__envelope",
				JSON.stringify({ ...envelope(), pending: oldFingerprint }),
				t.db,
			);
		if (kind === "multiple")
			await setGlobalSetting(
				"secret.__envelope",
				JSON.stringify({ wrappings: [...envelope().wrappings, ...envelope().wrappings] }),
				t.db,
			);
		if (kind === "malformed") await setGlobalSetting("secret.__envelope", "broken", t.db);
		if (kind === "missing-envelope") await setGlobalSetting("secret.__envelope", null, t.db);
		if (kind === "corrupt-secret")
			await setGlobalSetting("secret.AINCER_AI_API_KEY", "broken", t.db);
		if (kind === "corrupt-workspace-secret")
			await t.db.run("UPDATE mcp_servers SET headers_sealed = ?", ["broken"]);
		const before = await snapshot();
		await expect(
			convertBrandState(
				t.db,
				kind === "missing-key" ? undefined : kind === "wrong-key" ? Buffer.alloc(32, 9) : master,
			),
		).rejects.toThrow();
		expect(await snapshot()).toEqual(before);
	});
}

test("unencrypted installation converts without a master key", async () => {
	await t.db.run("DELETE FROM mcp_servers");
	await setGlobalSetting("secret.AINCER_AI_API_KEY", null, t.db);
	await setGlobalSetting("secret.__envelope", null, t.db);
	expect(await convertBrandState(t.db)).toEqual({ renamed: 1, envelope: false });
});

test("runtime fingerprint differs from pre-cutover algorithm", () => {
	expect(keyFingerprint(master)).not.toBe(oldFingerprint);
});

test("old environment name is ignored and Maleo configuration is authoritative", () => {
	expect(() =>
		databaseConfig({
			NODE_ENV: "production",
			AINCER_DATABASE_URL: "postgres://obsolete.invalid/old",
		}),
	).toThrow("MALEO_DATABASE_URL");
	expect(
		databaseConfig({
			NODE_ENV: "production",
			AINCER_DATABASE_URL: "postgres://obsolete.invalid/old",
			MALEO_DATABASE_URL: "postgres://127.0.0.1/new",
		}),
	).toMatchObject({ kind: "url", url: "postgres://127.0.0.1/new" });
});

test("documented offline CLI converts stopped state and verifies a repeated run", async () => {
	const target = await createTestDatabase();
	try {
		await target.sql`INSERT INTO global_settings (key, value, updated_at) VALUES ('config.AINCER_KOKORO_URL', 'http://synthetic.invalid', 1)`;
		await target.sql.end();
		for (const renamed of [1, 0]) {
			const child = Bun.spawn(
				[
					process.execPath,
					"--no-env-file",
					"scripts/rebrand-state.ts",
					"--services-stopped",
					"--backup-confirmed",
				],
				{
					cwd: new URL("..", import.meta.url).pathname,
					env: { PATH: process.env.PATH, NODE_ENV: "production", MALEO_DATABASE_URL: target.url },
					stdout: "pipe",
					stderr: "pipe",
				},
			);
			const output = await new Response(child.stdout).text();
			const error = await new Response(child.stderr).text();
			expect(await child.exited, error).toBe(0);
			expect(JSON.parse(output)).toEqual({ renamed, envelope: false });
		}
	} finally {
		await target.drop();
	}
}, 30000);

test("administrative role and database rename preserves migrated data and credential access", async () => {
	const server = await startEmbeddedPostgres({
		dir: mkdtempSync(join(tmpdir(), "maleo-role-cutover-")),
		port: freePort(),
		ephemeral: true,
	});
	const bootstrap = createSql(server.url("postgres"), { max: 1 });
	const adminURL = new URL(server.url("postgres"));
	adminURL.username = "cutover_admin";
	adminURL.password = "synthetic_admin";
	let admin: ReturnType<typeof createSql> | undefined;
	let old: ReturnType<typeof createSql> | undefined;
	let current: ReturnType<typeof createSql> | undefined;
	try {
		await bootstrap.unsafe("CREATE ROLE cutover_admin LOGIN SUPERUSER PASSWORD 'synthetic_admin'");
		await bootstrap.unsafe("CREATE ROLE aincer LOGIN SUPERUSER PASSWORD 'aincer'");
		await bootstrap.unsafe("CREATE DATABASE aincer OWNER aincer");
		const oldURL = new URL(server.url("aincer"));
		oldURL.username = oldURL.password = "aincer";
		old = createSql(oldURL.href, { max: 1 });
		await migrate(old, loadMigrations());
		const before = await old.unsafe("SELECT * FROM schema_migrations ORDER BY version");
		await setGlobalSetting("config.AINCER_KOKORO_URL", "http://synthetic.invalid", pgDb(old));
		await setGlobalSetting("secret.AINCER_AI_API_KEY", sealed, pgDb(old));
		await setGlobalSetting("secret.__envelope", JSON.stringify(envelope()), pgDb(old));
		await old.end();
		await bootstrap.end();
		admin = createSql(adminURL.href, { max: 1 });
		await admin.unsafe("ALTER ROLE maleo RENAME TO bootstrap_admin");
		await admin.unsafe("ALTER DATABASE aincer RENAME TO maleo");
		await admin.unsafe("ALTER ROLE aincer RENAME TO maleo");
		await admin.unsafe("ALTER ROLE maleo PASSWORD 'maleo'");
		current = createSql(server.url("maleo"), { max: 1 });
		expect(await convertBrandState(pgDb(current), master)).toEqual({ renamed: 2, envelope: true });
		expect(await getSecret("MALEO_AI_API_KEY", pgDb(current))).toBe("synthetic-provider-key");
		expect(await current.unsafe("SELECT * FROM schema_migrations ORDER BY version")).toEqual(
			before,
		);
		expect(await migrate(current, loadMigrations())).toEqual({ applied: [] });
	} finally {
		await Promise.all([bootstrap.end(), old?.end(), current?.end(), admin?.end()]);
		await server.stop();
	}
}, 30000);
