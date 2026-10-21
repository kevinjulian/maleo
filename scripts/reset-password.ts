#!/usr/bin/env bun
/* Set a new password for an existing account.
 *
 * The deployment sends no email, so there is no "forgot password" flow: an
 * operator who loses their password resets it here, from a shell that can reach
 * the runtime database (in production, the api container's terminal).
 *
 * The password is read from stdin rather than argv so it stays out of shell
 * history and the process list. The sign-in rate-limit counts are cleared too,
 * because the failed attempts that preceded a reset usually tripped them.
 *
 * Usage:
 *   bun scripts/reset-password.ts <email>        # then type the password, Enter
 *   bun run auth:reset-password <email>          # locally, with root .env
 */
import type { Db } from "../packages/db/src/db/handle.ts";

/* Same floor as `minPasswordLength` in packages/auth/src/config.ts; a
 * shorter password set here would be one the sign-up form could never have. */
const MIN_PASSWORD_LENGTH = 12;

/** Returns false when no password account exists for the address. */
export async function resetPassword(db: Db, email: string, password: string): Promise<boolean> {
	if (password.length < MIN_PASSWORD_LENGTH) {
		throw new Error(`password must be at least ${MIN_PASSWORD_LENGTH} characters`);
	}
	// Bun.password defaults to argon2id, the verifier the API writes and checks.
	const hash = await Bun.password.hash(password);
	// better-auth stores addresses lowercased.
	const { changes } = await db.run(
		`UPDATE auth_account SET password = ?, "updatedAt" = now()
		 WHERE "providerId" = 'credential'
		   AND "userId" = (SELECT id FROM auth_user WHERE email = ?)`,
		[hash, email.trim().toLowerCase()],
	);
	if (changes === 0) return false;
	await db.run(`DELETE FROM auth_rate_limit`);
	return true;
}

async function readLine(): Promise<string> {
	for await (const line of console) return line;
	return "";
}

if (import.meta.main) {
	const email = process.argv[2];
	if (!email) {
		console.error("usage: bun scripts/reset-password.ts <email>  (password on stdin)");
		process.exit(1);
	}
	const { closeMaleoDb, databaseReady, openDb } =
		await import("../packages/db/src/db/connection.ts");
	process.stdout.write("new password: ");
	const password = await readLine();
	let code = 1;
	try {
		await databaseReady();
		const updated = await resetPassword(openDb(), email, password);
		console.log(updated ? `password updated for ${email}` : `no password account for ${email}`);
		code = updated ? 0 : 1;
	} catch (error) {
		console.error(error instanceof Error ? error.message : error);
	} finally {
		await closeMaleoDb();
	}
	// The stdin reader keeps the event loop alive after the line is read.
	process.exit(code);
}
