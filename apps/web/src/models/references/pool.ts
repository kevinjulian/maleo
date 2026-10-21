/* The reference pool — one list of reference entities behind every surface.
 *
 * There used to be two stores, `refs.images` and `libraryImages`. Both were
 * seeded from the same workspace catalogue, both received the project's entities
 * at load, every mutation wrote both in lockstep, and every reader merged them
 * back together. The distinction they nominally carried — workspace library vs
 * the project's roster — was destroyed by that merge, which matters because
 * roster size drives cast defaulting (a one-entity roster auto-casts).
 *
 * So the pool keeps it explicitly: `inRoster` marks the entities this project
 * attached. The pool is server-derived (workspace catalogue + the project's
 * entities) and is NOT persisted — `editor_state_json` would then hold a second
 * copy of entity fields the DB already owns. */
import type { RefImage } from "@maleo/shared";

/** How an incoming batch resolves against entries already in the pool.
 *
 *  `overwrite` — the incoming copy wins field-for-field. Used for the project's
 *  own entities and for edits made in the editor.
 *  `fill` — existing fields win; incoming only adds entities the pool lacks.
 *  Used for the workspace catalogue, so a late catalogue response cannot
 *  overwrite the project's copy of an entity it also selected. */
export type PoolMergeMode = "overwrite" | "fill";

export interface PoolMergeOptions {
	mode?: PoolMergeMode;
	/** Marks the incoming entities as attached to the project's roster. Sticky:
	 *  a merge never clears the flag, because nothing here detaches. */
	inRoster?: boolean;
}

/* Two entries the operator would read as the same reference.
 *
 * `reference_entity` carries legacy duplicates — the persona-era import minted a
 * fresh uuid per run, so one picture can be seven rows with seven ids. The
 * catalogue collapses them, but the project's own roster copy arrives here from
 * a different read and may be a DIFFERENT one of those rows, so id equality is
 * not enough to recognise it as already present.
 *
 * Only a shared image url makes two entries the same picture. Without one there
 * is nothing to compare, so the id stands alone and nothing is collapsed. */
function logicalKey(entry: RefImage): string {
	const url = entry.imageUrl?.trim();
	return url ? `${entry.role ?? ""}:${entry.label.trim().toLowerCase()}:${url}` : `id:${entry.id}`;
}

/** Merge a batch of entities into the pool, preserving pool order and appending
 *  entities it has not seen. Immutable. */
export function mergePool(
	current: RefImage[],
	incoming: RefImage[],
	options: PoolMergeOptions = {},
): RefImage[] {
	const { mode = "overwrite", inRoster = false } = options;
	if (incoming.length === 0) return current;

	const incomingById = new Map(incoming.map((entry) => [entry.id, entry]));
	const seen = new Set(current.map((entry) => entry.id));
	const seenLogical = new Map(current.map((entry) => [logicalKey(entry), entry]));

	const updated = current.map((entry) => {
		const next = incomingById.get(entry.id);
		return next ? combine(entry, next, mode, inRoster) : entry;
	});

	/* An incoming duplicate under a different id does not become a second card.
	 * It folds into the entry already here, in place, keeping that card's position.
	 *
	 * When the incoming copy is the roster one it wins the identity, rather than
	 * merely lending its flag: the project's document selects references by the id
	 * it attached, so surviving under the catalogue's id would leave the selection
	 * pointing at no pool entry and the surface would call an attached reference
	 * unresolved. */
	const added: RefImage[] = [];
	for (const entry of incoming) {
		if (seen.has(entry.id)) continue;
		const key = logicalKey(entry);
		const existing = seenLogical.get(key);
		if (existing) {
			if (!inRoster || existing.inRoster === true) continue;
			const at = updated.findIndex((candidate) => candidate.id === existing.id);
			if (at >= 0) {
				const merged = { ...existing, ...entry, inRoster: true };
				updated[at] = merged;
				seenLogical.set(key, merged);
			}
			continue;
		}
		const next = inRoster ? { ...entry, inRoster: true } : entry;
		seenLogical.set(key, next);
		added.push(next);
	}

	return [...updated, ...added];
}

function combine(
	existing: RefImage,
	incoming: RefImage,
	mode: PoolMergeMode,
	inRoster: boolean,
): RefImage {
	const fields = mode === "overwrite" ? { ...existing, ...incoming } : { ...incoming, ...existing };
	const attached = inRoster || existing.inRoster === true;
	return attached ? { ...fields, inRoster: true } : fields;
}

/** Insert or replace one entity, keeping its position when it is already there. */
export function upsertPool(current: RefImage[], next: RefImage): RefImage[] {
	return current.some((entry) => entry.id === next.id)
		? current.map((entry) => (entry.id === next.id ? { ...entry, ...next } : entry))
		: [...current, next];
}

/** Drop an entity from the pool (the workspace library deleted it). */
export function removeFromPool(current: RefImage[], id: string): RefImage[] {
	return current.filter((entry) => entry.id !== id);
}

/** The project's roster: the entities it attached. This — not the whole pool —
 *  is what cast defaulting sizes itself against. */
export function rosterOf(pool: RefImage[]): RefImage[] {
	return pool.filter((entry) => entry.inRoster === true);
}

/** A selected id that will not render, and what the surface can say about it. */
export interface UnresolvedSelection {
	id: string;
	/** The entity's label when the workspace still has it; the bare id when not. */
	label: string;
	/** `unattached` — in the workspace library, just not on this project's roster,
	 *  so attaching fixes it. `missing` — not in the library at all, so the only
	 *  remedy is to drop it from the selection. */
	reason: "unattached" | "missing";
}

/* Selected ids that cannot render.
 *
 * The document's selection and the project's roster are two stores, and an id
 * in the first without a row in the second renders nothing. That used to be
 * invisible here: the selection looked applied, the Reference Library showed no
 * sign of it, and the operator learned about it from images that were missing
 * the reference they had chosen.
 *
 * Generation blocks on exactly this set, so naming it before the run is what
 * lets the operator fix it rather than discover it. */
export function unresolvedSelections(
	pool: RefImage[],
	selectedIds: readonly string[],
): UnresolvedSelection[] {
	const byId = new Map(pool.map((entry) => [entry.id, entry]));
	const seen = new Set<string>();
	const out: UnresolvedSelection[] = [];
	for (const id of selectedIds) {
		if (!id || seen.has(id)) continue;
		seen.add(id);
		const entry = byId.get(id);
		if (entry?.inRoster === true) continue;
		out.push({
			id,
			label: entry?.label?.trim() || id,
			reason: entry ? "unattached" : "missing",
		});
	}
	return out;
}
