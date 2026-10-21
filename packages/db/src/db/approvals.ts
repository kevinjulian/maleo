/* Approval decisions — an operator's accept or reject on a draft, kept as an
 * audit trail rather than a mutable flag. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export type ApprovalDecision = "approve" | "reject";

export interface ApprovalDecisionRow {
	id: string;
	workspace: string | null;
	draft_id: string;
	decision: ApprovalDecision;
	reason_code: string | null;
	notes: string | null;
	created_at: number;
}

export async function recordApproval(
	input: {
		workspace?: string | null;
		draft_id: string;
		decision: ApprovalDecision;
		reason_code?: string | null;
		notes?: string | null;
	},
	db: Db = openDb(),
): Promise<ApprovalDecisionRow> {
	const now = Date.now();
	const id = randomUUID();
	await db.run(
		`INSERT INTO approval_decisions
		 (id, workspace, draft_id, decision, reason_code, notes, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.workspace ?? null,
			input.draft_id,
			input.decision,
			input.reason_code ?? null,
			input.notes ?? null,
			now,
		],
	);
	return {
		id,
		workspace: input.workspace ?? null,
		draft_id: input.draft_id,
		decision: input.decision,
		reason_code: input.reason_code ?? null,
		notes: input.notes ?? null,
		created_at: now,
	};
}

// Approval history for a draft, newest first.
export function listApprovals(
	workspace: string,
	draftId: string,
	db: Db = openDb(),
): Promise<ApprovalDecisionRow[]> {
	return db.all<ApprovalDecisionRow>(
		"SELECT * FROM approval_decisions WHERE workspace = ? AND draft_id = ? ORDER BY created_at DESC",
		[workspace, draftId],
	);
}
