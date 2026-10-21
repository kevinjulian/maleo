import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getLegacyMediaLink, getMediaObject } from "../packages/db/src/db/media-objects";
import { sqliteDb } from "../packages/db/src/db/handle";
import { getMedia } from "../packages/storage/src/storage.ts";
import { legacyPath, migrateLegacyMedia } from "./migrate-media";

const prior = {
	dir: process.env.MALEO_DATA_DIR,
	mode: process.env.MALEO_MEDIA_STORAGE_BACKEND,
	env: process.env.NODE_ENV,
	cache: process.env.CACHE_DIR,
};
let root: string;
afterEach(async () => {
	for (const [key, value] of [
		["MALEO_DATA_DIR", prior.dir],
		["MALEO_MEDIA_STORAGE_BACKEND", prior.mode],
		["NODE_ENV", prior.env],
		["CACHE_DIR", prior.cache],
	] as const) {
		if (key === "MALEO_DATA_DIR")
			process.env.MALEO_DATA_DIR = value ?? join(tmpdir(), "maleo-test-data-fallback");
		else if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	if (root) await rm(root, { recursive: true, force: true });
});

test("import is idempotent, keeps immutable history, and reports missing bytes", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-migrate-"));
	process.env.MALEO_DATA_DIR = join(root, "data");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const uploads = join(root, "apps/api/public/uploads");
	await mkdir(uploads, { recursive: true });
	await writeFile(join(uploads, "one.png"), new Uint8Array([1, 2, 3]));
	const cache = join(root, "apps/media-worker/data/cache");
	process.env.CACHE_DIR = cache;
	await mkdir(cache, { recursive: true });
	await writeFile(join(cache, "two.png"), new Uint8Array([4, 5, 6]));
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE content_projects (id TEXT PRIMARY KEY, workspace TEXT, editor_state_json TEXT);
    CREATE TABLE content_storyboards (id TEXT PRIMARY KEY, project_id TEXT, storyboard_json TEXT);
    CREATE TABLE image_ledger (id TEXT PRIMARY KEY, workspace TEXT, project_id TEXT, asset_url TEXT, backfilled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE media_objects (id TEXT PRIMARY KEY, workspace TEXT, kind TEXT, hash TEXT, storage_key TEXT, content_type TEXT, size INTEGER, created_at INTEGER, UNIQUE(storage_key));
    CREATE TABLE legacy_media_links (legacy_path TEXT, workspace TEXT, media_id TEXT, created_at INTEGER, PRIMARY KEY(legacy_path, workspace));
  `);
	db.run("INSERT INTO content_projects VALUES (?, ?, ?)", [
		"p",
		"team",
		JSON.stringify({
			image: "/uploads/one.png",
			missing: "/uploads/gone.png",
			oldHost: "https://old.example/uploads/one.png?token=secret",
		}),
	]);
	db.run("INSERT INTO content_storyboards VALUES (?, ?, ?)", [
		"s",
		"p",
		JSON.stringify({ image: "/uploads/one.png", missing: "/uploads/gone.png" }),
	]);
	db.run("INSERT INTO image_ledger (id, workspace, asset_url) VALUES (?, ?, ?)", [
		"l",
		"team",
		"https://old.example/files/two.png",
	]);
	const missing: unknown[] = [];
	let progress = 0;
	const dry = await migrateLegacyMedia({
		db,
		root,
		apply: false,
		onMissing: async (item) => {
			await Bun.sleep(1);
			missing.push(item);
		},
		onProgress: (report) => {
			progress = report.scanned;
		},
	});
	expect(dry.missing).toBe(2);
	expect(dry.unrecognizedOrigins).toBe(2);
	expect(missing).toHaveLength(4);
	expect(JSON.stringify(missing)).not.toContain("token=secret");
	expect(progress).toBe(dry.scanned);
	expect(dry.copied).toBe(0);
	expect(dry.availableFiles).toBe(1);
	expect(dry.availableBytes).toBe(3);
	const withOldHost = await migrateLegacyMedia({
		db,
		root,
		apply: false,
		allowedOrigins: new Set(["https://old.example"]),
	});
	expect(withOldHost.unrecognizedOrigins).toBe(0);
	expect(withOldHost.references).toBe(dry.references + 2);
	expect(withOldHost.availableFiles).toBe(2);
	expect(withOldHost.availableBytes).toBe(6);
	expect(await getLegacyMediaLink("/uploads/one.png", "team", sqliteDb(db))).toBeNull();
	const first = await migrateLegacyMedia({
		db,
		root,
		apply: true,
		allowedOrigins: new Set(["https://old.example"]),
	});
	expect(first.copied).toBe(2);
	const id = (await getLegacyMediaLink("/uploads/one.png", "team", sqliteDb(db)))!;
	const row = (await getMediaObject(id, sqliteDb(db)))!;
	expect(new Uint8Array(await (await getMedia(row.storage_key)).arrayBuffer())).toEqual(
		new Uint8Array([1, 2, 3]),
	);
	const editor = JSON.parse(
		db
			.query<{ editor_state_json: string }, []>("SELECT editor_state_json FROM content_projects")
			.get()!.editor_state_json,
	);
	expect(editor.image).toBe(`/api/media/${id}`);
	expect(editor.missing).toBe("/uploads/gone.png");
	expect(editor.oldHost).toBe(`/api/media/${id}`);
	expect(
		db.query<{ asset_url: string }, []>("SELECT asset_url FROM image_ledger").get()!.asset_url,
	).toMatch(/^\/api\/media\//);
	expect(
		db
			.query<{ storyboard_json: string }, []>("SELECT storyboard_json FROM content_storyboards")
			.get()!.storyboard_json,
	).toContain("/uploads/one.png");
	const second = await migrateLegacyMedia({
		db,
		root,
		apply: true,
		allowedOrigins: new Set(["https://old.example"]),
	});
	expect(second.copied).toBe(0);
	expect(legacyPath("https://evil.invalid/uploads/one.png", new Set())).toBeNull();
	db.close();
});

test("two legacy files with identical bytes import as two objects", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-migrate-"));
	process.env.MALEO_DATA_DIR = join(root, "data");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const uploads = join(root, "apps/api/public/uploads");
	await mkdir(uploads, { recursive: true });
	await writeFile(join(uploads, "one.png"), new Uint8Array([1, 2, 3]));
	await writeFile(join(uploads, "two.png"), new Uint8Array([1, 2, 3]));
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE image_ledger (id TEXT PRIMARY KEY, workspace TEXT, project_id TEXT, asset_url TEXT, backfilled INTEGER);
    CREATE TABLE media_objects (id TEXT PRIMARY KEY, workspace TEXT, kind TEXT, hash TEXT, storage_key TEXT, content_type TEXT, size INTEGER, created_at INTEGER, UNIQUE(storage_key));
    CREATE TABLE legacy_media_links (legacy_path TEXT, workspace TEXT, media_id TEXT, created_at INTEGER, PRIMARY KEY(legacy_path, workspace));
    INSERT INTO image_ledger VALUES ('one', 'team', 'project', '/uploads/one.png', 1);
    INSERT INTO image_ledger VALUES ('two', 'team', 'project', '/uploads/two.png', 1);
  `);
	const result = await migrateLegacyMedia({ db, root, apply: true });
	expect(result.copied).toBe(2);
	/* Keys are unique per write, so identical bytes are two objects with two
	 * identities. Deleting either leaves the other readable — the reason the
	 * maintainer chose per-write keys over content addressing. */
	const rows = db
		.query<{ asset_url: string }, []>("SELECT asset_url FROM image_ledger ORDER BY id")
		.all();
	expect(rows[0]!.asset_url).toMatch(/^\/api\/media\//);
	expect(rows[1]!.asset_url).toMatch(/^\/api\/media\//);
	expect(rows[1]!.asset_url).not.toBe(rows[0]!.asset_url);
	const linkOne = (await getLegacyMediaLink("/uploads/one.png", "team", sqliteDb(db)))!;
	const linkTwo = (await getLegacyMediaLink("/uploads/two.png", "team", sqliteDb(db)))!;
	expect(linkTwo).not.toBe(linkOne);
	// Each object's key carries its own owner and a readable filename.
	expect((await getMediaObject(linkOne, sqliteDb(db)))!.storage_key).toMatch(
		/^workspaces\/team\/image\/[0-9a-f-]{36}-one\.png$/,
	);
	expect((await getMediaObject(linkTwo, sqliteDb(db)))!.storage_key).toMatch(
		/^workspaces\/team\/image\/[0-9a-f-]{36}-two\.png$/,
	);
	const second = await migrateLegacyMedia({ db, root, apply: true });
	expect(second.copied).toBe(0);
	expect(second.rewritten).toBe(0);
	db.close();
});

test("a failing row is reported and skipped, but a run of failures aborts", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-media-migrate-"));
	process.env.MALEO_DATA_DIR = join(root, "data");
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	delete process.env.NODE_ENV;
	const uploads = join(root, "apps/api/public/uploads");
	await mkdir(uploads, { recursive: true });
	await writeFile(join(uploads, "good.png"), new Uint8Array([1]));
	await writeFile(join(uploads, "bad.png"), new Uint8Array([2]));
	const db = new Database(":memory:");
	db.exec(`
    CREATE TABLE content_projects (id TEXT PRIMARY KEY, workspace TEXT, editor_state_json TEXT);
    CREATE TABLE media_objects (id TEXT PRIMARY KEY, workspace TEXT, kind TEXT, hash TEXT, storage_key TEXT, content_type TEXT, size INTEGER, created_at INTEGER, UNIQUE(storage_key));
    CREATE TABLE legacy_media_links (legacy_path TEXT, workspace TEXT, media_id TEXT, created_at INTEGER, PRIMARY KEY(legacy_path, workspace));
    INSERT INTO content_projects VALUES ('a-good', 'team', '{"image":"/uploads/good.png"}');
    INSERT INTO content_projects VALUES ('b-bad', 'team', '{"image":"/uploads/bad.png"}');
    CREATE TRIGGER poison BEFORE UPDATE ON content_projects WHEN NEW.id = 'b-bad'
      BEGIN SELECT RAISE(ABORT, 'poisoned row'); END;
  `);
	const failures: Array<Record<string, unknown>> = [];
	const report = await migrateLegacyMedia({
		db,
		root,
		apply: true,
		onMissing: (item) => {
			failures.push(item);
		},
	});
	// The good row landed; the poisoned one is on the report, not fatal.
	expect(report.rewritten).toBe(1);
	expect(report.failures).toBe(1);
	expect(failures.map((item) => item.reason)).toEqual(["row_failed"]);
	expect(failures[0]!.rowid).toBe(2);
	expect(
		db
			.query<{ editor_state_json: string }, [string]>(
				"SELECT editor_state_json FROM content_projects WHERE id = ?",
			)
			.get("a-good")!.editor_state_json,
	).toContain("/api/media/");
	expect(
		db
			.query<{ editor_state_json: string }, [string]>(
				"SELECT editor_state_json FROM content_projects WHERE id = ?",
			)
			.get("b-bad")!.editor_state_json,
	).toContain("/uploads/bad.png");
	// Legacy bytes are untouched, so a later run retries the skipped row.
	expect(await Bun.file(join(uploads, "bad.png")).exists()).toBe(true);
	await expect(migrateLegacyMedia({ db, root, apply: true, failureCeiling: 1 })).rejects.toThrow(
		"consecutive row failures",
	);
	db.close();
});
