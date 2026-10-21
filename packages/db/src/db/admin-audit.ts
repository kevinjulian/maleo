import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

export interface AdminAuditRow {
	id: string;
	actor_id: string;
	action: string;
	target_type: string;
	target_id: string;
	outcome: "success" | "refused";
	reason: string | null;
	created_at: number;
}

export async function recordAdminAudit(
	input: Omit<AdminAuditRow, "id" | "created_at">,
	db: Db = openDb(),
): Promise<AdminAuditRow> {
	const row: AdminAuditRow = { id: crypto.randomUUID(), created_at: Date.now(), ...input };
	await db.run(
		`INSERT INTO admin_audit (id, actor_id, action, target_type, target_id, outcome, reason, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			row.id,
			row.actor_id,
			row.action,
			row.target_type,
			row.target_id,
			row.outcome,
			row.reason,
			row.created_at,
		],
	);
	return row;
}

export async function listAdminAudit(
	limit: number,
	offset: number,
	db: Db = openDb(),
): Promise<{ items: AdminAuditRow[]; total: number }> {
	const [items, count] = await Promise.all([
		db.all<AdminAuditRow>(
			`SELECT id, actor_id, action, target_type, target_id, outcome, reason, created_at FROM admin_audit ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
			[limit, offset],
		),
		db.get<{ c: number }>(`SELECT count(*) AS c FROM admin_audit`),
	]);
	return { items, total: count?.c ?? 0 };
}
