/* Rewrite persisted shapes that only the migration shims still understand.
 *
 * Each shape below is read by a shim listed in `check-migration-shims.ts`. Once
 * this has run in an environment, that environment's shim counts drop; once it
 * has run in EVERY environment, the shim itself can be deleted.
 *
 *   bun scripts/migrate-retired-shapes.ts            # dry run, changes nothing
 *   bun scripts/migrate-retired-shapes.ts --apply    # writes
 *
 * Read this before applying:
 *
 * - BACK UP FIRST. This rewrites JSON blobs in place. `cp data/maleo.db{,.bak}`
 *   is enough for sqlite, and on a large database that copy is not instant.
 * - Running it on a DEV database does NOT license deleting a shim. A shim serves
 *   every environment; a local count of zero only means this machine is migrated.
 * - It is idempotent: rows already migrated no longer match.
 * - It streams in pages. An earlier version selected every matching row at once
 *   and was OOM-killed on a 7.3 GB database before printing a line.
 * - It is content-preserving. The plan rename swaps a discriminant; the projected
 *   plan is a derived duplicate of a plan the same storyboard already holds; the
 *   retired blueprint artifact is dropped because nothing can render it.
 *
 * Why this exists rather than "wait for the data to age out": storyboards are
 * versioned, so editing a project that holds one of these artifacts writes a NEW
 * version carrying it forward. One legacy project took its projected-plan count
 * from 10 to 12 just by being opened. Those counts do not decay on their own. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

const APPLY = process.argv.includes("--apply");
const dbPath = process.env.MALEO_DB_PATH ?? "data/maleo.db";

if (!existsSync(dbPath)) {
	console.error(`migrate-retired-shapes: no database at ${dbPath}`);
	process.exit(1);
}

interface Artifact {
	kind?: string;
	plan?: unknown;
	sections?: unknown;
}

/** Rewrite one artifact array. Returns null when nothing changed. */
function migrateArtifacts(
	raw: unknown,
): { next: unknown[]; renamed: number; projected: number; blueprint: number } | null {
	if (!Array.isArray(raw)) return null;
	let renamed = 0,
		projected = 0,
		blueprint = 0;
	const next: unknown[] = [];
	for (const entry of raw) {
		// SAFETY: widened to an all-optional shape from untrusted JSON; the next line rejects anything that is not an object before any field is read.
		const a = entry as Artifact | null;
		if (!a || typeof a !== "object") {
			next.push(entry);
			continue;
		}
		if (a.kind === "video_blueprint") {
			blueprint++;
			continue;
		}
		if (a.kind === "story_plan" && !Array.isArray(a.sections) && a.plan !== undefined) {
			projected++;
			continue;
		}
		if (a.kind === "longform_plan") {
			renamed++;
			next.push({ ...a, kind: "story_plan" });
			continue;
		}
		next.push(entry);
	}
	if (!renamed && !projected && !blueprint) return null;
	return { next, renamed, projected, blueprint };
}

/* Keyset pagination. These blobs are large, so the result set is walked a page at
 * a time rather than materialised. Ordering by id keeps the cursor stable even as
 * rows are rewritten underneath it. */
const PAGE = 200;
function* pages<T extends { id: string }>(select: {
	all: (cursor: string, limit: number) => T[];
}): Generator<T> {
	let cursor = "";
	for (;;) {
		const page = select.all(cursor, PAGE);
		if (page.length === 0) return;
		for (const row of page) yield row;
		cursor = page[page.length - 1]!.id;
		if (page.length < PAGE) return;
	}
}

const db = new Database(dbPath, { readonly: !APPLY });
const t = { storyboards: 0, projects: 0, runs: 0, renamed: 0, projected: 0, blueprint: 0 };

// ── storyboards: artifacts live at storyboard_json.artifacts ────────────────
{
	const select = db.query<{ id: string; storyboard_json: string }, [string, number]>(
		`select id, storyboard_json from content_storyboards
		 where (storyboard_json like '%"longform_plan"%'
		     or storyboard_json like '%"video_blueprint"%'
		     or storyboard_json like '%"story_plan"%')
		   and id > ? order by id limit ?`,
	);
	const update = APPLY
		? db.prepare("update content_storyboards set storyboard_json = ? where id = ?")
		: null;
	for (const row of pages(select)) {
		let doc: { artifacts?: unknown };
		try {
			// SAFETY: `artifacts` is declared `unknown` and `migrateArtifacts` rejects a non-array before reading it.
			doc = JSON.parse(row.storyboard_json) as { artifacts?: unknown };
		} catch {
			continue;
		}
		const result = migrateArtifacts(doc.artifacts);
		if (!result) continue;
		t.storyboards++;
		t.renamed += result.renamed;
		t.projected += result.projected;
		t.blueprint += result.blueprint;
		update?.run(JSON.stringify({ ...doc, artifacts: result.next }), row.id);
	}
}

// ── projects: an artifact hangs off each chat message ───────────────────────
{
	const select = db.query<{ id: string; editor_state_json: string }, [string, number]>(
		`select id, editor_state_json from content_projects
		 where (editor_state_json like '%"longform_plan"%' or editor_state_json like '%"video_blueprint"%')
		   and id > ? order by id limit ?`,
	);
	const update = APPLY
		? db.prepare("update content_projects set editor_state_json = ? where id = ?")
		: null;
	for (const row of pages(select)) {
		let state: { chat?: unknown };
		try {
			// SAFETY: `chat` is declared `unknown` and guarded by `Array.isArray` immediately below.
			state = JSON.parse(row.editor_state_json) as { chat?: unknown };
		} catch {
			continue;
		}
		if (!Array.isArray(state.chat)) continue;
		let touched = false;
		const chat = state.chat
			.map((m) => {
				// SAFETY: widened to an all-optional shape from untrusted JSON; `a` is checked for null and object-ness before any field is read.
				const msg = m as { artifact?: Artifact } | null;
				const a = msg?.artifact;
				if (!a || typeof a !== "object") return m;
				if (a.kind === "video_blueprint") {
					touched = true;
					t.blueprint++;
					return { ...msg, artifact: undefined };
				}
				if (a.kind === "longform_plan") {
					touched = true;
					t.renamed++;
					return { ...msg, artifact: { ...a, kind: "story_plan" } };
				}
				return m;
			})
			.filter((m) => {
				// SAFETY: both fields are declared `unknown` and only compared against `undefined`, so no property is dereferenced.
				const msg = m as { artifact?: unknown; text?: unknown };
				// A message whose only content was the dropped artifact has nothing left.
				return msg.artifact !== undefined || msg.text !== undefined;
			});
		if (!touched) continue;
		t.projects++;
		update?.run(JSON.stringify({ ...state, chat }), row.id);
	}
}

// ── parked runs: the tool + intent a resume dispatches by name ──────────────
{
	const rows = db
		.query<{ id: string; snapshot_json: string }, []>(
			`select id, snapshot_json from workflow_run
		 where status in ('awaiting_input','needs_attention','running')
		   and (snapshot_json like '%generate_longform_assets%' or snapshot_json like '%build_longform%')`,
		)
		.all();
	const update = APPLY
		? db.prepare("update workflow_run set snapshot_json = ? where id = ?")
		: null;
	for (const row of rows) {
		const after = row.snapshot_json
			.replaceAll("generate_longform_assets", "generate_story_assets")
			.replaceAll("create_longform_video", "create_story_video")
			.replaceAll("build_longform", "build_story");
		if (after === row.snapshot_json) continue;
		t.runs++;
		update?.run(after, row.id);
	}
}

db.close();

console.log(
	`migrate-retired-shapes: ${dbPath} — ${APPLY ? "APPLIED" : "dry run, nothing written"}\n`,
);
console.log(`  storyboards touched      ${t.storyboards}`);
console.log(`  projects touched         ${t.projects}`);
console.log(`  parked runs touched      ${t.runs}`);
console.log(`  plan artifacts renamed   ${t.renamed}`);
console.log(`  projected plans dropped  ${t.projected}`);
console.log(`  blueprints dropped       ${t.blueprint}`);
if (!APPLY) console.log(`\nRe-run with --apply to write. Back up ${dbPath} first.`);
