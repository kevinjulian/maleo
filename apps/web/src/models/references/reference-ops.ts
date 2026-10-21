/* Maleo — Content-First Create · pure reference-management helpers.
 *
 * Extracted so the Reference Library's usage counting and cross-surface cleanup
 * are unit-testable without rendering the panel.
 *
 * The project selection is one flat list of entity ids (`ProjectSelection`), so
 * the bucket helpers this file used to carry — `projectVisualRefIds`,
 * `allProjectRefIds`, `toggleProjectRef`, `addProjectRefs`, `removeFromProjectRefs` —
 * and both id-prefix adapters (`prod_`, `refmedia:`) are gone. An entity's role
 * comes from the entity, so no prefix or bucket has to encode it. */
import {
	EMPTY_PROJECT_SELECTION,
	normalizeProjectSelection,
	type ProjectSelection,
} from "@maleo/shared";
import type { Scene } from "@maleo/shared";

export { EMPTY_PROJECT_SELECTION, normalizeProjectSelection };
export type { ProjectSelection };

/** How many entities a project has selected. One list, so one code path — this
 *  used to branch on which generation wrote the document. */
export function selectionCount(sel: ProjectSelection): number {
	return sel.entityIds.length;
}

export function isSelected(sel: ProjectSelection, id: string): boolean {
	return sel.entityIds.includes(id);
}

/** Add/remove one entity in the selection (immutable). */
export function toggleSelected(sel: ProjectSelection, id: string): ProjectSelection {
	return { ...sel, entityIds: toggleRefId(sel.entityIds, id) };
}

/** Add entity ids, dedup, immutable. Used when applying a preset so incoming
 *  references become project references immediately. */
export function addSelected(sel: ProjectSelection, ids: string[]): ProjectSelection {
	const add = ids.filter((id) => !sel.entityIds.includes(id));
	return add.length ? { ...sel, entityIds: [...sel.entityIds, ...add] } : sel;
}

/** Drop an entity from the selection (used when the entity is deleted). */
export function removeSelected(sel: ProjectSelection, id: string): ProjectSelection {
	return { ...sel, entityIds: sel.entityIds.filter((x) => x !== id) };
}

type RefHolder = { refIds?: string[]; noteIds?: string[] };

/** Count how many clips (refIds + noteIds) plus project refs attach each logical id. */
export function computeRefUsage(
	items: RefHolder[],
	projectRefIds: string[] = [],
): Map<string, number> {
	const usage = new Map<string, number>();
	const bump = (id: string): void => {
		usage.set(id, (usage.get(id) ?? 0) + 1);
	};
	for (const item of items) {
		for (const id of item.refIds ?? []) bump(id);
		for (const id of item.noteIds ?? []) bump(id);
	}
	for (const id of projectRefIds) bump(id);
	return usage;
}

/** Strip a deleted reference id from every clip's refIds + noteIds. */
export function removeRefFromItems<T extends RefHolder>(items: T[], id: string): T[] {
	return items.map((item) => ({
		...item,
		refIds: (item.refIds ?? []).filter((x) => x !== id),
		noteIds: (item.noteIds ?? []).filter((x) => x !== id),
	}));
}

/** Convenience aliases for the two concrete holder shapes. */
export const removeRefFromScenes = (scenes: Scene[], id: string): Scene[] =>
	removeRefFromItems(scenes, id);

/** Add/remove an id in a flat id list (a scene's refIds, or the selection). Immutable. */
export function toggleRefId(refIds: string[], id: string): string[] {
	return refIds.includes(id) ? refIds.filter((x) => x !== id) : [...refIds, id];
}
