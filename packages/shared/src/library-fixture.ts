/* Fixture identity for library records — Project Presets, Materials and Video
 * Templates.
 *
 * Two identities, doing different jobs:
 *
 *     id   = local relational identity inside ONE database
 *     slug = immutable logical identity, stable across every database
 *
 * Rows reference each other by id, because that is what a join wants and because a
 * preset bundle resolved through slugs on every read would pay for portability on
 * the hot path. The slug exists so shipped rows can be RE-shipped: bootstrap finds
 * a fixture by slug, updates it in place, and leaves its id — and therefore every
 * reference to it — alone. A fixture may hold a different id on two devices; it
 * holds the same slug on both.
 *
 * Fixtures are read-only. Editing one forks it into a user row, which is what keeps
 * "the operator wrote this" and "we shipped this" from ever being the same row.
 */
import { z } from "zod";

/* The workspace fixture rows live in.
 *
 * Materials are workspace-scoped; presets and templates are not. A global preset
 * bundle naming a workspace-scoped material id could only ever name ONE workspace's
 * copy, so fixtures cannot be copied per workspace — they are stored once, here, and
 * read alongside whichever workspace is asking.
 *
 * Empty rather than "shipped": no operator can create a workspace with this name, and
 * it reads as belonging to no workspace rather than to one that happens to be called
 * shipped. */
export const FIXTURE_WORKSPACE = "";

export const LIBRARY_ROW_SOURCES = ["fixture", "user"] as const;
export type LibraryRowSource = (typeof LIBRARY_ROW_SOURCES)[number];

/** Lowercase kebab. Authored by hand for fixtures, generated from the name for user
 *  rows, so the character set has to be the one a name survives being folded into. */
export const librarySlugSchema = z
	.string()
	.trim()
	.min(1)
	.max(120)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lowercase kebab-case");

/* The identity fields every library row carries, on the READ shape only.
 *
 * None of them are writable by a caller: a slug is assigned once and never changes,
 * and a client that could POST `source: "fixture"` could mint a row the fork rules
 * then refuse to let anyone edit.
 *
 * `slug` is nullable because rows written before slugs existed have none, and
 * inventing one on read would be a value that disagrees with the database. */
export const libraryFixtureFieldsSchema = z.object({
	slug: librarySlugSchema.nullable().default(null),
	source: z.enum(LIBRARY_ROW_SOURCES).default("user"),
	/** A fixture whose slug no longer ships. Still resolvable by id for the rows
	 *  that reference it; absent from every list and picker. */
	retired: z.boolean().default(false),
});

export interface LibraryFixtureFields {
	slug: string | null;
	source: LibraryRowSource;
	retired: boolean;
}

export function isFixtureRow(row: { source?: LibraryRowSource }): boolean {
	return row.source === "fixture";
}

/** Rows an operator may see: everything except a retired fixture. */
export function isListableRow(row: { source?: LibraryRowSource; retired?: boolean }): boolean {
	return !(row.retired ?? false);
}

/* Fixtures first, in authored order, then everything else.
 *
 * Fixture rows are rewritten from code on every bootstrap, so ordering them by
 * `updated_at` like user rows would reshuffle the library every time the app
 * started. The authored order is the order the fixture definitions are declared in,
 * which is why callers pass it rather than it being derived from the rows. */
export function compareLibraryRows<T extends { slug: string | null; source?: LibraryRowSource }>(
	authoredOrder: readonly string[],
): (a: T, b: T) => number {
	const rank = new Map(authoredOrder.map((slug, index) => [slug, index]));
	return (a, b) => {
		const aFixture = isFixtureRow(a);
		const bFixture = isFixtureRow(b);
		if (aFixture !== bFixture) return aFixture ? -1 : 1;
		if (!aFixture) return 0;
		return (
			(rank.get(a.slug ?? "") ?? Number.MAX_SAFE_INTEGER) -
			(rank.get(b.slug ?? "") ?? Number.MAX_SAFE_INTEGER)
		);
	};
}

/* Naming a fork.
 *
 * Forking the same fixture twice is ordinary — an operator tries two variations of
 * one shipped preset — so the second copy has to be tellable from the first. Names
 * are not unique keys and this does not make them one; the counter exists so the
 * list reads, not so the database can constrain it. */
export function forkCopyName(name: string, taken: Iterable<string> = []): string {
	const used = new Set(taken);
	const first = `${name} (copy)`;
	if (!used.has(first)) return first;
	for (let n = 2; ; n += 1) {
		const candidate = `${name} (copy ${n})`;
		if (!used.has(candidate)) return candidate;
	}
}

/** Fold a name into slug shape. Empty when the name has nothing a slug can carry —
 *  a name that is entirely punctuation or non-Latin script — which the caller
 *  resolves with its own fallback rather than this inventing one. */
export function slugifyName(name: string): string {
	return name
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 100)
		.replace(/-+$/g, "");
}

/** A slug for a user row, unique among the ones already taken in its scope. The
 *  fallback prefix covers a name that slugifies to nothing. */
export function generateUserSlug(
	name: string,
	taken: Iterable<string> = [],
	fallback = "item",
): string {
	const used = new Set(taken);
	const base = slugifyName(name) || fallback;
	if (!used.has(base)) return base;
	for (let n = 2; ; n += 1) {
		const candidate = `${base}-${n}`;
		if (!used.has(candidate)) return candidate;
	}
}
