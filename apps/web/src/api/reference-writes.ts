/* Maleo — References: writes that reach the api.
 *
 * Every function here is fire-and-forget: the caller has already applied the
 * change locally, and a failed write is non-fatal by design. Split out of
 * `references/helpers.ts`, which held these beside pure transforms. */
import type { NotePayload } from "@models/content/note-payload.ts";
import type { RefImage } from "@maleo/shared";
import { saveGlobalReferenceAsset } from "@api/workspace-catalogue.ts";
import {
	attachProjectReferenceEntity,
	saveProjectNote,
	setProjectPrimaryReferenceEntity,
} from "@api/references.ts";

export function persistGlobalImage(image: RefImage): void {
	void saveGlobalReferenceAsset(image.id, {
		label: image.label,
		tags: image.tags ?? (image.role ? [image.role] : []),
		note: image.description ?? "",
		seed: image.seed,
		gen: Boolean(image.generated),
		default: image.primary,
		src: image.imageUrl,
		prompt: image.prompt,
	}).catch(() => {
		/* non-fatal */
	});
}

export function persistNoteRef(
	projectId: string,
	id: string,
	n: NotePayload,
	isDefault = false,
): void {
	void saveProjectNote(projectId, id, {
		label: n.label,
		body: n.body,
		tags: n.tags ?? [],
		is_default: isDefault,
	}).catch(() => {
		/* non-fatal */
	});
}

/* Selecting a reference locks it for generation — but generation resolves an id
 * through the project's ROSTER (`resolveEntityRefImages` builds its lookup from
 * `projectCast`), so a lock on an entity that is not attached contributes nothing
 * and does so silently. The workspace library shows every entity in the workspace
 * (89 of them) while a project's roster is typically a handful, so selecting from
 * the library is exactly how an inert lock gets made. Locking therefore attaches.
 *
 * Unselecting does NOT detach. A roster row without a lock is harmless — the
 * entity is available to the project but not applied to every clip — and the
 * agent attaches entities it creates without locking them, so detaching here
 * would delete roster rows the operator never added. */
export function persistProjectSelection(
	projectId: string,
	entityId: string,
	selected: boolean,
): void {
	if (!selected) return;
	void attachProjectReferenceEntity(projectId, entityId).catch(() => {
		/* non-fatal */
	});
}

/* The project's lead subject (`project_reference.is_primary`) — it drives
 * roster-size backfill at generation, so it is a real setting rather than a
 * display flag. The entity model carries it as `is_primary`, which the loader
 * maps onto `RefImage.default`. */
export function persistPrimaryEntity(projectId: string, entityId: string, next: boolean): void {
	void setProjectPrimaryReferenceEntity(projectId, next ? entityId : null).catch(() => {
		/* non-fatal */
	});
}
