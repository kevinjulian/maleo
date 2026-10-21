#!/usr/bin/env bun
/* Restore `content_projects.editor_state_json` from a snapshot.
 *
 * Editor state holds chat, media assets, settings, creative direction, hook
 * variants and track flags. Between 05:38 and 06:07 on 2026-07-30 the table was
 * rebuilt WITHOUT that column, which destroyed all of it: 141 projects, 63 of
 * them carrying chat, 2,883 messages. `applyUnifiedSchema` then re-added the
 * column on the next open, so the schema healed and the data did not — which is
 * why nothing surfaced an error.
 *
 * The restore is wholesale per project. The only live values are the two
 * projects opened during verification on 2026-07-31, whose autosave wrote the
 * post-loss empty state; the snapshot copy is strictly better for both.
 *
 * Usage:
 *   bun scripts/restore-editor-state.ts --from <snapshot.db> --dry-run
 *   bun scripts/restore-editor-state.ts --from <snapshot.db>
 */
import { Database } from "bun:sqlite";
import { fieldOf } from "../packages/shared/src/object-keys.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const fromIndex = process.argv.indexOf("--from");
if (fromIndex === -1 || !process.argv[fromIndex + 1]) {
	console.error("--from <snapshot.db> is required");
	process.exit(1);
}
const sourcePath = path.resolve(process.argv[fromIndex + 1]!);
const dbArgIndex = process.argv.indexOf("--db");
const targetPath =
	dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
		? path.resolve(process.argv[dbArgIndex + 1]!)
		: path.join(repoRoot, "data", "maleo.db");

interface Row {
	id: string;
	editor_state_json: string;
}

function chatLength(json: string): number {
	try {
		const chat = fieldOf(JSON.parse(json), "chat");
		return Array.isArray(chat) ? chat.length : 0;
	} catch {
		return 0;
	}
}

const source = new Database(sourcePath);
const target = new Database(targetPath);

const SELECT_STATE = `SELECT id, editor_state_json FROM content_projects WHERE editor_state_json IS NOT NULL`;

const saved = source.query<Row, []>(SELECT_STATE).all();

/* Only restore into projects that still exist, or the write is a silent no-op. */
const liveIds = new Set(
	target
		.query<{ id: string }, []>(`SELECT id FROM content_projects`)
		.all()
		.map((r) => r.id),
);
const liveState = new Map(
	target
		.query<Row, []>(SELECT_STATE)
		.all()
		.map((r) => [r.id, r.editor_state_json]),
);

const restorable = saved.filter((r) => liveIds.has(r.id));
const missingProject = saved.filter((r) => !liveIds.has(r.id));
const overwriting = restorable.filter((r) => liveState.has(r.id));
const chatRecovered = restorable.reduce((n, r) => n + chatLength(r.editor_state_json), 0);
const chatLost = [...liveState.values()].reduce((n, j) => n + chatLength(j), 0);

console.log(`source            : ${sourcePath}`);
console.log(`target            : ${targetPath}`);
console.log(`mode              : ${dryRun ? "DRY RUN" : "WRITE"}`);
console.log(`saved editor state: ${saved.length} projects`);
console.log(`  restorable      : ${restorable.length}`);
console.log(
	`  project missing : ${missingProject.length}${
		missingProject.length
			? ` (${missingProject
					.slice(0, 5)
					.map((r) => r.id.slice(0, 8))
					.join(", ")})`
			: ""
	}`,
);
console.log(
	`  overwriting live: ${overwriting.length} — live chat in those: ${chatLost} message(s)`,
);
console.log(
	`chat recovered    : ${chatRecovered} message(s) across ${restorable.filter((r) => chatLength(r.editor_state_json) > 0).length} projects`,
);

// Overwriting live editor state that holds chat would trade one loss for another.
if (chatLost > 0) {
	console.error(
		"ABORT: live editor state carries chat; restoring wholesale would destroy it. Merge instead.",
	);
	process.exit(1);
}

if (dryRun) {
	console.log("\nDry run — nothing written.");
	process.exit(0);
}

const update = target.prepare(`UPDATE content_projects SET editor_state_json = ? WHERE id = ?`);
target.exec("BEGIN");
try {
	let changed = 0;
	for (const r of restorable) changed += update.run(r.editor_state_json, r.id).changes;
	if (changed !== restorable.length)
		throw new Error(`updated ${changed} rows, expected ${restorable.length}`);
	target.exec("COMMIT");
	console.log(`\nwritten           : ${changed} rows`);
} catch (err) {
	target.exec("ROLLBACK");
	console.error("ABORT: restore failed, rolled back.", err);
	process.exit(1);
}

const after = target
	.query<{ rows: number; msgs: number }, []>(
		`SELECT count(*) AS rows, coalesce(sum(json_array_length(json_extract(editor_state_json, '$.chat'))), 0) AS msgs
	 FROM content_projects WHERE editor_state_json IS NOT NULL`,
	)
	.get() ?? { rows: 0, msgs: 0 };
console.log(
	`verification      : ${after.rows} projects with editor state, ${after.msgs} chat messages`,
);
if (after.msgs < chatRecovered) {
	console.error("ABORT: fewer messages present than restored.");
	process.exit(1);
}
