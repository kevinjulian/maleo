/* Drafts — the legacy content row the campaign counters still join against.
 *
 * Two route handlers hand-wrote SELECTs against this table while calling this
 * layer for everything else, each with its own copy of the column list and row
 * type. The reads live here with the writes, so the shape has one owner. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

const OPEN_DRAFT_STATUSES = [
	"generating",
	"waiting_approval",
	"ready_to_publish",
	"publishing",
] as const;

/** SQL fragment: the draft statuses that count as still open. */
export const OPEN_DRAFT_IN = OPEN_DRAFT_STATUSES.map((s) => `'${s}'`).join(", ");

export async function setDraftCampaign(
	workspace: string,
	draftId: string,
	campaignId: string | null,
	db: Db = openDb(),
): Promise<boolean> {
	const res = await db.run(
		"UPDATE drafts SET campaign_id = ?, updated_at = ? WHERE workspace = ? AND id = ?",
		[campaignId, Date.now(), workspace, draftId],
	);
	return (res.changes ?? 0) > 0;
}

/** The columns a draft is read as. One list, not one per call site. */
const DRAFT_COLS =
	"workspace, id, action, reasoning, content, status, campaign_id, created_at, updated_at";

export interface DraftRow {
	workspace: string;
	id: string;
	action: string;
	reasoning: string;
	content: string | null;
	status: string;
	campaign_id: string | null;
	created_at: number;
	updated_at: number;
}

export interface DraftPage {
	items: DraftRow[];
	total: number;
}

/** Paged drafts for the content list, filtered server-side. `total` is the real
 *  count for the filter, not the page length. */
export async function listDrafts(
	input: {
		workspace?: string;
		status?: string;
		campaignId?: string;
		search?: string;
		limit?: number;
		offset?: number;
	} = {},
	db: Db = openDb(),
): Promise<DraftPage> {
	const clauses: string[] = [];
	const params: Array<string | number> = [];
	if (input.campaignId) {
		clauses.push("campaign_id = ?");
		params.push(input.campaignId);
	}
	if (input.workspace) {
		clauses.push("workspace = ?");
		params.push(input.workspace);
	}
	if (input.status) {
		clauses.push("status = ?");
		params.push(input.status);
	}
	if (input.search) {
		clauses.push(
			"(LOWER(COALESCE(content, '')) LIKE ? OR LOWER(reasoning) LIKE ? OR LOWER(workspace) LIKE ?)",
		);
		const term = `%${input.search.toLowerCase()}%`;
		params.push(term, term, term);
	}
	const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
	const limit = Math.max(1, Math.min(input.limit ?? 100, 500));
	const offset = Math.max(0, input.offset ?? 0);

	const total =
		(await db.get<{ c: number }>(`SELECT COUNT(*) AS c FROM drafts ${where}`, params))?.c ?? 0;
	const items = await db.all<DraftRow>(
		`SELECT ${DRAFT_COLS} FROM drafts ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
		[...params, limit, offset],
	);
	return { items, total };
}

/** The drafts a campaign owns, newest first. */
export async function listCampaignDrafts(
	campaignId: string,
	limit = 200,
	db: Db = openDb(),
): Promise<DraftRow[]> {
	return await db.all<DraftRow>(
		`SELECT ${DRAFT_COLS} FROM drafts WHERE campaign_id = ? ORDER BY updated_at DESC LIMIT ?`,
		[campaignId, Math.max(1, Math.min(limit, 500))],
	);
}
