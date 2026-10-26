/* Clip templates — reusable clip compositions an operator can place. */
import { randomUUID } from "node:crypto";
import { clipTemplateInputSchema, type ClipTemplate, type ClipTemplateInput } from "@maleo/shared";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";

interface ClipTemplateDbRow {
	id: string;
	kind: string;
	label: string;
	intent: string;
	category: string;
	base: string;
	config_json: string;
	created_at: number;
	updated_at: number;
}

function mapClipTemplateRow(row: ClipTemplateDbRow): ClipTemplate {
	const config = clipTemplateInputSchema.parse({
		kind: row.kind,
		label: row.label,
		intent: row.intent,
		category: row.category,
		base: row.base,
		config: JSON.parse(row.config_json) as Record<string, unknown>,
	});
	return { id: row.id, ...config, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listContentClipTemplates(db: Db = openDb()): Promise<ClipTemplate[]> {
	return (
		await db.all<ClipTemplateDbRow>(
			"SELECT * FROM content_clip_templates ORDER BY updated_at DESC, label ASC",
		)
	).map(mapClipTemplateRow);
}

export async function getContentClipTemplate(
	id: string,
	db: Db = openDb(),
): Promise<ClipTemplate | null> {
	const row = await db.get<ClipTemplateDbRow>("SELECT * FROM content_clip_templates WHERE id = ?", [
		id,
	]);
	return row ? mapClipTemplateRow(row) : null;
}

export async function createContentClipTemplate(
	input: ClipTemplateInput,
	db: Db = openDb(),
): Promise<ClipTemplate> {
	input = clipTemplateInputSchema.parse(input);
	return db.transaction(async (tx) => {
		await serialize(tx, "visual-templates");
		const now = Date.now();
		const id = randomUUID();
		await tx.run(
			`INSERT INTO content_clip_templates (id, kind, label, intent, category, base, config_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[
				id,
				input.kind,
				input.label,
				input.intent,
				input.category,
				input.base,
				JSON.stringify(input.config),
				now,
				now,
			],
		);
		return (await getContentClipTemplate(id, tx))!;
	});
}

export async function updateContentClipTemplate(
	id: string,
	input: ClipTemplateInput,
	db: Db = openDb(),
): Promise<ClipTemplate | null> {
	input = clipTemplateInputSchema.parse(input);
	return db.transaction(async (tx) => {
		await serialize(tx, "visual-templates");
		const exists = await tx.get<{ id: string }>(
			"SELECT id FROM content_clip_templates WHERE id = ?",
			[id],
		);
		if (!exists) return null;
		await tx.run(
			"UPDATE content_clip_templates SET kind = ?, label = ?, intent = ?, category = ?, base = ?, config_json = ?, updated_at = ? WHERE id = ?",
			[
				input.kind,
				input.label,
				input.intent,
				input.category,
				input.base,
				JSON.stringify(input.config),
				Date.now(),
				id,
			],
		);
		return getContentClipTemplate(id, tx);
	});
}

export async function deleteContentClipTemplate(id: string, db: Db = openDb()): Promise<boolean> {
	return db.transaction(async (tx) => {
		await serialize(tx, "visual-templates");
		const result = await tx.run("DELETE FROM content_clip_templates WHERE id = ?", [id]);
		return result.changes > 0;
	});
}
