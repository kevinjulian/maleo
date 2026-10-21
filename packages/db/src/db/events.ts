/* Project events — the audit trail every other family writes into.
 *
 * `recordContentProjectEventDb` takes an explicit handle because five families
 * record an event inside their own statement's connection; that shared handle is
 * a real dependency, not a layering slip. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonValue, isJsonObjectOrNull } from "./row-json.ts";

export interface ContentProjectEventRow {
	id: string;
	project_id: string;
	output_id: string | null;
	storyboard_id: string | null;
	actor_type: string;
	actor_id: string | null;
	kind: string;
	summary: string;
	payload_json: Record<string, unknown> | null;
	created_at: number;
}

/** The row as SQLite returns it: `payload_json` is still the stored text.
 *  Named for the same reason `StoredStoryboardRow` is — the `Omit<…> & { … }`
 *  was being spelled out at each reader. */
export type StoredProjectEventRow = Omit<ContentProjectEventRow, "payload_json"> & {
	payload_json: string | null;
};

export function mapContentProjectEventRow(row: StoredProjectEventRow): ContentProjectEventRow {
	return {
		...row,
		payload_json: parseJsonValue(row.payload_json, null, isJsonObjectOrNull),
	};
}

export async function recordContentProjectEventDb(
	db: Db,
	input: {
		project_id: string;
		output_id?: string | null;
		storyboard_id?: string | null;
		actor_type: string;
		actor_id?: string | null;
		kind: string;
		summary: string;
		payload_json?: Record<string, unknown> | null;
		created_at?: number;
	},
): Promise<ContentProjectEventRow> {
	const createdAt = input.created_at ?? Date.now();
	const id = randomUUID();
	await db.run(
		`INSERT INTO content_project_events
		 (id, project_id, output_id, storyboard_id, actor_type, actor_id, kind, summary, payload_json, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.project_id,
			input.output_id ?? null,
			input.storyboard_id ?? null,
			input.actor_type,
			input.actor_id ?? null,
			input.kind,
			input.summary,
			input.payload_json ? JSON.stringify(input.payload_json) : null,
			createdAt,
		],
	);
	return {
		id,
		project_id: input.project_id,
		output_id: input.output_id ?? null,
		storyboard_id: input.storyboard_id ?? null,
		actor_type: input.actor_type,
		actor_id: input.actor_id ?? null,
		kind: input.kind,
		summary: input.summary,
		payload_json: input.payload_json ?? null,
		created_at: createdAt,
	};
}

export async function listContentProjectEvents(
	projectId: string,
	db: Db = openDb(),
): Promise<ContentProjectEventRow[]> {
	const rows = await db.all<
		Omit<ContentProjectEventRow, "payload_json"> & { payload_json: string | null }
	>(`SELECT * FROM content_project_events WHERE project_id = ? ORDER BY created_at DESC`, [
		projectId,
	]);
	return rows.map(mapContentProjectEventRow);
}

export async function recordContentProjectEvent(
	input: {
		project_id: string;
		output_id?: string | null;
		storyboard_id?: string | null;
		actor_type: string;
		actor_id?: string | null;
		kind: string;
		summary: string;
		payload_json?: Record<string, unknown> | null;
	},
	db: Db = openDb(),
): Promise<ContentProjectEventRow | null> {
	const exists = await db.get<{ id: string }>(`SELECT id FROM content_projects WHERE id = ?`, [
		input.project_id,
	]);
	if (!exists) return null;
	return recordContentProjectEventDb(db, input);
}
