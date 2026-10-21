/* The Story Bible's reference entries, derived from validated visual direction.
 *
 * The bible model call authors the story's constants and its descriptive subjects.
 * It does NOT decide which of them is a reusable reference — direction does, by
 * binding an identity. So the reference entries are computed here with no model
 * call, which is what lets a revision rebind a subject without re-authoring the
 * bible, and what keeps a `needsDirection` plan's bible descriptive-only.
 *
 * The entry id derives from the identity, so a binding maps to exactly one entry
 * by construction. The previous label join could not do this: a roster with two
 * entities labelled "Lebah POV" gave one entry and an arbitrary winner. */
import {
	storyBibleSchema,
	type StoryBible,
	type StoryBibleLocation,
	type StoryBibleSubject,
} from "./story-bible.ts";
import { normalizedReferenceLabel } from "./story-visual-direction.ts";

export interface DirectedReferenceEntry {
	/** `entity:<id>` or `planned:<key>`, from `bindingIdentity`. */
	identity: string;
	role: string;
	label: string;
	description?: string;
	aliases?: readonly string[];
}

/** Stable, collision-free within a bible: one identity, one entry id. */
export function referenceEntryId(identity: string): string {
	return `ref-${identity.replace(":", "-")}`;
}

function linkOf(identity: string): { entityId?: string; refKey?: string } {
	const [kind, ...rest] = identity.split(":");
	const value = rest.join(":");
	return kind === "entity" ? { entityId: value } : { refKey: value };
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.filter((value) => value.trim().length > 0))];
}

/** True when a descriptive entry is the model's duplicate of a directed one. */
function collides(
	entry: { label: string; aliases?: readonly string[] },
	names: ReadonlySet<string>,
): boolean {
	if (names.has(normalizedReferenceLabel(entry.label))) return true;
	return (entry.aliases ?? []).some((alias) => names.has(normalizedReferenceLabel(alias)));
}

/* Absorbing the duplicate rather than dropping it keeps the model's visible detail
 * ("bulu emas") while the resolved reference stays the locked identity. */
export function bibleWithDirectedReferences(
	bible: StoryBible,
	entries: readonly DirectedReferenceEntry[],
): StoryBible {
	/* Entries from a previous derivation are rebuilt, never accumulated: a rebound
	 * subject must not leave its old identity behind in the bible. */
	const priorSubjects = bible.subjects.filter((subject) => !subject.entityId && !subject.refKey);
	const priorLocations = bible.locations.filter(
		(location) => !location.entityId && !location.refKey,
	);
	/* Detail already absorbed into a reference entry belongs to that identity, not to
	 * the derivation that first moved it: re-deriving must carry it, or a revision
	 * would quietly strip the model's descriptors the second time it runs. */
	const derivedById = new Map<
		string,
		{ aliases?: readonly string[]; descriptors: readonly string[]; mustAvoid?: readonly string[] }
	>([
		...bible.subjects
			.filter((subject) => subject.entityId ?? subject.refKey)
			.map((subject) => [subject.id, subject] as const),
		...bible.locations
			.filter((location) => location.entityId ?? location.refKey)
			.map((location) => [location.id, location] as const),
	]);
	if (!entries.length) {
		return priorSubjects.length === bible.subjects.length &&
			priorLocations.length === bible.locations.length
			? bible
			: storyBibleSchema.parse({ ...bible, subjects: priorSubjects, locations: priorLocations });
	}

	const names = new Set(
		entries
			.flatMap((entry) => [entry.label, ...(entry.aliases ?? [])])
			.map(normalizedReferenceLabel),
	);
	const absorbedSubjects = priorSubjects.filter((subject) => collides(subject, names));
	const absorbedLocations = priorLocations.filter((location) => collides(location, names));

	const subjects: StoryBibleSubject[] = [];
	const locations: StoryBibleLocation[] = [];
	/* Sorted by identity so the same direction derives the same bible whatever order
	 * the model listed its bindings in — the entries reach an input hash. */
	for (const entry of [...entries].sort((a, b) =>
		a.identity < b.identity ? -1 : a.identity > b.identity ? 1 : 0,
	)) {
		const link = linkOf(entry.identity);
		const id = referenceEntryId(entry.identity);
		if (entry.role === "location") {
			const absorbed = absorbedLocations.find((location) =>
				collides(location, new Set([normalizedReferenceLabel(entry.label)])),
			);
			const carried = derivedById.get(id);
			locations.push({
				id,
				label: entry.label,
				descriptors: unique([
					...(carried?.descriptors ?? []),
					...(absorbed?.descriptors ?? []),
					entry.description ?? "",
				]),
				...link,
			});
			continue;
		}
		const absorbed = absorbedSubjects.find((subject) =>
			collides(
				subject,
				new Set([
					normalizedReferenceLabel(entry.label),
					...(entry.aliases ?? []).map(normalizedReferenceLabel),
				]),
			),
		);
		const carried = derivedById.get(id);
		subjects.push({
			id,
			label: entry.label,
			aliases: unique([
				...(carried?.aliases ?? []),
				...(absorbed?.aliases ?? []),
				...(entry.aliases ?? []),
			]),
			descriptors: unique([
				...(carried?.descriptors ?? []),
				...(absorbed?.descriptors ?? []),
				entry.description ?? "",
			]),
			mustAvoid: unique([...(carried?.mustAvoid ?? []), ...(absorbed?.mustAvoid ?? [])]),
			...link,
		});
	}
	return storyBibleSchema.parse({
		...bible,
		subjects: [
			...priorSubjects.filter((subject) => !absorbedSubjects.includes(subject)),
			...subjects,
		],
		locations: [
			...priorLocations.filter((location) => !absorbedLocations.includes(location)),
			...locations,
		],
	});
}
