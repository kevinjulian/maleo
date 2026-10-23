/* Storyboards — the versioned document a project renders from. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";
import { parseJsonValue } from "./row-json.ts";
import { recordContentProjectEventDb } from "./events.ts";
import { replaceScope } from "@maleo/shared/editor/commands";
import { storyboardScope } from "@maleo/shared/editor/storyboard-scope";
import { recordCommandEntry, type LoggedCommand } from "./project-commands.ts";
import {
	pruneStoryboardVersions,
	storyboardRetentionPolicy,
	type StoryboardRetentionPolicy,
} from "./storyboard-retention.ts";

export interface ContentStoryboardRow {
	id: string;
	project_id: string;
	version: number;
	status: string;
	source_prompt: string | null;
	reference_notes: string | null;
	/* The decoded blob, at the only type this layer can honestly give it. The
	 * document's shape belongs to `@maleo/shared`'s `storyboard-document`, which
	 * owns both its reader and its writer and tolerates three generations of it;
	 * this row is the transport. Declaring it `Record<string, unknown>` here made
	 * every consumer take a dictionary and then walk it — which is exactly how the
	 * agent came to hold a second, drifting reader of the same field. `unknown`
	 * sends them through `readStoryboardDocument` instead, which is the point. */
	storyboard_json: unknown;
	created_at: number;
}

/** The row as SQLite returns it: `storyboard_json` is still the stored text.
 *  Named because three modules spelled this `Omit<…> & { … }` out by hand. */
export type StoredStoryboardRow = Omit<ContentStoryboardRow, "storyboard_json"> & {
	storyboard_json: string;
};

export function mapContentStoryboardRow(row: StoredStoryboardRow): ContentStoryboardRow {
	return {
		...row,
		storyboard_json: parseJsonValue<unknown>(row.storyboard_json, {}),
	};
}

export class StoryboardRevisionConflict extends Error {
	constructor() {
		super("Storyboard changed while saving; reload and retry.");
	}
}

/** Write a new version and enforce retention, as one transaction: a write that
 *  fails prunes nothing, and the bound holds after every write rather than after
 *  a maintenance pass. See `storyboard-retention.ts` for what is kept.
 *
 *  The version's command log entry is written in the same transaction: the
 *  `commands` that produced it, or — for a writer that submits none — one
 *  `scope.replace` of the written document's editable scope. */
export async function addContentStoryboard(
	input: {
		project_id: string;
		expectedRevisionId?: string | null;
		source_prompt?: string | null;
		reference_notes?: string | null;
		status?: string;
		storyboard_json: Record<string, unknown>;
		commands?: readonly LoggedCommand[];
		actor_type?: string;
	},
	db: Db = openDb(),
	retention: StoryboardRetentionPolicy = storyboardRetentionPolicy(),
): Promise<ContentStoryboardRow | null> {
	// Existence check only — this used to call the seven-family project aggregate
	// to answer "does this project exist?".
	const exists = await db.get<{ ok: number }>(`SELECT 1 AS ok FROM content_projects WHERE id = ?`, [
		input.project_id,
	]);
	if (!exists) return null;
	const id = randomUUID();
	await db.transaction(async (tx) => {
		// Two writers must not both read the same MAX(version).
		await serialize(tx, `storyboard-version:${input.project_id}`);
		if (input.expectedRevisionId !== undefined) {
			const latest = await tx.get<{ id: string }>(
				`SELECT id FROM content_storyboards WHERE project_id = ? ORDER BY version DESC LIMIT 1`,
				[input.project_id],
			);
			if ((latest?.id ?? null) !== input.expectedRevisionId) throw new StoryboardRevisionConflict();
		}
		// The newest version is never pruned, so the highest retained number is the
		// highest ever issued and a pruned number is never reused.
		const row = await tx.get<{ v: number }>(
			`SELECT COALESCE(MAX(version), 0) AS v FROM content_storyboards WHERE project_id = ?`,
			[input.project_id],
		);
		const version = (row?.v ?? 0) + 1;
		const now = Date.now();
		await tx.run(
			`INSERT INTO content_storyboards
			 (id, project_id, version, status, source_prompt, reference_notes, storyboard_json, created_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.project_id,
				version,
				input.status ?? "draft",
				input.source_prompt ?? null,
				input.reference_notes ?? null,
				JSON.stringify(input.storyboard_json),
				now,
			],
		);
		await tx.run(`UPDATE content_projects SET status = ?, updated_at = ? WHERE id = ?`, [
			"storyboard",
			now,
			input.project_id,
		]);
		await recordContentProjectEventDb(tx, {
			project_id: input.project_id,
			storyboard_id: id,
			actor_type: "system",
			kind: "storyboard.created",
			summary: `Storyboard v${version} created.`,
			payload_json: {
				version,
				status: input.status ?? "draft",
			},
			created_at: now,
		});
		await recordCommandEntry(tx, {
			project_id: input.project_id,
			version,
			commands: input.commands ?? [
				{ command: replaceScope(storyboardScope(input.storyboard_json)) },
			],
			actor_type: input.actor_type ?? "system",
			created_at: now,
		});
		await pruneStoryboardVersions(tx, input.project_id, retention);
	});
	const saved = await db.get<StoredStoryboardRow>(
		`SELECT * FROM content_storyboards WHERE id = ?`,
		[id],
	);
	return saved ? mapContentStoryboardRow(saved) : null;
}

/** One version of a project's storyboard, read by number.
 *
 *  Three answers besides the document, never collapsed: a pruned version (it was
 *  issued and retention dropped it), a version that was never issued, and a read
 *  that failed. A retention bug must not look like a bad request, and no reader
 *  is handed a different version in place of the one it asked for. */
export type StoryboardVersionRead =
	| { readonly state: "found"; readonly row: ContentStoryboardRow }
	| { readonly state: "pruned"; readonly version: number }
	| { readonly state: "never_existed"; readonly version: number }
	| { readonly state: "read_failed"; readonly version: number; readonly message: string };

export async function readStoryboardVersion(
	projectId: string,
	version: number,
	db: Db = openDb(),
): Promise<StoryboardVersionRead> {
	try {
		const row = await db.get<StoredStoryboardRow>(
			`SELECT * FROM content_storyboards WHERE project_id = ? AND version = ?`,
			[projectId, version],
		);
		if (row) return { state: "found", row: mapContentStoryboardRow(row) };
		const issued =
			(
				await db.get<{ v: number }>(
					`SELECT COALESCE(MAX(version), 0) AS v FROM content_storyboards WHERE project_id = ?`,
					[projectId],
				)
			)?.v ?? 0;
		const wasIssued = Number.isInteger(version) && version >= 1 && version <= issued;
		return { state: wasIssued ? "pruned" : "never_existed", version };
	} catch (error) {
		return {
			state: "read_failed",
			version,
			message: error instanceof Error ? error.message : String(error),
		};
	}
}
