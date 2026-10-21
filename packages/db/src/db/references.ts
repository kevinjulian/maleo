/* Reference entities and a project's roster of them.
 *
 * An entity is workspace-scoped; `project_reference` is the attachment that makes
 * it castable in a project. Generation resolves ids through the roster, so an
 * attachment that never happened renders nothing — see CONTEXT.md. */
import { randomUUID } from "node:crypto";
import { openDb } from "./connection.ts";
import { serialize, type Db } from "./handle.ts";

/* The unique index's expression, which a conflict target must repeat exactly.
 * The SQLite index was declared with ifnull and the Postgres one with coalesce;
 * they mean the same, but neither engine matches the other's spelling. */
const sceneKeyIndexExpr = (db: Db): string =>
	db.dialect === "postgres" ? "coalesce(scene_key, '')" : "ifnull(scene_key, '')";

export interface ReferenceEntityRow {
	id: string;
	workspace: string;
	role: string;
	label: string;
	description: string;
	canonical_image_url: string | null;
	tags_json: string | null;
	origin: string;
	created_at: number;
	updated_at: number;
}

/** A project's selected entity, joined to the entity it points at. */
export interface ProjectReferenceRow extends ReferenceEntityRow {
	selection_id: string;
	project_id: string;
	scene_key: string | null;
	/** 1 when this is the project's lead subject (backfills an empty scene cast). */
	is_primary: number;
	selected_at: number;
}

export async function getReferenceEntity(
	id: string,
	db: Db = openDb(),
): Promise<ReferenceEntityRow | null> {
	return await db.get<ReferenceEntityRow>(`SELECT * FROM reference_entity WHERE id = ?`, [id]);
}

/* One workspace's reference entity library.
 *
 * This is the canonical pool. The catalogue used to read `content_assets`
 * instead, which is a mirror: an entity whose mirror row was never written, or
 * was written and later pruned, vanished from the Reference Library while
 * remaining perfectly castable. Visibility now comes from here, and the mirror
 * only decorates it. */
export async function listReferenceEntities(
	workspace: string,
	db: Db = openDb(),
): Promise<ReferenceEntityRow[]> {
	return await db.all<ReferenceEntityRow>(
		`SELECT * FROM reference_entity WHERE workspace = ? ORDER BY label ASC, id ASC`,
		[workspace],
	);
}

export async function deleteReferenceEntity(id: string, db: Db = openDb()): Promise<boolean> {
	const existing = await getReferenceEntity(id, db);
	if (!existing) return false;
	return db.transaction(async (tx) => {
		await tx.run(`DELETE FROM project_reference WHERE entity_id = ?`, [id]);
		await tx.run(`DELETE FROM reference_entity WHERE id = ?`, [id]);
		return true;
	});
}

/** What makes two entities the same reference, when neither side knows an id. */
export interface ReferenceEntityContentKey {
	workspace: string;
	role: string;
	label: string;
	canonical_image_url?: string | null;
}

/* The entity a content key names, if the library already holds it.
 *
 * `reference_entity` is unique on `id`, so the upsert below could only ever
 * deduplicate a caller that already knew the id. A caller that mints one — the
 * persona-era project-creation path, and `create_character` today — had no way
 * to ask "is this picture already in the library?", so it inserted. That is how
 * one workspace came to hold seven rows for "Anjing", six of them created in the
 * same minute as six different projects.
 *
 * The key is workspace + role + label + canonical image url. The label is
 * compared case-insensitively and trimmed, because the same name re-cased is the
 * same name.
 *
 * No image url means no key. An entity awaiting an image is not a duplicate of
 * another entity awaiting one — there is nothing to compare — so it is never
 * matched and never matches.
 *
 * The oldest row wins where legacy duplicates still exist. They are not removed
 * (each is attached to some project's roster), so the lookup has to resolve
 * deterministically rather than pick whichever row the planner happened to
 * return first. */
export async function findReferenceEntityByContent(
	key: ReferenceEntityContentKey,
	db: Db = openDb(),
): Promise<ReferenceEntityRow | null> {
	const url = key.canonical_image_url?.trim();
	if (!url) return null;
	const label = key.label.trim();
	if (!label) return null;
	return await db.get<ReferenceEntityRow>(
		`SELECT * FROM reference_entity
		 WHERE workspace = ? AND role = ? AND lower(trim(label)) = lower(?) AND trim(canonical_image_url) = ?
		 ORDER BY created_at ASC, id ASC
		 LIMIT 1`,
		[key.workspace, key.role, label, url],
	);
}

/* Create or update an entity. `role` is validated by the table's CHECK
 * constraint, so an out-of-vocabulary role throws rather than being coerced.
 * Editing role/label is a plain UPDATE of one row — role is deliberately absent
 * from any uniqueness key, which is what stops the "edit a role, get a duplicate"
 * fork the old content_references upsert produced.
 *
 * Matching is by id FIRST and content key second, and the order is the whole
 * rule. A caller naming an existing id is editing that entity — including
 * renaming it, which changes its content key and may land it on another
 * entity's. That has to stay an edit. Checking content first would turn a rename
 * into a silent merge, redirecting the write onto a row the caller never named.
 *
 * The content key applies only when the supplied id matches nothing, which is
 * exactly the minted-id case that forked the library. */
export async function upsertReferenceEntity(
	input: {
		id: string;
		workspace: string;
		role: string;
		label: string;
		description?: string;
		canonical_image_url?: string | null;
		tags?: string[] | null;
		origin?: string;
	},
	db: Db = openDb(),
): Promise<ReferenceEntityRow | null> {
	return db.transaction(async (tx) => {
		const now = Date.now();
		/* Find-then-insert by content key: two concurrent adds of the same reference
		 * must not both find nothing and both insert. SQLite's single writer made
		 * that impossible; on Postgres the lock does. */
		await serialize(
			tx,
			`reference-content:${input.workspace}:${input.role}:${input.label.trim().toLowerCase()}:${input.canonical_image_url?.trim() ?? ""}`,
		);
		// Id first: a caller naming a row that exists is editing it, whatever the edit
		// does to its content key.
		const existing =
			(await getReferenceEntity(input.id, tx)) ?? (await findReferenceEntityByContent(input, tx));
		const id = existing?.id ?? input.id;
		await tx.run(
			`INSERT INTO reference_entity
			   (id, workspace, role, label, description, canonical_image_url, tags_json, origin, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(id) DO UPDATE SET
			   workspace = excluded.workspace,
			   role = excluded.role,
			   label = excluded.label,
			   description = excluded.description,
			   canonical_image_url = excluded.canonical_image_url,
			   tags_json = excluded.tags_json,
			   origin = excluded.origin,
			   updated_at = excluded.updated_at`,
			[
				id,
				input.workspace,
				input.role,
				input.label,
				input.description ?? "",
				input.canonical_image_url ?? null,
				input.tags ? JSON.stringify(input.tags) : null,
				input.origin ?? "linked",
				now,
				now,
			],
		);
		// The row's own id, which is not always the one asked for: a minted id that
		// matched an existing reference by content was discarded in favour of it.
		// Callers read this rather than their own, so the roster attaches the entity
		// that actually exists.
		return getReferenceEntity(id, tx);
	});
}

/* Attach a workspace entity to a project. Rejects a cross-workspace selection:
 * a project may only select from its own workspace's library, so an entity can
 * never leak between tenants. Idempotent per (project, entity, scene_key) — the
 * unique index normalises a NULL scene_key to '' so repeat project-level attaches
 * do not accumulate rows. */
export async function addProjectReference(
	input: {
		project_id: string;
		entity_id: string;
		scene_key?: string | null;
	},
	db: Db = openDb(),
): Promise<ProjectReferenceRow | null> {
	const project = await db.get<{ workspace: string }>(
		`SELECT workspace FROM content_projects WHERE id = ?`,
		[input.project_id],
	);
	if (!project) return null;
	const entity = await getReferenceEntity(input.entity_id, db);
	if (!entity) return null;
	if (entity.workspace !== project.workspace) return null;

	const sceneKey = input.scene_key ?? null;
	await db.run(
		`INSERT INTO project_reference (id, project_id, entity_id, scene_key, created_at)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(project_id, entity_id, ${sceneKeyIndexExpr(db)}) DO NOTHING`,
		[randomUUID(), input.project_id, input.entity_id, sceneKey, Date.now()],
	);
	return findProjectReference(input.project_id, input.entity_id, sceneKey, db);
}

async function findProjectReference(
	projectId: string,
	entityId: string,
	sceneKey: string | null,
	db: Db,
): Promise<ProjectReferenceRow | null> {
	return await db.get<ProjectReferenceRow>(
		`SELECT s.id AS selection_id, s.project_id, s.scene_key, s.is_primary, s.created_at AS selected_at, e.*
		 FROM project_reference s
		 JOIN reference_entity e ON e.id = s.entity_id
		 WHERE s.project_id = ? AND s.entity_id = ? AND coalesce(s.scene_key, '') = coalesce(?, '')`,
		[projectId, entityId, sceneKey],
	);
}

/** A project's selected entities. `scene_key` null = project-level selection. */
export async function listProjectReferences(
	projectId: string,
	opts?: { sceneKey?: string | null },
	db: Db = openDb(),
): Promise<ProjectReferenceRow[]> {
	const base = `SELECT s.id AS selection_id, s.project_id, s.scene_key, s.is_primary, s.created_at AS selected_at, e.*
		 FROM project_reference s
		 JOIN reference_entity e ON e.id = s.entity_id
		 WHERE s.project_id = ?`;
	if (opts && "sceneKey" in opts) {
		return await db.all<ProjectReferenceRow>(
			`${base} AND coalesce(s.scene_key, '') = coalesce(?, '') ORDER BY s.created_at ASC`,
			[projectId, opts.sceneKey ?? null],
		);
	}
	return db.all<ProjectReferenceRow>(`${base} ORDER BY s.created_at ASC`, [projectId]);
}

/** What a lock sync did: what is now attached, and what could not be. */
export interface ProjectReferenceLockSync {
	attached: string[];
	unresolved: string[];
}

/* Make a document's generation lock renderable.
 *
 * The lock (`storyboard.projectReferences.entityIds`) and the roster
 * (`project_reference`) are two stores, and a selected id only generates when it
 * is in both. Preset application wrote the lock alone, so a preset-selected
 * reference was inert: the document said `Sketch Stickman`, the roster did not
 * have it, and the resolver had nothing to resolve.
 *
 * Every writer of the lock calls this, so the two stores cannot drift apart by
 * one caller forgetting. Attaching is idempotent, and an id that cannot attach
 * — missing entity, or an entity from another workspace — is returned rather
 * than swallowed, because the caller is the only one that can say whether that
 * is a preset-application finding or a generation block. */
export async function syncProjectReferenceLock(
	input: {
		project_id: string;
		entity_ids: readonly string[];
	},
	db: Db = openDb(),
): Promise<ProjectReferenceLockSync> {
	const attached: string[] = [];
	const unresolved: string[] = [];
	const seen = new Set<string>();
	for (const raw of input.entity_ids) {
		const entityId = raw?.trim();
		if (!entityId || seen.has(entityId)) continue;
		seen.add(entityId);
		if (await addProjectReference({ project_id: input.project_id, entity_id: entityId }, db))
			attached.push(entityId);
		else unresolved.push(entityId);
	}
	return { attached, unresolved };
}

/** One project's drift, and what reconciling it did. */
export interface ProjectLockReconciliation {
	project_id: string;
	attached: string[];
	unresolved: string[];
}

/* Repair locks that drifted before the two stores were written together.
 *
 * Projects created before the lock and the roster were synced can hold a
 * generation lock naming references they never attached. Until now that
 * degraded quietly — the reference was dropped and the run reported it after
 * the images had already been generated. Generation blocks on it instead, which
 * turns every one of those projects from "generates the wrong thing" into
 * "does not generate", so the repair has to run before the block does.
 *
 * Only ids that resolve to an attachable workspace entity are attached. The
 * rest are returned: a lock naming a deleted entity or another workspace's
 * entity is genuinely broken, and the operator has to remove or replace it.
 *
 * Idempotent, so it is safe to run repeatedly. */
export async function reconcileProjectReferenceLocks(
	input: {
		/** Limit to one project. Omitted, every project with a lock is reconciled. */
		project_id?: string;
		/** Read a project's latest lock. Injected because the document contract lives
		 *  above this layer — this module knows rosters, not storyboards. */
		readLock: (projectId: string) => readonly string[] | Promise<readonly string[]>;
	},
	db: Db = openDb(),
): Promise<ProjectLockReconciliation[]> {
	const projectIds = input.project_id
		? [input.project_id]
		: (await db.all<{ id: string }>(`SELECT id FROM content_projects ORDER BY created_at ASC`)).map(
				(row) => row.id,
			);

	const out: ProjectLockReconciliation[] = [];
	for (const projectId of projectIds) {
		const lockIds = await input.readLock(projectId);
		if (lockIds.length === 0) continue;
		const attachedAlready = new Set(
			(await listProjectReferences(projectId, { sceneKey: null }, db)).map((row) => row.id),
		);
		const missing = lockIds.filter((id) => id?.trim() && !attachedAlready.has(id));
		if (missing.length === 0) continue;
		const sync = await syncProjectReferenceLock({ project_id: projectId, entity_ids: missing }, db);
		out.push({ project_id: projectId, attached: sync.attached, unresolved: sync.unresolved });
	}
	return out;
}

/* Designate the project's lead subject. Exactly one primary per project: setting
 * one clears the others, so `selectCast`'s backfill can never see two candidates. */
export async function setProjectPrimaryReference(
	projectId: string,
	entityId: string | null,
	db: Db = openDb(),
): Promise<void> {
	await db.run(`UPDATE project_reference SET is_primary = 0 WHERE project_id = ?`, [projectId]);
	if (entityId) {
		await db.run(
			`UPDATE project_reference SET is_primary = 1 WHERE project_id = ? AND entity_id = ?`,
			[projectId, entityId],
		);
	}
}

export async function removeProjectReference(
	projectId: string,
	entityId: string,
	sceneKey: string | null = null,
	db: Db = openDb(),
): Promise<boolean> {
	return (
		(
			await db.run(
				`DELETE FROM project_reference WHERE project_id = ? AND entity_id = ? AND coalesce(scene_key, '') = coalesce(?, '')`,
				[projectId, entityId, sceneKey],
			)
		).changes > 0
	);
}
