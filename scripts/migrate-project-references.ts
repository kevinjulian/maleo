#!/usr/bin/env bun
/* One-shot migration: rewrite the four-bucket `ProjectReferences` embedded in
 * persisted documents into the flat `ProjectSelection` (`{ prompt, entityIds }`).
 *
 * Why a script and not a read-time fix alone: the read path normalises on load
 * (`normalizeProjectSelection`), so un-migrated documents keep working — but a
 * document only gets rewritten when a human happens to open and save it, which
 * means the four-bucket shape would persist indefinitely and the code could never
 * drop the compatibility branch. This closes that tail in one pass.
 *
 * Two targets carry the shape:
 *   `content_storyboards.storyboard_json` -> `.projectReferences`
 *   `content_presets.preset_json`         -> `.projectRefs`   (note the key differs)
 *
 * What the rewrite does per document:
 *   - unions `imageIds` + `productIds` + `mediaAssetIds` (the `refmedia:` alias is
 *     folded onto its target entity id) into one deduped `entityIds` list
 *   - reads `refIds` instead when `imageIds` is absent (the pre-buckets generation)
 *   - drops `noteIds` — a note is not a reference entity; it lives in `project_note`
 *   - preserves `prompt` verbatim
 *
 * Ids that do not resolve to a `reference_entity` are PRESERVED, not dropped, and
 * reported. Dropping them would silently change a project's generation lock; a
 * dangling id is visible and recoverable, a deleted one is not.
 *
 * Usage:
 *   bun scripts/migrate-project-references.ts --dry-run
 *   bun scripts/migrate-project-references.ts --db path/to/copy.db
 *   bun scripts/migrate-project-references.ts
 */
import { Database } from "bun:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
	isFlatSelection,
	normalizeProjectSelection,
} from "../packages/shared/src/project-selection.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const dbArgIndex = process.argv.indexOf("--db");
const dbPath =
	dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
		? path.resolve(process.argv[dbArgIndex + 1]!)
		: path.join(repoRoot, "data", "maleo.db");

interface DocRow {
	id: string;
	json: string;
}

interface Rewrite {
	id: string;
	json: string;
	entityIds: string[];
}

interface Tally {
	total: number;
	absent: number;
	alreadyFlat: number;
	parseFailed: string[];
	rewrites: Rewrite[];
	droppedNoteIds: number;
}

/** Read one document, return its rewritten JSON, or null when it needs no rewrite. */
function rewriteDocument(row: DocRow, key: string, tally: Tally): void {
	tally.total += 1;
	let doc: Record<string, unknown>;
	try {
		doc = JSON.parse(row.json) as Record<string, unknown>;
	} catch {
		tally.parseFailed.push(row.id);
		return;
	}
	const raw = doc?.[key];
	if (raw === undefined || raw === null) {
		tally.absent += 1;
		return;
	}
	if (isFlatSelection(raw)) {
		tally.alreadyFlat += 1;
		return;
	}

	const bucket = raw as Record<string, unknown>;
	if (Array.isArray(bucket.noteIds)) tally.droppedNoteIds += bucket.noteIds.length;

	const selection = normalizeProjectSelection(raw);
	tally.rewrites.push({
		id: row.id,
		json: JSON.stringify({ ...doc, [key]: selection }),
		entityIds: selection.entityIds,
	});
}

function migrateTable(
	db: Database,
	table: string,
	jsonColumn: string,
	key: string,
	entityIds: Set<string>,
): boolean {
	const rows = db.query<DocRow, []>(`SELECT id, ${jsonColumn} AS json FROM ${table}`).all();
	const tally: Tally = {
		total: 0,
		absent: 0,
		alreadyFlat: 0,
		parseFailed: [],
		rewrites: [],
		droppedNoteIds: 0,
	};
	for (const row of rows) rewriteDocument(row, key, tally);

	const selected = tally.rewrites.flatMap((r) => r.entityIds);
	const distinct = [...new Set(selected)];
	const unresolvable = distinct.filter((id) => !entityIds.has(id));

	console.log(`\n── ${table}.${jsonColumn} -> .${key}`);
	console.log(`rows              : ${tally.total}`);
	console.log(`  no selection    : ${tally.absent}`);
	console.log(`  already flat    : ${tally.alreadyFlat}`);
	console.log(`  to rewrite      : ${tally.rewrites.length}`);
	console.log(
		`  parse failures  : ${tally.parseFailed.length}${tally.parseFailed.length ? ` (${tally.parseFailed.slice(0, 5).join(", ")})` : ""}`,
	);
	console.log(`entity ids kept   : ${selected.length} (${distinct.length} distinct)`);
	console.log(`note ids dropped  : ${tally.droppedNoteIds}`);
	console.log(
		`unresolvable ids  : ${unresolvable.length}${unresolvable.length ? ` — preserved: ${unresolvable.join(", ")}` : ""}`,
	);

	// Conservation: every row is accounted for by exactly one outcome. A row that
	// is none of these means the pass silently skipped a document.
	const accountedFor =
		tally.absent + tally.alreadyFlat + tally.rewrites.length + tally.parseFailed.length;
	const conserved = accountedFor === tally.total;
	console.log(
		`conservation      : ${accountedFor} accounted / ${tally.total} rows ${conserved ? "OK" : "MISMATCH"}`,
	);
	if (!conserved) {
		console.error(
			`ABORT: row conservation failed for ${table} — refusing to write a partial rewrite.`,
		);
		return false;
	}
	if (tally.parseFailed.length > 0) {
		console.error(
			`ABORT: ${tally.parseFailed.length} document(s) in ${table} do not parse — fix them before rewriting the table.`,
		);
		return false;
	}
	if (dryRun || tally.rewrites.length === 0) return true;

	const update = db.prepare(`UPDATE ${table} SET ${jsonColumn} = ? WHERE id = ?`);
	db.exec("BEGIN");
	try {
		let changed = 0;
		for (const r of tally.rewrites) changed += update.run(r.json, r.id).changes;
		// Every planned rewrite must hit exactly one row. Anything else means the
		// document set moved under us, so the whole table rolls back rather than
		// leaving half the rows in each shape.
		if (changed !== tally.rewrites.length) {
			throw new Error(`updated ${changed} rows, expected ${tally.rewrites.length}`);
		}
		db.exec("COMMIT");
		console.log(`written           : ${changed} rows`);
	} catch (err) {
		db.exec("ROLLBACK");
		console.error(`ABORT: rewrite failed for ${table}, rolled back.`, err);
		return false;
	}
	return true;
}

/** Post-write assertion: no document in either table still carries a bucket key. */
function verify(db: Database): void {
	const remaining = (table: string, column: string, key: string): number => {
		const rows = db.query<{ json: string }, []>(`SELECT ${column} AS json FROM ${table}`).all();
		return rows.filter((r) => {
			try {
				// SAFETY: the column holds a JSON object this app wrote. The cast
				// reaches one key, the optional chain covers a null or primitive
				// payload, and the catch below counts an unparseable row as
				// unmigrated — the safe direction for a verification pass.
				const parsed = JSON.parse(r.json) as Record<string, unknown> | null;
				return !isFlatSelection(parsed?.[key]);
			} catch {
				return true;
			}
		}).length;
	};
	const sb = remaining("content_storyboards", "storyboard_json", "projectReferences");
	const pr = remaining("content_presets", "preset_json", "projectRefs");
	console.log(
		`\nverification      : storyboards=${sb} presets=${pr} still four-bucket ${sb + pr === 0 ? "OK" : "FAIL"}`,
	);
	if (sb + pr > 0) process.exit(1);
}

function main(): void {
	const db = new Database(dbPath);
	const entityIds = new Set(
		db
			.query<{ id: string }, []>(`SELECT id FROM reference_entity`)
			.all()
			.map((r) => r.id),
	);

	console.log(`db                : ${dbPath}`);
	console.log(`mode              : ${dryRun ? "DRY RUN" : "WRITE"}`);
	console.log(`reference entities: ${entityIds.size}`);

	const ok =
		migrateTable(db, "content_storyboards", "storyboard_json", "projectReferences", entityIds) &&
		migrateTable(db, "content_presets", "preset_json", "projectRefs", entityIds);
	if (!ok) {
		db.close();
		process.exit(1);
	}

	if (dryRun) {
		console.log("\nDry run — nothing written.");
		db.close();
		return;
	}
	verify(db);
	db.close();
}

main();
