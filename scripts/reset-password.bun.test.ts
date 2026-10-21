/* Operator password reset: the new verifier is argon2id and verifies, the
 * sign-in lockout is cleared, and an unknown address or a short password
 * changes nothing. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../packages/db/src/db/pg-testing.ts";
import { pgDb, type Db } from "../packages/db/src/db/handle.ts";
import { resetPassword } from "./reset-password.ts";

let target: TestDatabase;
let db: Db;

beforeEach(async () => {
	target = await createTestDatabase();
	await target.sql.unsafe(`
		CREATE TABLE auth_user (id text PRIMARY KEY, email text NOT NULL);
		CREATE TABLE auth_account (id text PRIMARY KEY, "providerId" text NOT NULL, "userId" text NOT NULL,
		  password text, "updatedAt" timestamptz NOT NULL);
		CREATE TABLE auth_rate_limit (id text PRIMARY KEY, key text NOT NULL, count integer NOT NULL, "lastRequest" bigint NOT NULL);
		INSERT INTO auth_user VALUES ('u1', 'owner@example.com');
		INSERT INTO auth_account VALUES ('a1', 'credential', 'u1', 'old-hash', now());
		INSERT INTO auth_rate_limit VALUES ('r1', '/sign-in/email', 9, 0);`);
	db = pgDb(target.sql);
});

afterEach(async () => {
	await target.drop();
});

async function storedHash(): Promise<string> {
	return (await db.get<{ password: string }>(`SELECT password FROM auth_account WHERE id = 'a1'`))!
		.password;
}

test("stores an argon2id verifier for the new password and clears the lockout", async () => {
	expect(await resetPassword(db, "Owner@Example.com", "correct horse battery")).toBe(true);
	const hash = await storedHash();
	expect(hash).toStartWith("$argon2id$");
	expect(await Bun.password.verify("correct horse battery", hash)).toBe(true);
	expect((await db.get<{ c: number }>(`SELECT count(*)::int AS c FROM auth_rate_limit`))!.c).toBe(
		0,
	);
});

test("an unknown address changes nothing", async () => {
	expect(await resetPassword(db, "nobody@example.com", "correct horse battery")).toBe(false);
	expect(await storedHash()).toBe("old-hash");
});

test("a password under the sign-in minimum is refused", async () => {
	await expect(resetPassword(db, "owner@example.com", "short")).rejects.toThrow(/at least 12/);
	expect(await storedHash()).toBe("old-hash");
});
