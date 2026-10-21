/* Row -> wire for reference entities.
 *
 * This is the seam the API was missing: routes used to answer with the row the
 * query returned, so SQL column names were the wire format and the client's
 * vocabulary at once. Everything database-shaped about an entity — the `_json`
 * suffix, the 0/1 integers, the `canonical_` prefix — stops here. */
import type {
	CastEntity,
	ProjectNoteWire,
	ProjectSpeakerWire,
	ReferenceEntityWire,
} from "@maleo/shared";
import { roleOf, fieldOf } from "@maleo/shared";
import type { ProjectNoteRow, ProjectSpeakerRow } from "@maleo/db/project-children";
import type { ProjectReferenceRow, ReferenceEntityRow } from "@maleo/db/references";
import { parseJsonStringArray } from "@maleo/db/row-json";

/* Decoding `tags_json` is the db module's job; what is local here is the
 * fallback. A row whose tags are absent, empty or unparseable still has a role,
 * and the role is the tag that matters — an entity is never dropped over its
 * metadata. This used to re-implement the decode as well, so the same column had
 * two readers that disagreed only in what they returned for a broken value. */
function parseTags(tagsJson: string | null, fallbackRole: string): string[] {
	const tags = parseJsonStringArray(tagsJson);
	return tags.length ? tags : [fallbackRole];
}

export function toReferenceEntityWire(
	row: ReferenceEntityRow | ProjectReferenceRow,
): ReferenceEntityWire {
	const role = roleOf(row.role) ?? "style";
	return {
		id: row.id,
		role,
		label: row.label ?? "",
		description: row.description ?? "",
		imageUrl: row.canonical_image_url ?? null,
		tags: parseTags(row.tags_json ?? null, role).map((tag) => roleOf(tag) ?? tag),
		primary: fieldOf(row, "is_primary") === 1,
		origin: row.origin === "generated" ? "generated" : "linked",
	};
}

export function toReferenceEntityWires(
	rows: ReadonlyArray<ReferenceEntityRow | ProjectReferenceRow>,
): ReferenceEntityWire[] {
	return rows.map(toReferenceEntityWire);
}

/* ── Generation views ──────────────────────────────────────────────────────
 *
 * Two projections of the same decoded entity, named for the question each
 * answers. They used to live in `agent/visual-gen.ts` as `projectRoster` and
 * `projectCast`, both reading rows again and both reading as "the project's
 * roster" — which is how they could disagree about style entities for as long as
 * they did without anyone choosing. They are not the same question:
 *
 *   castableSubjects — which subjects may a scene DECLARE in its cast. A style
 *     entity binds a global look rather than an indexed subject, so it is not
 *     castable; an entity with no image cannot be bound to a reference image.
 *
 *   resolutionSet — which entities ENTER resolution. Style is kept here because
 *     `resolveSceneRoster` distinguishes roles itself and never caps a
 *     non-subject one; only the image requirement applies.
 *
 * Neither is "the roster" unqualified. `project_reference` is the roster; these
 * are what generation asks of it. */

/** One castable subject, as `filterKnownCastIds` and the planner see it. */
export interface CastableSubject {
	id: string;
	label: string;
	role: string;
}

/** The subjects a scene may declare. Style and imageless entities excluded. */
export function castableSubjects(rows: ReadonlyArray<ProjectReferenceRow>): CastableSubject[] {
	return rows
		.filter((row) => roleOf(row.role) !== "style" && row.canonical_image_url)
		.map((row) => ({ id: row.id, label: row.label || row.id, role: roleOf(row.role) ?? "style" }));
}

/** The entities resolution runs over. Style kept; imageless excluded; deduped.
 *
 *  `roleOf` is here to narrow `string` to `Role`, not to validate: the column is
 *  CHECK-constrained to exactly the values `ROLES` declares, so its null branch is
 *  unreachable for a row that came from the table. It stays because the
 *  alternative is an unchecked cast, and an unreachable branch is cheaper than a
 *  lie to the compiler. `reference-decode.bun.test.ts` pins the two vocabularies
 *  against each other, so if they ever drift this becomes reachable rather than
 *  silently wrong. */
export function resolutionSet(rows: ReadonlyArray<ProjectReferenceRow>): CastEntity[] {
	const seen = new Set<string>();
	const out: CastEntity[] = [];
	for (const row of rows) {
		if (seen.has(row.id) || !row.canonical_image_url) continue;
		const role = roleOf(row.role);
		if (!role) continue;
		seen.add(row.id);
		out.push({
			id: row.id,
			role,
			imageUrl: row.canonical_image_url,
			label: row.label ?? "",
			description: row.description ?? "",
			primary: row.is_primary === 1,
		});
	}
	return out;
}

export function toProjectNoteWire(row: ProjectNoteRow): ProjectNoteWire {
	return {
		id: row.id,
		label: row.label ?? "",
		body: row.body ?? "",
		tags: Array.isArray(row.tags) ? row.tags : [],
		isDefault: row.is_default === 1,
	};
}

export function toProjectNoteWires(rows: ReadonlyArray<ProjectNoteRow>): ProjectNoteWire[] {
	return rows.map(toProjectNoteWire);
}

export function toProjectSpeakerWire(row: ProjectSpeakerRow): ProjectSpeakerWire {
	return {
		voiceKey: row.voice_key,
		name: row.name ?? "",
		hue: row.hue ?? null,
		isDefault: row.is_default === 1,
	};
}

export function toProjectSpeakerWires(
	rows: ReadonlyArray<ProjectSpeakerRow>,
): ProjectSpeakerWire[] {
	return rows.map(toProjectSpeakerWire);
}
