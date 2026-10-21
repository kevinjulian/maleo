import { fieldOf } from "./object-keys.ts";
/* A project's reference selection — one flat list of `reference_entity` ids.
 *
 * This replaces `ProjectReferences`, which partitioned one concept into four
 * parallel arrays (`mediaAssetIds` / `imageIds` / `noteIds` / `productIds`) and
 * needed two string-prefix protocols to express identities the buckets could not:
 * `prod_<id>` faked a catalogue product as a reference and `refmedia:<id>` faked a
 * reference as a media asset. An entity carries its own role, so neither prefix
 * nor bucket is needed to say what an id refers to.
 *
 * Notes are deliberately absent. A note is not a reference entity — it lives in
 * `project_note` and its attachment is that row's `is_default` — so the old
 * `noteIds` bucket had no flat equivalent and is dropped on read.
 *
 * The four-bucket shape survives only as a persisted document shape that
 * `normalizeProjectSelection` reads; nothing writes it. */

/** A project's generation reference lock: the prompt plus the selected entities. */
export interface ProjectSelection {
	prompt: string;
	entityIds: string[];
}

export const EMPTY_PROJECT_SELECTION: ProjectSelection = { prompt: "", entityIds: [] };

/** `refmedia:` prefixed ids are the old media-asset alias for a reference. The
 *  id after the prefix is the entity id, so the alias reads as its target. */
const REF_MEDIA_PREFIX = "refmedia:";

function stringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function entityIdOf(id: string): string {
	// Only `refmedia:` is stripped. `prod_` is part of real `reference_entity` ids
	// written by the entity migration, so stripping it would dangle the reference.
	return id.startsWith(REF_MEDIA_PREFIX) ? id.slice(REF_MEDIA_PREFIX.length) : id;
}

/** Read any persisted shape — flat, four-bucket, or legacy `{ prompt, refIds }` —
 *  into the flat selection. Unknown input normalises to empty rather than throwing,
 *  because this runs on load for documents written by three different generations. */
export function normalizeProjectSelection(raw: unknown): ProjectSelection {
	// Each field read off `unknown`; `stringArray` already drops anything that is
	// not a list of strings, which is what these documents can legitimately hold
	// after three generations of shape changes.
	const field = (key: string): unknown => fieldOf(raw, key);
	const rawPrompt = field("prompt");
	const prompt = typeof rawPrompt === "string" ? rawPrompt : "";

	if (field("entityIds") !== undefined) {
		return { prompt, entityIds: dedupe(stringArray(field("entityIds")).map(entityIdOf)) };
	}

	// Four-bucket era. `imageIds` absent means the pre-`imageIds` generation, whose
	// selection lived in `refIds`. `mediaAssetIds` mirrors `imageIds` through the
	// alias, so it contributes only ids the other buckets missed.
	const visualIds =
		field("imageIds") !== undefined ? stringArray(field("imageIds")) : stringArray(field("refIds"));
	const entityIds = dedupe([
		...visualIds,
		...stringArray(field("productIds")),
		...stringArray(field("mediaAssetIds")).map(entityIdOf),
	]);
	return { prompt, entityIds };
}

function dedupe(ids: string[]): string[] {
	return [...new Set(ids.filter((id) => id.length > 0))];
}

/** True once a document no longer carries the four legacy buckets. Used by the
 *  migration's verification pass and by the read path. */
export function isFlatSelection(raw: unknown): boolean {
	if (!raw || typeof raw !== "object") return true;
	return ["mediaAssetIds", "imageIds", "noteIds", "productIds", "refIds"].every(
		(key) => fieldOf(raw, key) === undefined,
	);
}
