/* The project detail — the one read that spans families.
 *
 * It sits above them rather than inside any one: a project's detail is its row
 * plus its storyboards, references, notes, speakers, renders, outputs and events.
 * Families never import this module, so the graph stays acyclic. */
import { openDb } from "./connection.ts";
import type { Db } from "./handle.ts";
import { DEFAULT_CONTENT_WORKSPACE } from "./schema.ts";
import { randomUUID } from "node:crypto";
import {
	mapContentProjectRow,
	CONTENT_PROJECT_COUNT_COLS,
	type ContentProjectRow,
	type StoredContentProjectRow,
} from "./content-projects.ts";
import { recordContentProjectEventDb } from "./events.ts";
import { upsertProjectSpeaker } from "./project-children.ts";
import { parseJsonValue, isJsonObjectOrNull, isStringArray } from "./row-json.ts";
import type {
	ContentProjectBrief,
	ContentProjectStatus,
	ContentProjectType,
} from "./content-types.ts";
import {
	addProjectReference,
	listProjectReferences,
	setProjectPrimaryReference,
	type ProjectReferenceRow,
} from "./references.ts";
import {
	listProjectSpeakers,
	type ProjectNoteRow,
	type ProjectSpeakerRow,
} from "./project-children.ts";
import {
	mapContentStoryboardRow,
	type ContentStoryboardRow,
	type StoredStoryboardRow,
} from "./storyboards.ts";
import { mapContentProjectOutputRow, type ContentProjectOutputRow } from "./outputs.ts";
import {
	mapContentProjectEventRow,
	type ContentProjectEventRow,
	type StoredProjectEventRow,
} from "./events.ts";
import type { ContentRenderRow } from "./renders.ts";
import { entriesOf } from "@maleo/shared";

export interface ContentProjectDetail {
	project: ContentProjectRow;
	storyboards: ContentStoryboardRow[];
	/** The project's selected reference entities — the current reference model. */
	entities: ProjectReferenceRow[];
	/** Text-only project notes, formerly content_references rows with kind='note'. */
	notes: ProjectNoteRow[];
	/** The project's voice identities. A speaker is an audio identity and never a
	 *  reference entity — it carries no image and cannot be cast into a frame. */
	speakers: ProjectSpeakerRow[];
	renders: ContentRenderRow[];
	outputs: ContentProjectOutputRow[];
	events: ContentProjectEventRow[];
}

/** How much history a detail read pulls.
 *
 * The two unbounded selects here are the ones that grow without limit: every
 * `content_storyboards` row carries a full `storyboard_json`, so a long-lived
 * project's detail was megabytes — one measured project held 3,135 versions and
 * 3,142 events and returned 5.7 MB for a two-clip video, all of it shipped to
 * the browser on open.
 *
 * Every caller but one reads `storyboards[0]`. The exception is
 * `loadPriorArtifacts`, which walks versions newest-first to recover the newest
 * of each artifact kind, and it asks for the history explicitly. */
export interface ContentProjectDetailOptions {
	/** Newest-first storyboard versions to read. `null` means every version, and
	 *  only the artifact scan should ask for that. */
	storyboardLimit?: number | null;
	/** Newest-first events to read. `null` means every event. */
	eventLimit?: number | null;
}

/** One version and a page of events: what a caller needs unless it says so. */
const DEFAULT_STORYBOARD_LIMIT = 1;
const DEFAULT_EVENT_LIMIT = 200;

export async function getContentProject(
	id: string,
	db: Db = openDb(),
	options: ContentProjectDetailOptions = {},
): Promise<ContentProjectDetail | null> {
	const storyboardLimit =
		options.storyboardLimit === undefined ? DEFAULT_STORYBOARD_LIMIT : options.storyboardLimit;
	const eventLimit = options.eventLimit === undefined ? DEFAULT_EVENT_LIMIT : options.eventLimit;
	const projectRow = await db.get<StoredContentProjectRow>(
		`SELECT
			p.*,
			${CONTENT_PROJECT_COUNT_COLS}
		 FROM content_projects p
		 WHERE p.id = ?`,
		[id],
	);
	if (!projectRow) return null;
	const storyboards =
		storyboardLimit === null
			? await db.all<StoredStoryboardRow>(
					`SELECT * FROM content_storyboards WHERE project_id = ? ORDER BY version DESC, created_at DESC`,
					[id],
				)
			: await db.all<StoredStoryboardRow>(
					`SELECT * FROM content_storyboards WHERE project_id = ? ORDER BY version DESC, created_at DESC LIMIT ?`,
					[id, storyboardLimit],
				);
	const entities = await listProjectReferences(id, undefined, db);
	const notes = await db.all<Omit<ProjectNoteRow, "tags"> & { tags_json: string | null }>(
		`SELECT * FROM project_note WHERE project_id = ? ORDER BY created_at ASC`,
		[id],
	);
	const speakers = await listProjectSpeakers(id, db);
	const renders = await db.all<ContentRenderRow>(
		`SELECT * FROM content_renders WHERE project_id = ? ORDER BY updated_at DESC`,
		[id],
	);
	const outputs = await db.all<
		Omit<ContentProjectOutputRow, "content_json"> & { content_json: string | null }
	>(
		`SELECT * FROM content_project_outputs WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`,
		[id],
	);
	const events =
		eventLimit === null
			? await db.all<StoredProjectEventRow>(
					`SELECT * FROM content_project_events WHERE project_id = ? ORDER BY created_at DESC`,
					[id],
				)
			: await db.all<StoredProjectEventRow>(
					`SELECT * FROM content_project_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?`,
					[id, eventLimit],
				);
	return {
		project: mapContentProjectRow(projectRow),
		storyboards: storyboards.map(mapContentStoryboardRow),
		entities,
		notes: notes.map((n) => ({ ...n, tags: parseJsonValue(n.tags_json, [], isStringArray) })),
		speakers,
		renders,
		outputs: outputs.map(mapContentProjectOutputRow),
		events: events.map(mapContentProjectEventRow),
	};
}

export async function createContentProject(
	input: {
		title: string;
		/** The tenant that OWNS the work. Everything the project later resolves —
		 *  its reference library, its generated images' attribution — reads this
		 *  column, never the workspace an operator happens to be viewing from.
		 *  Defaults to DEFAULT_CONTENT_WORKSPACE, matching the column default the
		 *  18,159 pre-tenancy rows were backfilled to. */
		workspace?: string;
		type?: ContentProjectType;
		status?: ContentProjectStatus;
		target_platform?: string | null;
		target_audience?: string | null;
		target_duration_sec?: number | null;
		target_format?: string | null;
		language?: string | null;
		campaign_id?: string | null;
		brief_json?: ContentProjectBrief | null;
		reference_notes?: string | null;
		// Initial mutable editor state (chat log etc.) written atomically with the row,
		// so the first chat message can't be lost by a reload before the debounced save.
		editor_state?: Record<string, unknown> | null;
		/** Voice identities for the project, written to `project_speaker`. They used to
		 *  ride in `references` as kind='audio' rows carrying `voice_key`. */
		speakers?: Array<{
			voice_key: string;
			name: string;
			hue?: number | null;
			is_default?: boolean;
		}>;
		/** Entities to attach to the project's roster. Ids outside the project's
		 *  workspace are refused by the accessor, so a caller cannot seed a roster it
		 *  has no claim to. */
		reference_entity_ids?: string[];
		/** The roster's lead subject. Ignored unless it is one of the attached ids. */
		lead_entity_id?: string | null;
		seed_storyboard?: {
			source_prompt?: string | null;
			reference_notes?: string | null;
			storyboard_json: Record<string, unknown>;
			status?: string;
		};
		seed_outputs?: Array<{
			channel?: string | null;
			platform?: string | null;
			kind?: string;
			title: string;
			status?: string;
			notes?: string | null;
			content_json?: Record<string, unknown> | null;
		}>;
	},
	db: Db = openDb(),
): Promise<ContentProjectDetail> {
	const now = Date.now();
	const projectId = randomUUID();
	await db.run(
		`INSERT INTO content_projects
		 (id, workspace, title, type, status, target_platform, target_audience, target_duration_sec, target_format,
		  language, campaign_id, brief_json, reference_notes, editor_state_json, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			projectId,
			input.workspace ?? DEFAULT_CONTENT_WORKSPACE,
			input.title,
			input.type ?? "video",
			input.status ?? "brief",
			input.target_platform ?? null,
			input.target_audience ?? null,
			input.target_duration_sec ?? null,
			input.target_format ?? null,
			input.language ?? null,
			input.campaign_id ?? null,
			input.brief_json ? JSON.stringify(input.brief_json) : null,
			input.reference_notes ?? null,
			input.editor_state ? JSON.stringify(input.editor_state) : null,
			now,
			now,
		],
	);
	for (const speaker of input.speakers ?? []) {
		await upsertProjectSpeaker({ project_id: projectId, ...speaker }, db);
	}
	// The roster is attached here rather than by a follow-up call, so a project
	// created with references selected has them from its first read. The client
	// used to send these and the route dropped them on the floor, which left every
	// new project with an empty roster — and a roster of 0 attaches nothing to a
	// scene, so generation ran refless without saying so.
	const attached = new Set<string>();
	for (const entityId of input.reference_entity_ids ?? []) {
		if (attached.has(entityId)) continue;
		if (await addProjectReference({ project_id: projectId, entity_id: entityId }, db))
			attached.add(entityId);
	}
	if (input.lead_entity_id && attached.has(input.lead_entity_id)) {
		await setProjectPrimaryReference(projectId, input.lead_entity_id, db);
	}
	if (input.seed_storyboard) {
		const storyboardId = randomUUID();
		await db.run(
			`INSERT INTO content_storyboards
			 (id, project_id, version, status, source_prompt, reference_notes, storyboard_json, created_at)
			 VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
			[
				storyboardId,
				projectId,
				input.seed_storyboard.status ?? "draft",
				input.seed_storyboard.source_prompt ?? null,
				input.seed_storyboard.reference_notes ?? null,
				JSON.stringify(input.seed_storyboard.storyboard_json),
				now,
			],
		);
		await recordContentProjectEventDb(db, {
			project_id: projectId,
			storyboard_id: storyboardId,
			actor_type: "system",
			kind: "storyboard.created",
			summary: "Seed storyboard created.",
			payload_json: {
				version: 1,
				status: input.seed_storyboard.status ?? "draft",
			},
			created_at: now,
		});
	}
	for (const output of input.seed_outputs ?? []) {
		const outputId = randomUUID();
		await db.run(
			`INSERT INTO content_project_outputs
			 (id, project_id, storyboard_id, channel, platform, kind, title, status, draft_id, render_id, publish_job_id,
			  content_json, notes, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)`,
			[
				outputId,
				projectId,
				null,
				output.channel ?? null,
				output.platform ?? null,
				output.kind ?? "draft",
				output.title,
				output.status ?? "draft",
				output.content_json ? JSON.stringify(output.content_json) : null,
				output.notes ?? null,
				now,
				now,
			],
		);
		await recordContentProjectEventDb(db, {
			project_id: projectId,
			output_id: outputId,
			actor_type: "system",
			kind: "output.created",
			summary: `Seed output created: ${output.title}.`,
			payload_json: {
				channel: output.channel ?? null,
				platform: output.platform ?? null,
				status: output.status ?? "draft",
			},
			created_at: now,
		});
	}
	await recordContentProjectEventDb(db, {
		project_id: projectId,
		actor_type: "system",
		kind: "project.created",
		summary: "Content project created.",
		payload_json: {
			title: input.title,
			type: input.type ?? "video",
			status: input.status ?? "brief",
		},
		created_at: now,
	});
	return (await getContentProject(projectId, db))!;
}

// Persist the project's mutable editor state (chat log, settings, provenance).
// Stored on content_projects, separate from the versioned storyboard snapshots.
// The media library is its own rows (`project-media-assets.ts`), so a written
// `media_assets` is ignored and the stored one — the list imported from, kept for
// rollback — stays as it was.
export async function setContentEditorState(
	projectId: string,
	state: Record<string, unknown>,
	db: Db = openDb(),
): Promise<boolean> {
	const { media_assets: _written, ...rest } = state;
	return db.transaction(async (tx) => {
		const row = await tx.get<{ editor_state_json: string | null }>(
			`SELECT editor_state_json FROM content_projects WHERE id = ?`,
			[projectId],
		);
		if (!row) return false;
		const stored = parseJsonValue<Record<string, unknown> | null>(
			row.editor_state_json,
			null,
			isJsonObjectOrNull,
		)?.media_assets;
		const next = stored === undefined ? rest : { ...rest, media_assets: stored };
		await tx.run(`UPDATE content_projects SET editor_state_json = ?, updated_at = ? WHERE id = ?`, [
			JSON.stringify(next),
			Date.now(),
			projectId,
		]);
		return true;
	});
}

// Columns on content_projects that callers may patch. brief_json is serialized.
const CONTENT_PROJECT_PATCH_COLS = [
	"title",
	"type",
	"status",
	"target_platform",
	"target_audience",
	"target_duration_sec",
	"target_format",
	"language",
	"campaign_id",
	"reference_notes",
] as const;

export async function updateContentProject(
	id: string,
	patch: {
		title?: string;
		type?: ContentProjectType;
		status?: ContentProjectStatus;
		target_platform?: string | null;
		target_audience?: string | null;
		target_duration_sec?: number | null;
		target_format?: string | null;
		language?: string | null;
		campaign_id?: string | null;
		reference_notes?: string | null;
		brief_json?: ContentProjectBrief | null;
	},
	db: Db = openDb(),
): Promise<ContentProjectDetail | null> {
	const exists = await db.get<{ id: string }>(`SELECT id FROM content_projects WHERE id = ?`, [id]);
	if (!exists) return null;
	const sets: string[] = [];
	const params: Array<string | number | null> = [];
	for (const col of CONTENT_PROJECT_PATCH_COLS) {
		const value = patch[col];
		if (value === undefined) continue;
		sets.push(`${col} = ?`);
		params.push(value);
	}
	if (patch.brief_json !== undefined) {
		sets.push("brief_json = ?");
		params.push(patch.brief_json ? JSON.stringify(patch.brief_json) : null);
	}
	if (sets.length === 0) return getContentProject(id, db);
	const now = Date.now();
	sets.push("updated_at = ?");
	params.push(now);
	await db.run(`UPDATE content_projects SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
	await recordContentProjectEventDb(db, {
		project_id: id,
		actor_type: "operator",
		kind: "project.updated",
		summary: "Project fields updated.",
		payload_json: {
			fields: entriesOf(patch)
				.filter(([, value]) => value !== undefined)
				.map(([key]) => key),
		},
		created_at: now,
	});
	return getContentProject(id, db);
}
