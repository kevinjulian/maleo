/* Motion presets — saved keyframe animations a clip can adopt. */
import { randomUUID } from "node:crypto";
import { motionPresetInputSchema, type MotionPreset, type MotionPresetInput } from "@maleo/shared";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";

interface MotionPresetDbRow {
	id: string;
	name: string;
	keyframes_json: string;
	created_at: number;
	updated_at: number;
}

function mapMotionPresetRow(row: MotionPresetDbRow): MotionPreset {
	const config = motionPresetInputSchema.parse({
		name: row.name,
		keyframes: JSON.parse(row.keyframes_json) as MotionPresetInput["keyframes"],
	});
	return { id: row.id, ...config, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listContentMotionPresets(db: Db = openDb()): Promise<MotionPreset[]> {
	const rows = await db.all<MotionPresetDbRow>(
		"SELECT * FROM content_motion_presets ORDER BY updated_at DESC, name ASC",
	);
	return rows.map(mapMotionPresetRow);
}

export async function getContentMotionPreset(
	id: string,
	db: Db = openDb(),
): Promise<MotionPreset | null> {
	const row = await db.get<MotionPresetDbRow>("SELECT * FROM content_motion_presets WHERE id = ?", [
		id,
	]);
	return row ? mapMotionPresetRow(row) : null;
}

export async function createContentMotionPreset(
	input: MotionPresetInput,
	db: Db = openDb(),
): Promise<MotionPreset> {
	const now = Date.now();
	const id = randomUUID();
	await db.run(
		`INSERT INTO content_motion_presets (id, name, keyframes_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?)`,
		[id, input.name, JSON.stringify(input.keyframes), now, now],
	);
	return (await getContentMotionPreset(id, db))!;
}

export async function updateContentMotionPreset(
	id: string,
	input: MotionPresetInput,
	db: Db = openDb(),
): Promise<MotionPreset | null> {
	const exists = await db.get<{ id: string }>(
		"SELECT id FROM content_motion_presets WHERE id = ?",
		[id],
	);
	if (!exists) return null;
	await db.run(
		"UPDATE content_motion_presets SET name = ?, keyframes_json = ?, updated_at = ? WHERE id = ?",
		[input.name, JSON.stringify(input.keyframes), Date.now(), id],
	);
	return getContentMotionPreset(id, db);
}

export async function deleteContentMotionPreset(id: string, db: Db = openDb()): Promise<boolean> {
	const result = await db.run("DELETE FROM content_motion_presets WHERE id = ?", [id]);
	return result.changes > 0;
}
