/* The project command log (`p1-command-log`): the editor commands that produced
 * each storyboard version, in order. Entries are ordered by a per-project `seq`,
 * issued as `MAX(seq) + 1` under the storyboard version lock, so it is
 * serialized with every writer and monotonic; each entry names the version it
 * wrote. The sequence is the log's own (D1) so a later entity type can join the
 * feed without writing a version. `addContentStoryboard` writes the entry inside
 * the version's transaction, so a version never exists without it. */
import type { EditorCommand } from "@maleo/shared/editor/commands";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonValue } from "./row-json.ts";

/** One command of a version's entry, with the identity its client sent. */
export interface LoggedCommand {
	readonly command: EditorCommand;
	readonly clientCommandId?: string | null;
}

/** One log entry. `snapshot` marks a head scope served in place of entries the
 *  log no longer holds. */
export interface CommandLogEntry {
	readonly seq: number;
	readonly version: number;
	readonly commands: EditorCommand[];
	readonly actor: string;
	readonly snapshot?: true;
}

export interface CommandRejection {
	readonly kind: string;
	readonly message: string;
}

/** What the server already decided for a client command identity. */
export type CommandOutcome =
	| { readonly state: "accepted"; readonly seq: number; readonly version: number }
	| { readonly state: "rejected"; readonly error: CommandRejection };

/** The highest sequence issued for a project; 0 before its first entry. The
 *  newest entry is never pruned, so this is never a reused number. */
export async function headCommandSeq(db: Db, projectId: string): Promise<number> {
	const row = await db.get<{ s: number }>(
		`SELECT COALESCE(MAX(seq), 0) AS s FROM content_project_commands WHERE project_id = ?`,
		[projectId],
	);
	return row?.s ?? 0;
}

/** Write one entry at the next sequence and return it. The caller holds the
 *  `storyboard-version:<project>` lock. */
export async function recordCommandEntry(
	tx: Db,
	input: {
		project_id: string;
		version: number;
		commands: readonly LoggedCommand[];
		actor_type: string;
		created_at: number;
	},
): Promise<number> {
	// The legacy SQLite file predates the log and is only read for carry-over.
	if (tx.dialect !== "postgres") return 0;
	const seq = (await headCommandSeq(tx, input.project_id)) + 1;
	for (const [position, entry] of input.commands.entries()) {
		await tx.run(
			`INSERT INTO content_project_commands
			 (project_id, seq, position, version, command_json, client_command_id, actor_type, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				input.project_id,
				seq,
				position,
				input.version,
				JSON.stringify(entry.command),
				entry.clientCommandId ?? null,
				input.actor_type,
				input.created_at,
			],
		);
	}
	return seq;
}

export async function recordCommandRejection(
	tx: Db,
	projectId: string,
	clientCommandId: string,
	error: CommandRejection,
): Promise<void> {
	await tx.run(
		`INSERT INTO content_project_command_rejections (project_id, client_command_id, error_json, created_at)
		 VALUES (?, ?, ?, ?)`,
		[projectId, clientCommandId, JSON.stringify(error), Date.now()],
	);
}

/** The outcomes already recorded for these identities; an unknown one is absent. */
export async function commandOutcomes(
	projectId: string,
	ids: readonly string[],
	db: Db = openDb(),
): Promise<Map<string, CommandOutcome>> {
	const outcomes = new Map<string, CommandOutcome>();
	if (!ids.length) return outcomes;
	const marks = ids.map(() => "?").join(",");
	for (const row of await db.all<{ client_command_id: string; seq: number; version: number }>(
		`SELECT client_command_id, seq, version FROM content_project_commands
		 WHERE project_id = ? AND client_command_id IN (${marks})`,
		[projectId, ...ids],
	))
		outcomes.set(row.client_command_id, {
			state: "accepted",
			seq: row.seq,
			version: row.version,
		});
	for (const row of await db.all<{ client_command_id: string; error_json: string }>(
		`SELECT client_command_id, error_json FROM content_project_command_rejections
		 WHERE project_id = ? AND client_command_id IN (${marks})`,
		[projectId, ...ids],
	))
		outcomes.set(row.client_command_id, {
			state: "rejected",
			error: parseJsonValue<CommandRejection>(row.error_json, { kind: "Unknown", message: "" }),
		});
	return outcomes;
}

/** The entries at sequences in `(after, through]`, in order — or null when any
 *  sequence in that range has no entry (pruned, or written before the log), and
 *  the caller serves a snapshot instead. */
export async function commandEntriesBetween(
	projectId: string,
	after: number,
	through: number,
	db: Db = openDb(),
): Promise<CommandLogEntry[] | null> {
	if (through <= after) return [];
	const rows = await db.all<{
		seq: number;
		version: number;
		command_json: string;
		actor_type: string;
	}>(
		`SELECT seq, version, command_json, actor_type FROM content_project_commands
		 WHERE project_id = ? AND seq > ? AND seq <= ?
		 ORDER BY seq, position`,
		[projectId, after, through],
	);
	const entries: CommandLogEntry[] = [];
	for (const row of rows) {
		const command = parseJsonValue<EditorCommand>(row.command_json, { type: "noop" });
		const last = entries.at(-1);
		if (last?.seq === row.seq) last.commands.push(command);
		else
			entries.push({
				seq: row.seq,
				version: row.version,
				commands: [command],
				actor: row.actor_type,
			});
	}
	return entries.length === through - after ? entries : null;
}

/** Drop the entries of versions about to be pruned. Called by retention, in the
 *  transaction that deletes the versions. */
export async function deleteCommandEntries(
	db: Db,
	projectId: string,
	storyboardIds: readonly string[],
): Promise<void> {
	if (!storyboardIds.length || db.dialect !== "postgres") return;
	await db.run(
		`DELETE FROM content_project_commands WHERE project_id = ? AND version IN
		 (SELECT version FROM content_storyboards WHERE project_id = ? AND id IN (${storyboardIds.map(() => "?").join(",")}))`,
		[projectId, projectId, ...storyboardIds],
	);
}

/** The sequence of the entry that wrote `version`; 0 when it has none (written
 *  before the log). An editor that loads that version starts reading after it. */
export async function commandSeqOfVersion(
	projectId: string,
	version: number,
	db: Db = openDb(),
): Promise<number> {
	const row = await db.get<{ seq: number }>(
		`SELECT seq FROM content_project_commands WHERE project_id = ? AND version = ? LIMIT 1`,
		[projectId, version],
	);
	return row?.seq ?? 0;
}
