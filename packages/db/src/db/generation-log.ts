/* The per-workspace generation logs — what an image or video render cost and
 * when, which the workspace quota reads.
 *
 * The policy modules used to hold this SQL themselves, reaching the connection
 * through a pass-through that ignored its workspace argument. The tenancy filter
 * now belongs to the module that owns the table rather than to a comment asking
 * every caller to remember it.
 *
 * Image and video are the same log against two tables. They were written out
 * twice — four functions each, differing in one identifier — so a fix to the day
 * boundary or the tenancy filter had to be made in both halves, and the two had
 * already drifted in what the today-query selects. One factory, two tables. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export interface GenerationLogEntry {
	kind: string;
	channel: string | null;
	cost_usd: number | null;
	created_at: number;
}

export interface GenerationRecord {
	workspace: string;
	kind: string;
	channel?: string | null;
	cost_usd?: number | null;
}

function startOfTodayMs(): number {
	const d = new Date();
	d.setHours(0, 0, 0, 0);
	return d.getTime();
}

interface GenerationLog {
	/** Today's entries for a workspace, for the quota gate to count and price. */
	listToday: (workspace: string, db?: Db) => Promise<GenerationLogEntry[]>;
	lastAt: (workspace: string, db?: Db) => Promise<number | null>;
	record: (input: GenerationRecord, db?: Db) => Promise<void>;
	/** Clears a workspace's log and reports how many rows went. */
	reset: (workspace: string, db?: Db) => Promise<number>;
}

// The table name is the only difference, and it is a literal supplied here — no
// value from outside this module reaches the SQL. Parameters are annotated
// rather than inferred from GenerationLog so the handle guard can still read the
// `db: Db = openDb()` default it enforces.
function generationLog(table: string): GenerationLog {
	return {
		listToday: (workspace: string, db: Db = openDb()) =>
			db.all<GenerationLogEntry>(
				`SELECT kind, channel, cost_usd, created_at FROM ${table} WHERE workspace = ? AND created_at >= ?`,
				[workspace, startOfTodayMs()],
			),

		lastAt: async (workspace: string, db: Db = openDb()) => {
			const row = await db.get<{ created_at: number }>(
				`SELECT created_at FROM ${table} WHERE workspace = ? ORDER BY created_at DESC LIMIT 1`,
				[workspace],
			);
			return row?.created_at ?? null;
		},

		record: async (input: GenerationRecord, db: Db = openDb()) => {
			await db.run(
				`INSERT INTO ${table} (workspace, kind, channel, cost_usd, created_at) VALUES (?, ?, ?, ?, ?)`,
				[input.workspace, input.kind, input.channel ?? null, input.cost_usd || null, Date.now()],
			);
		},

		reset: async (workspace: string, db: Db = openDb()) => {
			const { changes } = await db.run(`DELETE FROM ${table} WHERE workspace = ?`, [workspace]);
			return changes;
		},
	};
}

const imageLog = generationLog("image_generation_log");
const videoLog = generationLog("video_generation_log");

export const listImageGenerationsToday = imageLog.listToday;
export const lastImageGenerationAt = imageLog.lastAt;
export const recordImageGeneration = imageLog.record;
export const resetImageGenerationLog = imageLog.reset;

export const listVideoGenerationsToday = videoLog.listToday;
export const lastVideoGenerationAt = videoLog.lastAt;
export const recordVideoGeneration = videoLog.record;
export const resetVideoGenerationLog = videoLog.reset;
