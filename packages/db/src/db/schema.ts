/* Who owns which table in the runtime database.
 *
 * The migration sequence in packages/db/migrations owns every table and column.
 * The runtime table list is derived from it — never kept by hand — so a table a
 * migration adds appears here without a second edit, and a list that drifted
 * from the sequence cannot exist.
 *
 * One exception: the authentication library generates and migrates its own
 * tables. See AUTH_OWNED_TABLES. */
import { loadMigrations, MIGRATIONS_TABLE, type Migration } from "./migrate.ts";

/* The workspace every pre-tenancy content project belongs to. Content projects
 * were never tenanted and have no derivable owner, so every existing project
 * landed in one workspace — reversible with a single UPDATE once a real mapping
 * exists. */
export const DEFAULT_CONTENT_WORKSPACE = "default";

/* The tables the authentication library owns, generates, and migrates itself.
 *
 * This is the ONE exception to "the migration sequence owns every table".
 * better-auth ships its own migrator; copying its DDL into a migration would
 * mean re-copying it on every upgrade and diverging silently in between. So the
 * ownership test treats these as out of scope instead of as a violation.
 *
 * The exception is bounded three ways on purpose:
 *
 *   - it is a LIST, not a pattern. A table appearing under AUTH_TABLE_PREFIX
 *     that is not named here fails the ownership test, so the library gaining a
 *     table in a future version is a decision someone makes, not a silent
 *     widening.
 *   - no foreign key crosses it in EITHER direction, so the two schemas can
 *     migrate independently.
 *   - it admits this library's core tables only — not tables a feature of ours
 *     builds on top of them. `workspace_members` is ours and is created by a
 *     migration like every other table, because it joins two concepts we own
 *     and merely borrows an identifier.
 *
 * The prefix also keeps the library off generic names. Unprefixed, better-auth
 * wants `user`, `session`, `account` and `verification` — four of the most
 * collision-prone names available — in a database that already holds forty
 * tables. Configured via each model's `modelName` in the auth config. */
export const AUTH_TABLE_PREFIX = "auth_";

export const AUTH_OWNED_TABLES: readonly string[] = [
	"auth_user",
	"auth_session",
	"auth_account",
	"auth_verification",
	// Sign-in attempt counts, shared by every API replica.
	"auth_rate_limit",
	// Hashed API keys an MCP client presents as Bearer (the library's api-key
	// plugin). Each key acts as its owning user.
	"auth_apikey",
];

/** Tables the migration sequence leaves in place, in creation order. */
export function tablesCreatedBy(migrations: readonly Migration[]): string[] {
	const tables: string[] = [];
	for (const m of migrations) {
		for (const [, verb, name] of m.sql.matchAll(
			/^\s*(CREATE|DROP) TABLE (?:IF (?:NOT )?EXISTS )?(\w+)/gim,
		)) {
			const at = tables.indexOf(name!);
			if (verb!.toUpperCase() === "CREATE" && at === -1) tables.push(name!);
			if (verb!.toUpperCase() === "DROP" && at !== -1) tables.splice(at, 1);
		}
	}
	return tables;
}

/** Every table the runtime schema owns. */
export const RUNTIME_TABLES: readonly string[] = tablesCreatedBy(loadMigrations());

/* Table names on disk that no owner accounts for.
 *
 * Pure on purpose — it takes names, not a handle — so the ownership test can
 * reference this one classification instead of keeping its own copy of the
 * lists. A copy is exactly how an exemption stops meaning anything: the test
 * keeps passing while the lists drift apart.
 *
 * A table under AUTH_TABLE_PREFIX is NOT automatically forgiven. It must be in
 * AUTH_OWNED_TABLES by name, so a library upgrade that adds a table surfaces
 * here rather than widening the exception on its own. */
export function unownedTables(tableNames: readonly string[]): string[] {
	return tableNames.filter(
		(name) =>
			name !== MIGRATIONS_TABLE &&
			!RUNTIME_TABLES.includes(name) &&
			!AUTH_OWNED_TABLES.includes(name),
	);
}
