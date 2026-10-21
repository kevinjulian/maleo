/* The per-project child records: citations, notes, speakers and the style lock.
 *
 * Each is a small table keyed by project id, and none of them is a reference
 * entity — a note carries no image and a speaker is an audio identity. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { parseJsonValue, isStringArray } from "./row-json.ts";

export interface ProjectCitationRow {
	id: string;
	project_id: string;
	url: string;
	title: string;
	excerpt: string | null;
	topic: string | null;
	job_id: string | null;
	created_at: number;
}

/* Record an agent-cited research source. Citations are durable and queryable (a
 * Sources panel outlives the research_bundle artifact) but are NOT castable
 * references — they never reach a project's roster. Idempotent per (project, url)
 * so re-running research does not duplicate a source. */
export async function addProjectCitation(
	input: {
		project_id: string;
		url: string;
		title: string;
		excerpt?: string | null;
		topic?: string | null;
		job_id?: string | null;
	},
	db: Db = openDb(),
): Promise<ProjectCitationRow | null> {
	const exists = await db.get<{ id: string }>(`SELECT id FROM content_projects WHERE id = ?`, [
		input.project_id,
	]);
	if (!exists) return null;
	const id = randomUUID();
	const now = Date.now();
	await db.run(
		`INSERT INTO project_citation (id, project_id, url, title, excerpt, topic, job_id, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, url) DO NOTHING`,
		[
			id,
			input.project_id,
			input.url,
			input.title,
			input.excerpt ?? null,
			input.topic ?? null,
			input.job_id ?? null,
			now,
		],
	);
	const saved = db.get<ProjectCitationRow>(
		`SELECT * FROM project_citation WHERE project_id = ? AND url = ?`,
		[input.project_id, input.url],
	);
	return saved;
}

export async function listProjectCitations(
	projectId: string,
	db: Db = openDb(),
): Promise<ProjectCitationRow[]> {
	return await db.all<ProjectCitationRow>(
		`SELECT * FROM project_citation WHERE project_id = ? ORDER BY created_at DESC`,
		[projectId],
	);
}

export interface ProjectNoteRow {
	id: string;
	project_id: string;
	label: string;
	body: string;
	tags: string[];
	is_default: number;
	created_at: number;
	updated_at: number;
}

/* Notes are text-only project state, not reference entities. The write path used
 * to go through `content_references` with kind='note'; the rows were copied into
 * this table by the entity migration but nothing wrote here, so a note created
 * after that migration lived only in the legacy table. */
export async function upsertProjectNote(
	input: {
		id: string;
		project_id: string;
		label: string;
		body: string;
		tags?: string[];
		is_default?: boolean;
	},
	db: Db = openDb(),
): Promise<ProjectNoteRow | null> {
	if (!(await db.get(`SELECT 1 FROM content_projects WHERE id = ?`, [input.project_id])))
		return null;
	const now = Date.now();
	await db.run(
		`INSERT INTO project_note (id, project_id, label, body, tags_json, is_default, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(id) DO UPDATE SET
		   label = excluded.label,
		   body = excluded.body,
		   tags_json = excluded.tags_json,
		   is_default = excluded.is_default,
		   updated_at = excluded.updated_at`,
		[
			input.id,
			input.project_id,
			input.label,
			input.body,
			JSON.stringify(input.tags ?? []),
			input.is_default ? 1 : 0,
			now,
			now,
		],
	);
	const row = await db.get<Omit<ProjectNoteRow, "tags"> & { tags_json: string | null }>(
		`SELECT * FROM project_note WHERE id = ?`,
		[input.id],
	);
	return row ? { ...row, tags: parseJsonValue(row.tags_json, [], isStringArray) } : null;
}

export async function deleteProjectNote(
	projectId: string,
	noteId: string,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(await db.run(`DELETE FROM project_note WHERE project_id = ? AND id = ?`, [projectId, noteId]))
			.changes > 0
	);
}

export interface ProjectSpeakerRow {
	id: string;
	project_id: string;
	voice_key: string;
	name: string;
	hue: number | null;
	is_default: number;
	created_at: number;
}

/** A project's speakers, default first so the editor's fallback pick is stable. */
export async function listProjectSpeakers(
	projectId: string,
	db: Db = openDb(),
): Promise<ProjectSpeakerRow[]> {
	return await db.all<ProjectSpeakerRow>(
		`SELECT * FROM project_speaker WHERE project_id = ? ORDER BY is_default DESC, created_at ASC`,
		[projectId],
	);
}

/** Keyed by (project_id, voice_key), so re-saving a speaker updates it. */
export async function upsertProjectSpeaker(
	input: {
		project_id: string;
		voice_key: string;
		name: string;
		hue?: number | null;
		is_default?: boolean;
	},
	db: Db = openDb(),
): Promise<void> {
	await db.run(
		`INSERT INTO project_speaker (id, project_id, voice_key, name, hue, is_default, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, voice_key) DO UPDATE SET
		   name = excluded.name,
		   hue = excluded.hue,
		   is_default = excluded.is_default`,
		[
			randomUUID(),
			input.project_id,
			input.voice_key,
			input.name,
			input.hue ?? null,
			input.is_default ? 1 : 0,
			Date.now(),
		],
	);
}

export interface ProjectStyleLockRow {
	project_id: string;
	visual_style: string;
	board_image_url: string | null;
	updated_at: number;
}

/* Persist a project's generated style lock. One row per project, so a later job
 * reads back the same look instead of regenerating a divergent one.
 *
 * `board_image_url` is only overwritten when a url is supplied: the bible text and
 * the board image are produced at different points in a run, and passing text
 * alone must not clear an image that was already generated. */
export async function upsertProjectStyleLock(
	input: {
		project_id: string;
		visual_style: string;
		board_image_url?: string | null;
	},
	db: Db = openDb(),
): Promise<ProjectStyleLockRow | null> {
	await db.run(
		`INSERT INTO project_style_lock (project_id, visual_style, board_image_url, updated_at)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT(project_id) DO UPDATE SET
		   visual_style = excluded.visual_style,
		   board_image_url = coalesce(excluded.board_image_url, project_style_lock.board_image_url),
		   updated_at = excluded.updated_at`,
		[input.project_id, input.visual_style, input.board_image_url ?? null, Date.now()],
	);
	return await getProjectStyleLock(input.project_id, db);
}

export async function getProjectStyleLock(
	projectId: string,
	db: Db = openDb(),
): Promise<ProjectStyleLockRow | null> {
	return await db.get<ProjectStyleLockRow>(
		`SELECT * FROM project_style_lock WHERE project_id = ?`,
		[projectId],
	);
}

/* ── Reference entities + project selection ─────────────────────────────────── */
