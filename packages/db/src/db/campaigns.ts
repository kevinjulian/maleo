/* Campaigns — a named grouping of projects and drafts, with the denormalised
 * counters the campaign views read.
 *
 * The counter SQL correlates over content projects, outputs and drafts, so it
 * lives here with the only reads that use it. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonObject, parseJsonStringArray } from "./row-json.ts";
import { OPEN_DRAFT_IN } from "./drafts.ts";
import type { CampaignStatus } from "./content-types.ts";

const OUTPUT_PIPE_QUEUED_IN = "'draft', 'approved', 'queued'";
const OUTPUT_PIPE_RUNNING_IN = "'rendering', 'publishing', 'running'";
const OUTPUT_PIPE_READY_IN = "'ready'";
const OUTPUT_PIPE_DONE_IN = "'published'";

export interface CampaignRow {
	id: string;
	name: string;
	goal: string;
	status: CampaignStatus;
	workspaces: string[];
	budget_json: Record<string, unknown> | null;
	start_at: number | null;
	end_at: number | null;
	created_at: number;
	updated_at: number;
	project_count?: number;
	output_count?: number;
	open_output_count?: number;
	draft_count?: number;
	open_draft_count?: number;
	// Content-pipeline stage breakdown (queued → running → ready → done).
	pipe_queued?: number;
	pipe_running?: number;
	pipe_review?: number;
	pipe_done?: number;
}

const CAMPAIGN_COUNT_COLS = `
	(SELECT COUNT(*) FROM content_projects p WHERE p.campaign_id = c.id) AS project_count,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id) AS output_count,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id AND o.status NOT IN ('published', 'archived', 'failed')) AS open_output_count,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id AND o.status IN (${OUTPUT_PIPE_QUEUED_IN})) AS pipe_queued,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id AND o.status IN (${OUTPUT_PIPE_RUNNING_IN})) AS pipe_running,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id AND o.status IN (${OUTPUT_PIPE_READY_IN})) AS pipe_review,
	(SELECT COUNT(*) FROM content_project_outputs o
	 JOIN content_projects p ON p.id = o.project_id
	 WHERE p.campaign_id = c.id AND o.status IN (${OUTPUT_PIPE_DONE_IN})) AS pipe_done,
	(SELECT COUNT(*) FROM drafts d WHERE d.campaign_id = c.id) AS draft_count,
	(SELECT COUNT(*) FROM drafts d WHERE d.campaign_id = c.id AND d.status IN (${OPEN_DRAFT_IN})) AS open_draft_count`;

export async function listCampaigns(db: Db = openDb()): Promise<CampaignRow[]> {
	const rows = await db.all<
		CampaignRow & { workspaces_json: string | null; budget_json: string | null }
	>(`SELECT
			c.*,
			${CAMPAIGN_COUNT_COLS}
		 FROM campaigns c
		 ORDER BY c.updated_at DESC`);
	return rows.map((row) => ({
		...row,
		workspaces: parseJsonStringArray(row.workspaces_json),
		budget_json: parseJsonObject(row.budget_json),
	}));
}

export async function getCampaign(id: string, db: Db = openDb()): Promise<CampaignRow | null> {
	const row = await db.get<
		CampaignRow & { workspaces_json: string | null; budget_json: string | null }
	>(
		`SELECT
			c.*,
			${CAMPAIGN_COUNT_COLS}
		 FROM campaigns c
		 WHERE c.id = ?`,
		[id],
	);
	if (!row) return null;
	return {
		...row,
		workspaces: parseJsonStringArray(row.workspaces_json),
		budget_json: parseJsonObject(row.budget_json),
	};
}

export async function createCampaign(
	input: {
		name: string;
		goal?: string;
		status?: CampaignStatus;
		workspaces?: string[];
		budget_json?: Record<string, unknown> | null;
		start_at?: number | null;
		end_at?: number | null;
	},
	db: Db = openDb(),
): Promise<CampaignRow> {
	const now = Date.now();
	const id = randomUUID();
	await db.run(
		`INSERT INTO campaigns
		 (id, name, goal, status, workspaces_json, budget_json, start_at, end_at, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.name,
			input.goal ?? "",
			input.status ?? "draft",
			JSON.stringify(input.workspaces ?? []),
			input.budget_json ? JSON.stringify(input.budget_json) : null,
			input.start_at ?? null,
			input.end_at ?? null,
			now,
			now,
		],
	);
	return (await getCampaign(id, db))!;
}

export async function updateCampaign(
	id: string,
	input: {
		name?: string;
		goal?: string;
		status?: CampaignStatus;
		workspaces?: string[];
		budget_json?: Record<string, unknown> | null;
		start_at?: number | null;
		end_at?: number | null;
	},
	db: Db = openDb(),
): Promise<CampaignRow | null> {
	const current = await getCampaign(id, db);
	if (!current) return null;
	const next = {
		name: input.name ?? current.name,
		goal: input.goal ?? current.goal,
		status: input.status ?? current.status,
		workspaces: input.workspaces ?? current.workspaces,
		budget_json: input.budget_json === undefined ? current.budget_json : input.budget_json,
		start_at: input.start_at === undefined ? current.start_at : input.start_at,
		end_at: input.end_at === undefined ? current.end_at : input.end_at,
	};
	await db.run(
		`UPDATE campaigns
		 SET name = ?, goal = ?, status = ?, workspaces_json = ?, budget_json = ?, start_at = ?, end_at = ?, updated_at = ?
		 WHERE id = ?`,
		[
			next.name,
			next.goal,
			next.status,
			JSON.stringify(next.workspaces),
			next.budget_json ? JSON.stringify(next.budget_json) : null,
			next.start_at,
			next.end_at,
			Date.now(),
			id,
		],
	);
	return getCampaign(id, db);
}
