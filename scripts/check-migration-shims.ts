/* Migration shims and the data that keeps them alive.
 *
 * Every shim below reads a shape this build no longer writes. Each is correct,
 * tested, and load-bearing today — and each becomes permanent unless someone can
 * answer "is it still needed?" without re-deriving the question. This script is
 * that answer: run it, and a shim reporting 0 rows is safe to delete along with
 * its entry here.
 *
 *   bun scripts/check-migration-shims.ts
 *
 * It is reporting, not a gate: a non-zero count is the expected state while the
 * data exists, so this is not wired into `bun run ci`. */
import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";

interface Shim {
	/** What reads the old shape. */
	readonly site: string;
	/** Why it exists, in one line. */
	readonly reason: string;
	/** Rows still requiring it. */
	readonly sql: string;
}

const SHIMS: readonly Shim[] = [
	{
		site: "agent/intent.ts · RETIRED_INTENTS",
		reason: "a resumable run reuses the intent it was classified with, by name",
		sql: `select count(*) as n from workflow_run
		      where snapshot_json like '%build_longform%'
		        and status in ('awaiting_input','needs_attention','running')`,
	},
	{
		site: "agent/registry.ts · RETIRED_TOOL_NAMES",
		reason: "a resumable run snapshot dispatches the tool name it was parked with",
		// Only resumable runs matter: a finished run never dispatches again.
		sql: `select count(*) as n from workflow_run
		      where snapshot_json like '%generate_longform_assets%'
		        and status in ('awaiting_input','needs_attention','running')`,
	},
];

const dbPath = process.env.MALEO_DB_PATH ?? "data/maleo.db";
if (!existsSync(dbPath)) {
	console.log(`check-migration-shims: no database at ${dbPath} — nothing to measure.`);
	process.exit(0);
}

const db = new Database(dbPath, { readonly: true });
let removable = 0;
console.log(`check-migration-shims: ${dbPath}\n`);
for (const shim of SHIMS) {
	let n: number;
	try {
		n = db.query<{ n: number }, []>(shim.sql).get()?.n ?? 0;
	} catch (err) {
		console.log(
			`  ?      ${shim.site}\n         query failed: ${err instanceof Error ? err.message : String(err)}`,
		);
		continue;
	}
	if (n === 0) removable++;
	console.log(`  ${n === 0 ? "REMOVABLE" : String(n).padStart(9)}  ${shim.site}`);
	console.log(`             ${shim.reason}`);
}
db.close();
console.log(
	`\n${SHIMS.length} shim(s); ${removable} at zero rows and safe to delete with their entry here.`,
);
