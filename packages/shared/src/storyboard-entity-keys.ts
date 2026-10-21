/* Stable keys for slides and posts.
 *
 * The persisted document has always had a `key` field. Nothing kept it stable:
 * every writer recomputed it from array position (`slide_${i + 1}`) and every
 * reader threw it away and renumbered. So a key round-tripped, but it named a
 * POSITION, not a slide — reorder two slides and both keys now point at the other
 * one's content.
 *
 * That was survivable while nothing depended on identity. Per-entity fencing does:
 * it compares "the entity this result changed" against "that entity now", and a
 * positional key makes the comparison read the wrong record. The result then
 * applies cleanly to the wrong slide, which is worse than refusing to apply, since
 * nothing looks wrong until the user reads their carousel.
 *
 * So a key is minted once, when the slide is created, and carried from then on —
 * through generation, reorder, save, and reload.
 *
 * Legacy documents are full of positional keys, and two independent writers using
 * `slide_1` means duplicates exist in the corpus. `repairEntityKeys` is the load
 * boundary that fixes both, and it runs before anything fences against a key. */

/** Key prefixes. Distinct per kind so a slide key can never collide with a post
 *  key if the two ever meet in one map. */
export const SLIDE_KEY_PREFIX = "slide";
export const POST_KEY_PREFIX = "post";

/* Mint a key that will not collide with anything already in the document.
 *
 * Deliberately not `slide_${count + 1}`: delete slide 2 of 3, add a slide, and
 * that scheme mints `slide_3`, which the surviving third slide already holds.
 * The random suffix makes a new key independent of how many slides exist and of
 * what happened to the ones that are gone. */
export function mintEntityKey(prefix: string, taken?: ReadonlySet<string>): string {
	for (let attempt = 0; attempt < 8; attempt++) {
		const key = `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
		if (!taken?.has(key)) return key;
	}
	// Eight collisions on a 36^8 space does not happen; falling back to a
	// timestamped key keeps this total rather than looping forever.
	return `${prefix}_${Date.now().toString(36)}`;
}

/** Anything carrying a key, whatever else it holds. */
export interface KeyedEntity {
	key?: string;
}

/* Give every entity a unique, stable key.
 *
 * Three cases, all present in the stored corpus:
 *
 *  - a key that is unique — kept, untouched. This is the whole point: a document
 *    written after this change reloads with identical keys.
 *  - a missing or empty key — minted. Legacy documents predate keys entirely.
 *  - a duplicate key — the FIRST holder keeps it and later ones are re-minted.
 *    Keeping the first is arbitrary but it has to be deterministic, or two
 *    reloads of the same document disagree about which slide is which.
 *
 * Pure and allocation-light: returns the same array when nothing needed
 * repairing, so the common path costs one pass and no garbage. */
export function repairEntityKeys<T extends KeyedEntity>(entities: T[], prefix: string): T[] {
	const seen = new Set<string>();
	let changed = false;

	const repaired: T[] = entities.map((entity) => {
		const key = entity.key?.trim();
		if (key && !seen.has(key)) {
			seen.add(key);
			return entity;
		}
		changed = true;
		const minted = mintEntityKey(prefix, seen);
		seen.add(minted);
		return { ...entity, key: minted };
	});

	// The same array identity when nothing needed repairing, so a caller can use
	// reference equality to skip work on the common path.
	return changed ? repaired : entities;
}

/** Every key currently in use, for minting against. */
export function entityKeysOf(entities: readonly KeyedEntity[]): Set<string> {
	return new Set(entities.map((entity) => entity.key).filter((key): key is string => Boolean(key)));
}
