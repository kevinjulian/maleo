/* Project outputs — the publishable artifacts a project yields, and the feed the
 * campaign views read. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import type { ContentProjectStatus } from "./content-types.ts";
import { parseJsonValue, isJsonObjectOrNull } from "./row-json.ts";
import { recordContentProjectEventDb } from "./events.ts";
import { entriesOf } from "@maleo/shared";

export interface ContentProjectOutputRow {
	id: string;
	project_id: string;
	storyboard_id: string | null;
	channel: string | null;
	platform: string | null;
	kind: string;
	title: string;
	status: string;
	draft_id: string | null;
	render_id: string | null;
	publish_job_id: string | null;
	content_json: Record<string, unknown> | null;
	notes: string | null;
	created_at: number;
	updated_at: number;
}

export interface ContentOutputFeedRow extends ContentProjectOutputRow {
	project_title: string;
	project_status: ContentProjectStatus;
	campaign_id: string | null;
}

/** The row as SQLite returns it: `content_json` is still text, and
 *  `mapContentProjectOutputRow` is what turns it into `ContentProjectOutputRow`.
 *  Named because six call sites spelled the same `Omit<…> & {…}` out longhand. */
export type StoredContentProjectOutputRow = Omit<ContentProjectOutputRow, "content_json"> & {
	content_json: string | null;
};

export function mapContentProjectOutputRow(
	row: StoredContentProjectOutputRow,
): ContentProjectOutputRow {
	return {
		...row,
		content_json: parseJsonValue(row.content_json, null, isJsonObjectOrNull),
	};
}

export async function listContentProjectOutputs(
	projectId: string,
	db: Db = openDb(),
): Promise<ContentProjectOutputRow[]> {
	const rows = await db.all<StoredContentProjectOutputRow>(
		`SELECT * FROM content_project_outputs WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`,
		[projectId],
	);
	return rows.map(mapContentProjectOutputRow);
}

export async function listContentOutputs(
	input?: {
		/** Tenant partition, applied through the project this output belongs to.
		 *  Outputs carry no workspace column of their own — the project owns the
		 *  work, so asking it is the only answer that cannot disagree with the
		 *  project's own scoping. */
		workspace?: string;
		campaign_id?: string | null;
		status?: string;
		project_id?: string;
		limit?: number;
		offset?: number;
	},
	db: Db = openDb(),
): Promise<ContentOutputFeedRow[]> {
	const clauses = ["1=1"];
	const params: Array<string | number> = [];
	if (input?.workspace) {
		clauses.push("p.workspace = ?");
		params.push(input.workspace);
	}
	if (input?.campaign_id) {
		clauses.push("p.campaign_id = ?");
		params.push(input.campaign_id);
	}
	if (input?.status) {
		clauses.push("o.status = ?");
		params.push(input.status);
	}
	if (input?.project_id) {
		clauses.push("o.project_id = ?");
		params.push(input.project_id);
	}
	const limit = Math.max(1, Math.min(input?.limit ?? 100, 500));
	const offset = Math.max(0, input?.offset ?? 0);
	params.push(limit, offset);
	const rows = await db.all<
		StoredContentProjectOutputRow & Omit<ContentOutputFeedRow, keyof ContentProjectOutputRow>
	>(
		`SELECT
			o.*,
			p.title AS project_title,
			p.status AS project_status,
			p.campaign_id AS campaign_id
		 FROM content_project_outputs o
		 JOIN content_projects p ON p.id = o.project_id
		 WHERE ${clauses.join(" AND ")}
		 ORDER BY o.updated_at DESC, o.created_at DESC
		 LIMIT ? OFFSET ?`,
		params,
	);
	return rows.map((row) => ({
		...mapContentProjectOutputRow(row),
		project_title: row.project_title,
		project_status: row.project_status,
		campaign_id: row.campaign_id,
	}));
}

export async function createContentProjectOutput(
	input: {
		project_id: string;
		storyboard_id?: string | null;
		channel?: string | null;
		platform?: string | null;
		kind?: string;
		title: string;
		status?: string;
		draft_id?: string | null;
		render_id?: string | null;
		publish_job_id?: string | null;
		content_json?: Record<string, unknown> | null;
		notes?: string | null;
	},
	db: Db = openDb(),
): Promise<ContentProjectOutputRow | null> {
	const exists = await db.get<{ id: string }>(`SELECT id FROM content_projects WHERE id = ?`, [
		input.project_id,
	]);
	if (!exists) return null;
	const id = randomUUID();
	const now = Date.now();
	await db.run(
		`INSERT INTO content_project_outputs
		 (id, project_id, storyboard_id, channel, platform, kind, title, status, draft_id, render_id, publish_job_id,
		  content_json, notes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.project_id,
			input.storyboard_id ?? null,
			input.channel ?? null,
			input.platform ?? null,
			input.kind ?? "draft",
			input.title,
			input.status ?? "draft",
			input.draft_id ?? null,
			input.render_id ?? null,
			input.publish_job_id ?? null,
			input.content_json ? JSON.stringify(input.content_json) : null,
			input.notes ?? null,
			now,
			now,
		],
	);
	await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [now, input.project_id]);
	await recordContentProjectEventDb(db, {
		project_id: input.project_id,
		output_id: id,
		storyboard_id: input.storyboard_id ?? null,
		actor_type: "operator",
		kind: "output.created",
		summary: `Output created: ${input.title}.`,
		payload_json: {
			channel: input.channel ?? null,
			platform: input.platform ?? null,
			status: input.status ?? "draft",
			kind: input.kind ?? "draft",
		},
		created_at: now,
	});
	const saved = await db.get<StoredContentProjectOutputRow>(
		`SELECT * FROM content_project_outputs WHERE id = ?`,
		[id],
	);
	return saved ? mapContentProjectOutputRow(saved) : null;
}

export async function updateContentProjectOutput(
	projectId: string,
	outputId: string,
	patch: {
		storyboard_id?: string | null;
		channel?: string | null;
		platform?: string | null;
		kind?: string;
		title?: string;
		status?: string;
		draft_id?: string | null;
		render_id?: string | null;
		publish_job_id?: string | null;
		content_json?: Record<string, unknown> | null;
		notes?: string | null;
	},
	db: Db = openDb(),
): Promise<ContentProjectOutputRow | null> {
	const exists = await db.get<{ id: string }>(
		`SELECT id FROM content_project_outputs WHERE id = ? AND project_id = ?`,
		[outputId, projectId],
	);
	if (!exists) return null;
	const patchCols = [
		"storyboard_id",
		"channel",
		"platform",
		"kind",
		"title",
		"status",
		"draft_id",
		"render_id",
		"publish_job_id",
		"notes",
	] as const;
	const sets: string[] = [];
	const params: Array<string | number | null> = [];
	for (const col of patchCols) {
		const value = patch[col];
		if (value === undefined) continue;
		sets.push(`${col} = ?`);
		params.push(value);
	}
	if (patch.content_json !== undefined) {
		sets.push("content_json = ?");
		params.push(patch.content_json ? JSON.stringify(patch.content_json) : null);
	}
	if (sets.length === 0) {
		const current = await db.get<StoredContentProjectOutputRow>(
			`SELECT * FROM content_project_outputs WHERE id = ?`,
			[outputId],
		);
		return current ? mapContentProjectOutputRow(current) : null;
	}
	const now = Date.now();
	sets.push("updated_at = ?");
	params.push(now);
	await db.run(
		`UPDATE content_project_outputs SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`,
		[...params, outputId, projectId],
	);
	await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [now, projectId]);
	await recordContentProjectEventDb(db, {
		project_id: projectId,
		output_id: outputId,
		actor_type: "operator",
		kind: "output.updated",
		summary: "Output fields updated.",
		payload_json: {
			fields: entriesOf(patch)
				.filter(([, value]) => value !== undefined)
				.map(([key]) => key),
		},
		created_at: now,
	});
	const saved = await db.get<StoredContentProjectOutputRow>(
		`SELECT * FROM content_project_outputs WHERE id = ?`,
		[outputId],
	);
	return saved ? mapContentProjectOutputRow(saved) : null;
}

// Stamp a draft with its campaign. Workspace-scoped to match the drafts PK shape.
