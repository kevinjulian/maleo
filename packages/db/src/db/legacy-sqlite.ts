/* The SQLite database this project ran on before Postgres.
 *
 * Not the runtime database. It is opened only by the one-time migration into
 * Postgres and by the maintenance scripts an operator runs before it; nothing
 * that serves a request reaches it. Opening it still brings an old file up to
 * the last SQLite schema (reconcile-at-open, the path the migration retired),
 * because the migration reads that shape — see migrate-to-postgres, task 4.5.
 *
 * It keeps holding encrypted secrets until migrated and removed, so it stays
 * owner-only on disk. */
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { resolveDataDir } from "../data-path.ts";
import { applyUnifiedSchema } from "./unified-schema.ts";

let cached: Database | null = null;

export function resolveLegacySqlitePath(): string {
	const explicit = process.env.MALEO_DB_PATH?.trim();
	if (explicit) return resolve(explicit);

	return resolve(resolveDataDir(), "maleo.db");
}

function tableExists(db: Database, name: string): boolean {
	const row = db
		.query<{ name: string }, [string]>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
		)
		.get(name);
	return row != null;
}

// Idempotent one-time backfill: for legacy `tickets` rows that carried both a
// draft_id and a campaign_id, stamp that campaign_id onto the matching draft
// (only when the draft does not already have one). Safe to call on every open;
// it short-circuits when the legacy table is absent.
function migrateTicketCampaignLinks(db: Database): void {
	if (!tableExists(db, "tickets")) return;
	const rows = db
		.query<{ workspace: string; draft_id: string; campaign_id: string }, []>(
			`SELECT workspace, draft_id, campaign_id FROM tickets
			 WHERE draft_id IS NOT NULL AND campaign_id IS NOT NULL AND workspace IS NOT NULL`,
		)
		.all();
	for (const row of rows) {
		db.run(
			`UPDATE drafts SET campaign_id = ?
			 WHERE workspace = ? AND id = ? AND campaign_id IS NULL`,
			[row.campaign_id, row.workspace, row.draft_id],
		);
	}
}

// Generic persona→workspace column rename across every existing table. Scans
// sqlite_master, and for each table that still has a `persona` column but no
// `workspace` column, renames it in place. Idempotent; covers maleo-db content
// tables (approval_decisions, routines, …) whose scoping column the codemod
// renamed in-schema but which pre-exist on disk with the old name.
function renameLegacyPersonaColumns(db: Database): void {
	const tables = db
		.query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all();
	for (const { name } of tables) {
		const cols = new Set(
			db
				.query<{ name: string }, []>(`PRAGMA table_info(${name})`)
				.all()
				.map((c) => c.name),
		);
		if (cols.has("persona") && !cols.has("workspace")) {
			try {
				db.exec(`ALTER TABLE ${name} RENAME COLUMN persona TO workspace`);
			} catch {
				/* already renamed or raced — safe to skip */
			}
		}
	}
}

/* This database holds encrypted operator credentials (see secret-store.ts), so it
 * is owner-only like the per-workspace secrets file already is. Encryption
 * protects a copied file; permissions protect the running host, and a database
 * holding the same class of value should not be the weaker of the two.
 *
 * The sidecars matter as much as the file: WAL means recently written rows live
 * in `-wal` until a checkpoint, so a world-readable `-wal` beside a 0600 database
 * leaks exactly the newest secrets. Applied on every open rather than at create,
 * which is what tightens databases that already exist. */
export function restrictDbFilePermissions(file: string): void {
	for (const path of [file, `${file}-wal`, `${file}-shm`]) {
		if (!existsSync(path)) continue;
		try {
			chmodSync(path, 0o600);
		} catch {
			/* best-effort on filesystems without unix modes; the same concession
			   writeWorkspaceSecrets makes */
		}
	}
}

export function openLegacySqlite(): Database {
	if (cached) return cached;
	const file = resolveLegacySqlitePath();
	mkdirSync(dirname(file), { recursive: true });
	const db = new Database(file);
	db.exec("PRAGMA journal_mode = WAL;");
	db.exec("PRAGMA busy_timeout = 5000;");
	// After the WAL pragma, so the sidecars it creates are covered by the same pass.
	restrictDbFilePermissions(file);
	// Legacy rename (persona→workspace): rename the old `personas` registry table
	// and every `persona`/`persona_dir` column to its workspace name BEFORE the
	// CREATE IF NOT EXISTS below, so an existing DB's tables match the current
	// schema (else CREATE IF NOT EXISTS no-ops on the old shape and a later
	// `CREATE INDEX ... (workspace)` fails with "no such column: workspace").
	// Guarded / generic: no-ops on fresh or already-migrated DBs.
	try {
		db.exec("ALTER TABLE personas RENAME TO workspaces");
	} catch {
		/* fresh or already renamed */
	}
	try {
		db.exec("ALTER TABLE workspaces RENAME COLUMN persona_dir TO workspace_dir");
	} catch {
		/* already renamed */
	}
	renameLegacyPersonaColumns(db);
	// Every table and column this DB has is declared in unified-schema.ts — the
	// workspace/campaign/approval/routine registry included. Nothing is ALTER-added
	// here afterwards: a column the schema does not declare is invisible to the
	// reconcile pass and to the content_projects rebuild, which is how
	// editor_state_json was destroyed for 141 projects on 2026-07-30.
	applyUnifiedSchema(db);
	// One-time: copy campaign linkage off the legacy ticket layer onto drafts,
	// then leave the old tables in place (they are simply no longer created or
	// referenced). Guarded by table existence so it is a no-op on fresh DBs.
	migrateTicketCampaignLinks(db);
	// Content-first migration: content rows were never persona/workspace-scoped.
	// Drop the dormant legacy `persona` columns/indexes from old content DBs. These
	// names are LEGACY PHYSICAL columns (predate the rename) — keep them as `persona`.
	// Order matters: indexes before their columns. Each guarded → no-op once dropped.
	for (const stmt of [
		"DROP INDEX IF EXISTS idx_content_projects_persona",
		"DROP INDEX IF EXISTS idx_content_outputs_persona",
		"ALTER TABLE content_projects DROP COLUMN owner_persona",
		"ALTER TABLE content_project_outputs DROP COLUMN persona",
	]) {
		try {
			db.exec(stmt);
		} catch {
			/* already dropped */
		}
	}
	cached = db;
	return db;
}

export function closeLegacySqlite(): void {
	if (!cached) return;
	try {
		cached.close();
	} catch {
		/* ignore */
	}
	cached = null;
}
