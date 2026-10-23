/* The project command log's submit and read paths (`p1-command-log` D2).
 *
 * A submission executes each command against the CURRENT head, in the Rust
 * engine the editor runs, under the same per-project lock every storyboard
 * writer takes. A command the engine refuses, or whose result fails the save
 * route's rules, is rejected and the next one runs. The accepted ones become one
 * new version, whose log entry holds them. */
import { openDb } from "@maleo/db/connection";
import { serialize, type Db } from "@maleo/db/handle";
import {
	commandEntriesBetween,
	commandOutcomes,
	headCommandSeq,
	recordCommandRejection,
	type CommandLogEntry,
	type CommandRejection,
	type LoggedCommand,
} from "@maleo/db/project-commands";
import { syncProjectReferenceLock } from "@maleo/db/references";
import {
	addContentStoryboard,
	mapContentStoryboardRow,
	type ContentStoryboardRow,
	type StoredStoryboardRow,
} from "@maleo/db/storyboards";
import { readStoryboardDocument, type StoredStoryboardDocument } from "@maleo/shared";
import {
	replaceScope,
	storyboardScope,
	storyboardWithScope,
	type EditorCommand,
	type EditScope,
} from "@maleo/shared/editor";
import { editorEngine } from "./editor-engine.ts";
import { prepareStoryboardSave } from "./storyboard-save.ts";

export interface SubmittedCommand {
	readonly clientCommandId: string;
	readonly command: EditorCommand;
}

export interface SubmitResult {
	readonly headSeq: number;
	readonly headVersion: number;
	readonly accepted: {
		readonly clientCommandId: string;
		readonly seq: number;
		readonly version: number;
	}[];
	readonly rejected: ({ readonly clientCommandId: string } & CommandRejection)[];
	/** Entries after the base sequence the client has not seen, in order. */
	readonly delivered: CommandLogEntry[];
}

export interface CommandLogRead {
	readonly headSeq: number;
	readonly headVersion: number;
	/** The head version's storyboard id; null before the first version. */
	readonly headStoryboardId: string | null;
	readonly entries: CommandLogEntry[];
}

async function headRow(db: Db, projectId: string): Promise<ContentStoryboardRow | null> {
	const row = await db.get<StoredStoryboardRow>(
		`SELECT * FROM content_storyboards WHERE project_id = ? ORDER BY version DESC LIMIT 1`,
		[projectId],
	);
	return row ? mapContentStoryboardRow(row) : null;
}

const snapshotOf = (head: ContentStoryboardRow, seq: number): CommandLogEntry => ({
	seq,
	version: head.version,
	commands: [replaceScope(storyboardScope(head.storyboard_json))],
	actor: "system",
	snapshot: true,
});

/** Entries at sequences in `(after, headSeq]`, or one snapshot of the head
 *  when the log no longer holds them all. */
async function entriesAfter(
	db: Db,
	projectId: string,
	after: number,
	headSeq: number,
	head: ContentStoryboardRow | null,
): Promise<CommandLogEntry[]> {
	if (headSeq <= after) return [];
	const entries = await commandEntriesBetween(projectId, after, headSeq, db);
	if (entries) return entries;
	return head ? [snapshotOf(head, headSeq)] : [];
}

type Executed =
	| { ok: true; scope: EditScope; storyboard_json: StoredStoryboardDocument }
	| { ok: false; error: CommandRejection };

/** One command against `scope`, and the document it would save. */
function executeOne(head: unknown, scope: EditScope, command: EditorCommand): Executed {
	const result = editorEngine().executeOnce(JSON.stringify(scope), JSON.stringify(command));
	if (!result.ok) return { ok: false, error: result.error };
	// SAFETY: `{scope, inverse}` as the engine writes it; the scope is the admitted one, edited.
	const next = (JSON.parse(result.value) as { scope: EditScope }).scope;
	let written: StoredStoryboardDocument;
	try {
		written = storyboardWithScope(head, next);
	} catch (error) {
		return {
			ok: false,
			error: {
				kind: "invalid_document",
				message: error instanceof Error ? error.message : String(error),
			},
		};
	}
	const checked = prepareStoryboardSave(written, head);
	if (!checked.ok)
		return {
			ok: false,
			error: {
				kind: checked.error,
				message: [checked.message, ...(checked.issues ?? [])].filter(Boolean).join(" "),
			},
		};
	return { ok: true, scope: next, storyboard_json: checked.storyboard_json };
}

/** Null when the project does not exist. */
export async function submitCommands(
	projectId: string,
	baseSeq: number,
	commands: readonly SubmittedCommand[],
	db: Db = openDb(),
): Promise<SubmitResult | null> {
	const exists = await db.get(`SELECT 1 AS ok FROM content_projects WHERE id = ?`, [projectId]);
	if (!exists) return null;
	const result = await db.transaction(async (tx) => {
		// The lock `addContentStoryboard` takes, held across the read of the head.
		await serialize(tx, `storyboard-version:${projectId}`);
		const known = await commandOutcomes(
			projectId,
			commands.map((c) => c.clientCommandId),
			tx,
		);
		const head = await headRow(tx, projectId);
		const headSeq = await headCommandSeq(tx, projectId);
		let scope = storyboardScope(head?.storyboard_json);
		let written: StoredStoryboardDocument | undefined;
		const fresh: LoggedCommand[] = [];
		const accepted: SubmitResult["accepted"] = [];
		const rejected: SubmitResult["rejected"] = [];
		for (const { clientCommandId, command } of commands) {
			const outcome = known.get(clientCommandId);
			if (outcome?.state === "accepted") {
				accepted.push({ clientCommandId, seq: outcome.seq, version: outcome.version });
				continue;
			}
			if (outcome?.state === "rejected") {
				rejected.push({ clientCommandId, ...outcome.error });
				continue;
			}
			const executed = executeOne(head?.storyboard_json, scope, command);
			if (!executed.ok) {
				await recordCommandRejection(tx, projectId, clientCommandId, executed.error);
				rejected.push({ clientCommandId, ...executed.error });
				continue;
			}
			scope = executed.scope;
			written = executed.storyboard_json;
			fresh.push({ command, clientCommandId });
		}
		/* What this client already knows: its own accepted entries, from this
		 * submission or the attempt it is retrying. */
		const own = new Set(accepted.map((a) => a.seq));
		const delivered = (await entriesAfter(tx, projectId, baseSeq, headSeq, head)).filter(
			(entry) => !own.has(entry.seq),
		);
		if (!written)
			return { headSeq, headVersion: head?.version ?? 0, accepted, rejected, delivered };
		const saved = await addContentStoryboard(
			{ project_id: projectId, storyboard_json: written, commands: fresh, actor_type: "editor" },
			tx,
		);
		if (!saved) throw new Error(`project ${projectId} vanished while saving commands`);
		// Still under the lock: the newest sequence is the entry just written.
		const seq = await headCommandSeq(tx, projectId);
		for (const { clientCommandId } of fresh)
			accepted.push({ clientCommandId: clientCommandId!, seq, version: saved.version });
		return { headSeq: seq, headVersion: saved.version, accepted, rejected, delivered, written };
	});
	if ("written" in result && result.written) {
		// The roster follows the lock the document names, as the save route does.
		await syncProjectReferenceLock({
			project_id: projectId,
			entity_ids: readStoryboardDocument(result.written).doc.projectReferences.entityIds,
		});
	}
	const { headSeq, headVersion, accepted, rejected, delivered } = result;
	return { headSeq, headVersion, accepted, rejected, delivered };
}

/** Null when the project does not exist. */
export async function readCommandLog(
	projectId: string,
	/** Absent: the head only, for a client learning where it starts. */
	after: number | undefined,
	db: Db = openDb(),
): Promise<CommandLogRead | null> {
	const exists = await db.get(`SELECT 1 AS ok FROM content_projects WHERE id = ?`, [projectId]);
	if (!exists) return null;
	const head = await headRow(db, projectId);
	const headSeq = await headCommandSeq(db, projectId);
	return {
		headSeq,
		headVersion: head?.version ?? 0,
		headStoryboardId: head?.id ?? null,
		entries: after === undefined ? [] : await entriesAfter(db, projectId, after, headSeq, head),
	};
}

/** Fields of the stored document outside the editable scope (design D4). */
export interface PresentationPatch {
	readonly pacingDevices?: unknown;
	readonly infographicStyle?: unknown;
	readonly presentation?: unknown;
}

/** Write `patch` onto the head as a new version, reading the head under the
 *  version lock so no concurrent write is overwritten. Null when the project
 *  does not exist. */
export async function writePresentation(
	projectId: string,
	patch: PresentationPatch,
	db: Db = openDb(),
): Promise<ContentStoryboardRow | null> {
	const exists = await db.get(`SELECT 1 AS ok FROM content_projects WHERE id = ?`, [projectId]);
	if (!exists) return null;
	return db.transaction(async (tx) => {
		await serialize(tx, `storyboard-version:${projectId}`);
		const head = (await headRow(tx, projectId))?.storyboard_json;
		const prior = head && typeof head === "object" ? head : {};
		const written = storyboardWithScope({ ...prior, ...patch }, storyboardScope(head));
		const checked = prepareStoryboardSave(written, head);
		if (!checked.ok) throw new Error(`presentation save refused: ${checked.error}`);
		return addContentStoryboard(
			{ project_id: projectId, storyboard_json: checked.storyboard_json, actor_type: "editor" },
			tx,
		);
	});
}
