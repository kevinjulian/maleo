#!/usr/bin/env bun
/* Attach every entity a project's generation lock names but that is not on the
 * project's roster.
 *
 * Why this is a repair and not a preference: `resolveEntityRefImages` builds its
 * lookup from `projectCast` — the roster — and skips any declared id it does not
 * find. A locked-but-unattached entity therefore contributes no reference image at
 * generation time, silently. The operator asked for it and got nothing.
 *
 * Only ids that resolve to a `reference_entity` are attached. An id that is not an
 * entity is reported and left alone: inventing a roster row for it would create a
 * reference to something that does not exist.
 *
 * Usage:
 *   bun scripts/repair-unattached-locks.ts --dry-run
 *   bun scripts/repair-unattached-locks.ts --db path/to/copy.db
 *   bun scripts/repair-unattached-locks.ts
 */
import { Database } from "bun:sqlite";
import { fieldOf } from "../packages/shared/src/object-keys.ts";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dryRun = process.argv.includes("--dry-run");
const dbArgIndex = process.argv.indexOf("--db");
const dbPath =
	dbArgIndex !== -1 && process.argv[dbArgIndex + 1]
		? path.resolve(process.argv[dbArgIndex + 1]!)
		: path.join(repoRoot, "data", "maleo.db");

const db = new Database(dbPath);

/* Latest storyboard per project — the lock the editor would load. */
const rows = db
	.query<{ project_id: string; json: string }, []>(`
	SELECT s.project_id AS project_id, s.storyboard_json AS json
	FROM content_storyboards s
	JOIN (SELECT project_id, MAX(version) AS v FROM content_storyboards GROUP BY project_id) m
	  ON m.project_id = s.project_id AND m.v = s.version
`)
	.all();

const roster = new Map<string, Set<string>>();
for (const r of db
	.query<{ project_id: string; entity_id: string }, []>(
		`SELECT project_id, entity_id FROM project_reference WHERE scene_key IS NULL`,
	)
	.all()) {
	if (!roster.has(r.project_id)) roster.set(r.project_id, new Set());
	roster.get(r.project_id)!.add(r.entity_id);
}
const entities = new Set(
	db
		.query<{ id: string }, []>(`SELECT id FROM reference_entity`)
		.all()
		.map((r) => r.id),
);
const workspaceOf = new Map(
	db
		.query<{ id: string; workspace: string }, []>(`SELECT id, workspace FROM content_projects`)
		.all()
		.map((r) => [r.id, r.workspace]),
);
const entityWorkspace = new Map(
	db
		.query<{ id: string; workspace: string }, []>(`SELECT id, workspace FROM reference_entity`)
		.all()
		.map((r) => [r.id, r.workspace]),
);

interface Repair {
	projectId: string;
	entityId: string;
}
const repairs: Repair[] = [];
const notEntities: Array<{ projectId: string; id: string }> = [];
const crossWorkspace: Repair[] = [];

for (const row of rows) {
	let locked: unknown;
	try {
		locked = fieldOf(fieldOf(JSON.parse(row.json), "projectReferences"), "entityIds");
	} catch {
		continue;
	}
	if (!Array.isArray(locked)) continue;
	const attached = roster.get(row.project_id) ?? new Set<string>();
	for (const raw of locked) {
		const id = String(raw);
		if (attached.has(id)) continue;
		if (!entities.has(id)) {
			notEntities.push({ projectId: row.project_id, id });
			continue;
		}
		// The same tenancy rule `addProjectReference` enforces: a project may only
		// hold entities from its own workspace.
		if (entityWorkspace.get(id) !== workspaceOf.get(row.project_id)) {
			crossWorkspace.push({ projectId: row.project_id, entityId: id });
			continue;
		}
		repairs.push({ projectId: row.project_id, entityId: id });
	}
}

console.log(`db                : ${dbPath}`);
console.log(`mode              : ${dryRun ? "DRY RUN" : "WRITE"}`);
console.log(`projects scanned  : ${rows.length}`);
console.log(
	`locks to repair   : ${repairs.length} across ${new Set(repairs.map((r) => r.projectId)).size} projects`,
);
for (const r of repairs.slice(0, 20)) console.log(`  + ${r.projectId} -> ${r.entityId}`);
console.log(
	`not an entity     : ${notEntities.length} — left alone: ${JSON.stringify([...new Set(notEntities.map((n) => n.id))])}`,
);
console.log(`cross-workspace   : ${crossWorkspace.length} — left alone`);

if (dryRun || repairs.length === 0) {
	console.log(dryRun ? "\nDry run — nothing written." : "\nNothing to repair.");
	db.close();
	process.exit(0);
}

const insert = db.prepare(`
	INSERT INTO project_reference (id, project_id, entity_id, scene_key, created_at)
	VALUES (?, ?, ?, NULL, ?)
	ON CONFLICT(project_id, entity_id, ifnull(scene_key, '')) DO NOTHING
`);
const countRefs = (): number =>
	db.query<{ c: number }, []>(`SELECT count(*) AS c FROM project_reference`).get()?.c ?? 0;
const before = countRefs();
db.exec("BEGIN");
try {
	const now = Date.now();
	for (const r of repairs) insert.run(randomUUID(), r.projectId, r.entityId, now);
	db.exec("COMMIT");
} catch (err) {
	db.exec("ROLLBACK");
	console.error("ABORT: repair failed, rolled back.", err);
	db.close();
	process.exit(1);
}
const after = countRefs();
console.log(`\nproject_reference : ${before} -> ${after} rows (+${after - before})`);

/* Every repaired lock must now resolve through the roster. */
const stillInert = repairs.filter(
	(r) =>
		!db
			.query(
				`SELECT 1 FROM project_reference WHERE project_id = ? AND entity_id = ? AND scene_key IS NULL`,
			)
			.get(r.projectId, r.entityId),
);
console.log(
	`verification      : ${stillInert.length} still inert ${stillInert.length === 0 ? "OK" : "FAIL"}`,
);
db.close();
if (stillInert.length > 0) process.exit(1);
