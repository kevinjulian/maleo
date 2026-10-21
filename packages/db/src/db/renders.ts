/* Render jobs — a storyboard handed to the video pipeline, and the output row it
 * produces on completion. */
import { keysOf } from "@maleo/shared";
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";
import { recordContentProjectEventDb } from "./events.ts";

export interface ContentRenderRow {
	id: string;
	project_id: string;
	output_id: string | null;
	storyboard_id: string | null;
	draft_id: string | null;
	video_job_id: string | null;
	status: string;
	phase: string | null;
	output_path: string | null;
	output_url: string | null;
	manifest_path: string | null;
	duration_sec: number | null;
	created_at: number;
	updated_at: number;
}

/** Older video jobs lack a workspace column. Resolve only an unambiguous
 * persisted project link; orphan jobs stay inaccessible. */
export async function legacyRenderWorkspace(
	jobId: string,
	projectId: string | null,
	db: Db = openDb(),
): Promise<string | null> {
	const rows = projectId
		? await db.all<{ workspace: string }>(`SELECT workspace FROM content_projects WHERE id = ?`, [
				projectId,
			])
		: await db.all<{ workspace: string }>(
				`SELECT DISTINCT p.workspace FROM content_renders r JOIN content_projects p ON p.id = r.project_id WHERE r.video_job_id = ? LIMIT 2`,
				[jobId],
			);
	return rows.length === 1 ? rows[0]!.workspace : null;
}

export async function addContentRender(
	input: {
		project_id: string;
		output_id?: string | null;
		storyboard_id?: string | null;
		draft_id?: string | null;
		video_job_id?: string | null;
		status?: string;
		phase?: string | null;
		output_path?: string | null;
		output_url?: string | null;
		manifest_path?: string | null;
		duration_sec?: number | null;
	},
	db: Db = openDb(),
): Promise<ContentRenderRow | null> {
	const exists = await db.get<{ id: string }>(`SELECT id FROM content_projects WHERE id = ?`, [
		input.project_id,
	]);
	if (!exists) return null;
	if (input.output_id) {
		const output = await db.get<{ id: string }>(
			`SELECT id FROM content_project_outputs WHERE id = ? AND project_id = ?`,
			[input.output_id, input.project_id],
		);
		if (!output) return null;
	}
	const id = randomUUID();
	const now = Date.now();
	await db.run(
		`INSERT INTO content_renders
		 (id, project_id, output_id, storyboard_id, draft_id, video_job_id, status, phase, output_path, output_url, manifest_path, duration_sec, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			id,
			input.project_id,
			input.output_id ?? null,
			input.storyboard_id ?? null,
			input.draft_id ?? null,
			input.video_job_id ?? null,
			input.status ?? "queued",
			input.phase ?? null,
			input.output_path ?? null,
			input.output_url ?? null,
			input.manifest_path ?? null,
			input.duration_sec ?? null,
			now,
			now,
		],
	);
	if (input.output_id) {
		await db.run(
			`UPDATE content_project_outputs SET render_id = ?, status = ?, updated_at = ? WHERE id = ? AND project_id = ?`,
			[id, input.status ?? "queued", now, input.output_id, input.project_id],
		);
	}
	await db.run(`UPDATE content_projects SET status = ?, updated_at = ? WHERE id = ?`, [
		"rendering",
		now,
		input.project_id,
	]);
	await recordContentProjectEventDb(db, {
		project_id: input.project_id,
		output_id: input.output_id ?? null,
		storyboard_id: input.storyboard_id ?? null,
		actor_type: "system",
		kind: "render.created",
		summary: `Render queued with status ${input.status ?? "queued"}.`,
		payload_json: {
			render_id: id,
			video_job_id: input.video_job_id ?? null,
			phase: input.phase ?? null,
		},
		created_at: now,
	});
	const saved = db.get<ContentRenderRow>(`SELECT * FROM content_renders WHERE id = ?`, [id]);
	return saved;
}

export async function updateContentRender(
	projectId: string,
	renderId: string,
	patch: {
		output_id?: string | null;
		storyboard_id?: string | null;
		draft_id?: string | null;
		video_job_id?: string | null;
		status?: string;
		phase?: string | null;
		output_path?: string | null;
		output_url?: string | null;
		manifest_path?: string | null;
		duration_sec?: number | null;
	},
	db: Db = openDb(),
): Promise<ContentRenderRow | null> {
	const current = await db.get<ContentRenderRow>(
		`SELECT * FROM content_renders WHERE id = ? AND project_id = ?`,
		[renderId, projectId],
	);
	if (!current) return null;
	const patchCols = [
		"output_id",
		"storyboard_id",
		"draft_id",
		"video_job_id",
		"status",
		"phase",
		"output_path",
		"output_url",
		"manifest_path",
		"duration_sec",
	] as const;
	const sets: string[] = [];
	const params: Array<string | number | null> = [];
	for (const col of patchCols) {
		const value = patch[col];
		if (value === undefined || value === current[col]) continue;
		sets.push(`${col} = ?`);
		params.push(value);
	}
	if (sets.length === 0) return current;
	const now = Date.now();
	sets.push("updated_at = ?");
	params.push(now);
	await db.run(`UPDATE content_renders SET ${sets.join(", ")} WHERE id = ? AND project_id = ?`, [
		...params,
		renderId,
		projectId,
	]);
	const next = await db.get<ContentRenderRow>(
		`SELECT * FROM content_renders WHERE id = ? AND project_id = ?`,
		[renderId, projectId],
	);
	if (!next) return null;
	const linkedOutputId = next.output_id ?? current.output_id;
	if (linkedOutputId && patch.status !== undefined) {
		await db.run(
			`UPDATE content_project_outputs
			 SET render_id = ?, status = ?, updated_at = ?
			 WHERE id = ? AND project_id = ?`,
			[renderId, patch.status, now, linkedOutputId, projectId],
		);
	}
	await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [now, projectId]);
	await recordContentProjectEventDb(db, {
		project_id: projectId,
		output_id: linkedOutputId,
		storyboard_id: next.storyboard_id,
		actor_type: "system",
		kind: "render.updated",
		summary: `Render status updated to ${next.status}.`,
		payload_json: {
			render_id: renderId,
			video_job_id: next.video_job_id,
			phase: next.phase,
			output_url: next.output_url,
		},
		created_at: now,
	});
	return next;
}

export interface ExportProject {
	id: string;
	title: string;
	legacy_job_ids: string[];
}

/** Bulk-resolve ownership before asking the worker to page its history. */
export async function listExportProjects(
	workspace: string,
	db: Db = openDb(),
): Promise<ExportProject[]> {
	const projects = await db.all<{ id: string; title: string }>(
		`SELECT id, title FROM content_projects WHERE workspace = ? ORDER BY title, id`,
		[workspace],
	);
	const links = await db.all<{ project_id: string; video_job_id: string }>(
		`SELECT MIN(r.project_id) AS project_id, r.video_job_id FROM content_renders r
   JOIN content_projects p ON p.id = r.project_id
   WHERE r.video_job_id IS NOT NULL
   GROUP BY r.video_job_id HAVING COUNT(DISTINCT r.project_id) = 1 AND MIN(p.workspace) = ?`,
		[workspace],
	);
	return projects.map((p) => ({
		...p,
		legacy_job_ids: links.filter((r) => r.project_id === p.id).map((r) => r.video_job_id),
	}));
}

export async function reconcileContentRender(
	projectId: string,
	job: {
		id: string;
		status: string;
		phase?: string | null;
		output_path?: string | null;
		output_url?: string | null;
		manifest_path?: string | null;
		duration_sec?: number | null;
	},
	db: Db = openDb(),
): Promise<void> {
	return db.transaction(async (tx) => {
		await serialize(tx, `export-reconcile:${projectId}:${job.id}`);
		const rows = await tx.all<ContentRenderRow>(
			`SELECT * FROM content_renders WHERE project_id = ? AND video_job_id = ?`,
			[projectId, job.id],
		);
		const patch = {
			status: job.status,
			phase: job.phase ?? null,
			output_path: job.output_path ?? null,
			output_url: job.output_url ?? null,
			manifest_path: job.manifest_path ?? null,
			duration_sec: job.duration_sec ?? null,
		};
		for (const row of rows) {
			if (keysOf(patch).some((key) => row[key] !== patch[key]))
				await updateContentRender(projectId, row.id, patch, tx);
		}
	});
}
