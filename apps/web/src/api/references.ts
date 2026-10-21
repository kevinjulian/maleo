/* The project's reference library and its ROSTER.
 *
 * The roster (which workspace entities are attached to this project) is distinct
 * from the generation lock (`projectReferences.entityIds` in the storyboard
 * document), which says which of the roster applies to every clip. The lock is a
 * subset of the roster; nothing here writes it. */
import { del, post, put } from "./client.ts";
import { BASE } from "./base.ts";

/* ── The project ROSTER ── */

/** Attach a workspace entity to the project. Idempotent. Rejected by the server
 *  when the entity belongs to another workspace. */
export async function attachProjectReferenceEntity(
	projectId: string,
	entityId: string,
): Promise<void> {
	await post(`${BASE}/projects/${encodeURIComponent(projectId)}/reference-entities`, {
		entity_id: entityId,
	});
}

/** Detach an entity from the project. The entity stays in the workspace library. */
export async function detachProjectReferenceEntity(
	projectId: string,
	entityId: string,
): Promise<void> {
	await del(
		`${BASE}/projects/${encodeURIComponent(projectId)}/reference-entities/${encodeURIComponent(entityId)}`,
	);
}

/** Set the project's lead subject, or pass null to clear it. The entity must
 *  already be attached — `selectCast`'s backfill reads this. */
export async function setProjectPrimaryReferenceEntity(
	projectId: string,
	entityId: string | null,
): Promise<void> {
	await put(`${BASE}/projects/${encodeURIComponent(projectId)}/reference-entities/primary`, {
		entity_id: entityId,
	});
}

/** Save a text-only project note to `project_note`. Notes were written as
 *  kind='note' reference rows until the reference table was retired. */
export async function saveProjectNote(
	projectId: string,
	noteId: string,
	note: { label: string; body: string; tags: string[]; is_default: boolean },
): Promise<void> {
	await put(
		`${BASE}/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(noteId)}`,
		note,
	);
}

export async function deleteProjectNote(projectId: string, noteId: string): Promise<void> {
	await del(
		`${BASE}/projects/${encodeURIComponent(projectId)}/notes/${encodeURIComponent(noteId)}`,
	);
}
