/* Proof for task 1.12: the database holding encrypted credentials, and the WAL
 * sidecar holding the most recently written of them, are owner-only. */
import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { restrictDbFilePermissions } from "../../src/db/legacy-sqlite.ts";

const dirs: string[] = [];

function tempDbPath(): string {
	const dir = mkdtempSync(join(tmpdir(), "maleo-perm-"));
	dirs.push(dir);
	return join(dir, "maleo.db");
}

function mode(path: string): number {
	return statSync(path).mode & 0o777;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("database file permissions", () => {
	test("the database and its WAL sidecar become owner-only", () => {
		const file = tempDbPath();
		const db = new Database(file);
		db.exec("PRAGMA journal_mode = WAL;");
		db.exec("CREATE TABLE t (v TEXT);");
		db.run("INSERT INTO t (v) VALUES ('x')");

		restrictDbFilePermissions(file);

		expect(mode(file)).toBe(0o600);
		// WAL means the newest rows live here until a checkpoint, so a readable
		// sidecar beside a 0600 database leaks exactly the freshest secrets.
		if (existsSync(`${file}-wal`)) expect(mode(`${file}-wal`)).toBe(0o600);
		db.close();
	});

	// Applied on every open, not only at create — an existing database from before
	// this change is tightened rather than left as it was.
	test("an already-permissive database is tightened", () => {
		const file = tempDbPath();
		const db = new Database(file);
		db.exec("CREATE TABLE t (v TEXT);");
		db.close();
		chmodSync(file, 0o644);
		expect(mode(file)).toBe(0o644);

		restrictDbFilePermissions(file);
		expect(mode(file)).toBe(0o600);
	});

	test("absent sidecars are not an error", () => {
		const file = tempDbPath();
		const db = new Database(file);
		db.exec("CREATE TABLE t (v TEXT);");
		db.close();
		expect(() => restrictDbFilePermissions(file)).not.toThrow();
	});
});
