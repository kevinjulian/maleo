/* Pure entity write rules, lifted out of the library component.
 *
 * These were inline in `saveEntity`, where nothing could test them: the tag bug
 * (an edit collapsing `tags` to `[role]` and dropping every other tag) shipped
 * because the rule lived inside a closure that only a rendered component could
 * reach. As free functions they cost three lines to cover. */
import { REF_KIND_ORDER } from "./reference-vocabulary.ts";
import type { RefImage } from "@maleo/shared";
import type { EntityDraft } from "./entity-draft.ts";

/** Role is a property of the entity, so it replaces the previous role tag and
 *  leaves every other tag alone. */
export function nextTags(role: string, existingTags: string[] | undefined): string[] {
	return [role, ...(existingTags ?? []).filter((t) => t !== role && !REF_KIND_ORDER.includes(t))];
}

/** Apply an editor draft to an entity. An existing entity keeps its id, so a
 *  role change is an in-place edit rather than a fork. */
export function applyEntityDraft(
	draft: EntityDraft,
	existing: RefImage | undefined,
	newId: () => string,
): RefImage {
	return {
		...existing,
		id: existing?.id ?? newId(),
		label: draft.label,
		description: draft.description,
		imageUrl: draft.src,
		role: draft.role,
		tags: nextTags(draft.role, existing?.tags),
		// The generating prompt rides along so a reference stays regenerable and
		// its origin stays traceable.
		prompt: draft.prompt ?? existing?.prompt,
		generated: draft.prompt ? true : existing?.generated,
		seed: existing?.seed ?? Math.floor(Math.random() * 999),
	};
}
