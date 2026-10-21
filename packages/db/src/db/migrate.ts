/* Ordered, versioned, once-only schema migrations.
 *
 * This replaces reconcile-at-open. The old path ran an idempotent declaration
 * on every start and introspected columns to guess what to ALTER; it could not
 * express a data change, could not be reviewed as a sequence, and could not tell
 * "not yet applied" from "failed halfway". Here every schema change is a
 * numbered file in packages/db/migrations, applied in order, recorded in
 * schema_migrations, and never run twice.
 *
 * Three rules the runner enforces rather than trusts:
 *
 *   - a migration and its bookkeeping row commit together, so a failure leaves
 *     the database exactly as it was before that migration, and the error
 *     propagates — the caller refuses to serve rather than healing past it;
 *   - an applied migration whose content has changed is refused, because the
 *     databases it already ran on did not get the edit (a correction is a new
 *     migration);
 *   - an advisory lock serialises runners, so replicas starting together apply
 *     each migration once. */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./pg.ts";

export interface Migration {
	version: number;
	name: string;
	sql: string;
}

export class MigrationError extends Error {
	override name = "MigrationError";
}

export const MIGRATIONS_DIR = join(import.meta.dir, "../../migrations");

/** The bookkeeping table. Owned by the runner, not by a migration. */
export const MIGRATIONS_TABLE = "schema_migrations";

// Arbitrary, fixed: every runner against one database must use the same key.
const LOCK_KEY = 7_240_411;

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export function checksum(sql: string): string {
	return createHash("sha256").update(sql).digest("hex");
}

const label = (m: Pick<Migration, "version" | "name">): string => `${m.version}_${m.name}`;

/** Every migration file, in version order. A file that does not match the
 *  naming pattern is an error rather than something to skip: a typo'd name
 *  would otherwise be a migration that silently never runs. */
export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
	return readdirSync(dir)
		.filter((file) => file.endsWith(".sql"))
		.map((file) => {
			const match = FILE_PATTERN.exec(file);
			if (!match) throw new MigrationError(`migration file ${file} does not match NNNN_name.sql`);
			return {
				version: Number(match[1]),
				name: match[2]!,
				sql: readFileSync(join(dir, file), "utf8"),
			};
		})
		.sort((a, b) => a.version - b.version);
}

function validate(migrations: readonly Migration[]): Migration[] {
	const seen = new Set<number>();
	for (const m of migrations) {
		if (!Number.isSafeInteger(m.version) || m.version < 1) {
			throw new MigrationError(`migration ${label(m)} has an invalid version`);
		}
		if (seen.has(m.version)) throw new MigrationError(`duplicate migration version ${m.version}`);
		seen.add(m.version);
	}
	return [...migrations].sort((a, b) => a.version - b.version);
}

/** Apply every pending migration. Rejects with MigrationError when a migration
 *  fails or an applied one was edited; the database is left at the last
 *  migration that committed. */
export async function migrate(
	sql: Sql,
	migrations: readonly Migration[],
): Promise<{ applied: number[] }> {
	const ordered = validate(migrations);

	const recorded = await sql.begin(async (tx) => {
		await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
		await tx.unsafe(`CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
			version integer PRIMARY KEY,
			name text NOT NULL,
			checksum text NOT NULL,
			applied_at bigint NOT NULL
		)`);
		return tx.unsafe<{ version: number; checksum: string }[]>(
			`SELECT version, checksum FROM ${MIGRATIONS_TABLE}`,
		);
	});

	// Checked before anything new runs: an edited migration means this database
	// and the code disagree about history, and applying more on top would bury it.
	const recordedSums = new Map(recorded.map((r) => [r.version, r.checksum]));
	for (const m of ordered) {
		const sum = recordedSums.get(m.version);
		if (sum !== undefined && sum !== checksum(m.sql)) {
			throw new MigrationError(
				`migration ${label(m)} was edited after it was applied; add a new migration instead`,
			);
		}
	}

	const applied: number[] = [];
	for (const m of ordered) {
		if (recordedSums.has(m.version)) continue;
		try {
			const ran = await sql.begin(async (tx) => {
				await tx`SELECT pg_advisory_xact_lock(${LOCK_KEY})`;
				// Another runner may have applied it while this one waited for the lock.
				const [row] = await tx.unsafe<{ checksum: string }[]>(
					`SELECT checksum FROM ${MIGRATIONS_TABLE} WHERE version = $1`,
					[m.version],
				);
				if (row) return false;
				await tx.unsafe(m.sql);
				await tx.unsafe(
					`INSERT INTO ${MIGRATIONS_TABLE} (version, name, checksum, applied_at) VALUES ($1, $2, $3, $4)`,
					[m.version, m.name, checksum(m.sql), Date.now()],
				);
				return true;
			});
			if (ran) applied.push(m.version);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new MigrationError(`migration ${label(m)} failed and was rolled back: ${reason}`, {
				cause: error,
			});
		}
	}
	return { applied };
}
