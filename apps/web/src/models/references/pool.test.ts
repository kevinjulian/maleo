import { describe, expect, test } from "vite-plus/test";
import type { RefImage } from "@maleo/shared";
import { mergePool, removeFromPool, rosterOf, unresolvedSelections, upsertPool } from "./pool.ts";

const ref = (id: string, extra: Partial<RefImage> = {}): RefImage => ({
	id,
	label: id,
	seed: 1,
	...extra,
});

describe("mergePool", () => {
	/* Pins the precedence the two-store merge had: `mergeReferenceImages` spread
	 * the project's copy over the workspace copy, so the project's fields won. */
	test("the project's copy of an entity wins over the workspace copy", () => {
		const workspace = [ref("anna", { label: "Anna (library)", description: "stale" })];
		const pool = mergePool(
			workspace,
			[ref("anna", { label: "Anna", description: "a woman in a red coat" })],
			{
				inRoster: true,
			},
		);
		expect(pool).toHaveLength(1);
		expect(pool[0]!.label).toBe("Anna");
		expect(pool[0]!.description).toBe("a woman in a red coat");
	});

	/* The old merge spread the project entry over the library entry, so a field the
	 * project copy does not carry (an entity loaded without its image url) kept the
	 * library's value rather than being blanked. */
	test("a field the incoming copy omits keeps the value already in the pool", () => {
		const pool = mergePool(
			[ref("anna", { imageUrl: "/uploads/anna.png", label: "Library label" })],
			[ref("anna", { label: "Override label" })],
			{
				inRoster: true,
			},
		);
		expect(pool[0]!.label).toBe("Override label");
		expect(pool[0]!.imageUrl).toBe("/uploads/anna.png");
	});

	test("a late workspace catalogue does not clobber the project's copy", () => {
		const pool = mergePool(
			[ref("anna", { description: "a woman in a red coat", inRoster: true })],
			[ref("anna", { description: "" })],
			{
				mode: "fill",
			},
		);
		expect(pool[0]!.description).toBe("a woman in a red coat");
	});

	test("fill still adds entities the pool has not seen", () => {
		const pool = mergePool([ref("anna")], [ref("bob")], { mode: "fill" });
		expect(pool.map((r) => r.id)).toEqual(["anna", "bob"]);
	});

	test("keeps pool order and appends new entities", () => {
		const pool = mergePool([ref("anna"), ref("bob")], [ref("bob", { label: "Bob!" }), ref("cafe")]);
		expect(pool.map((r) => r.id)).toEqual(["anna", "bob", "cafe"]);
		expect(pool[1]!.label).toBe("Bob!");
	});

	test("roster attachment is sticky across later merges", () => {
		const attached = mergePool([], [ref("anna")], { inRoster: true });
		const afterCatalogue = mergePool(attached, [ref("anna", { label: "Anna (library)" })], {
			mode: "fill",
		});
		expect(rosterOf(afterCatalogue).map((r) => r.id)).toEqual(["anna"]);
	});

	test("workspace entities stay out of the roster", () => {
		const pool = mergePool([], [ref("anna"), ref("bob")], { mode: "fill" });
		expect(rosterOf(pool)).toEqual([]);
	});

	test("merging nothing leaves the pool identical", () => {
		const current = [ref("anna")];
		expect(mergePool(current, [])).toBe(current);
	});

	test("does not mutate the pool it was given", () => {
		const current = [ref("anna", { label: "Anna" })];
		mergePool(current, [ref("anna", { label: "changed" })], { inRoster: true });
		expect(current[0]!.label).toBe("Anna");
		expect(current[0]!.inRoster).toBeUndefined();
	});
});

describe("upsertPool", () => {
	test("replaces in place, keeping position", () => {
		const pool = upsertPool([ref("anna"), ref("bob")], ref("anna", { label: "Anna!" }));
		expect(pool.map((r) => r.id)).toEqual(["anna", "bob"]);
		expect(pool[0]!.label).toBe("Anna!");
	});

	test("appends an entity the pool lacks", () => {
		expect(upsertPool([ref("anna")], ref("cafe")).map((r) => r.id)).toEqual(["anna", "cafe"]);
	});

	test("keeps roster attachment when editing an attached entity", () => {
		const pool = upsertPool([ref("anna", { inRoster: true })], ref("anna", { label: "Anna!" }));
		expect(pool[0]!.inRoster).toBe(true);
	});
});

describe("removeFromPool", () => {
	test("drops the entity", () => {
		expect(removeFromPool([ref("anna"), ref("bob")], "anna").map((r) => r.id)).toEqual(["bob"]);
	});
});

/* `reference_entity` carries legacy duplicates — the persona-era project creation
 * minted a fresh uuid for the same collection item on each new project, so one
 * picture is up to seven rows with seven ids. The catalogue collapses them, but
 * the project's roster copy arrives from a separate read and may be a DIFFERENT
 * one of those rows, so id equality cannot recognise it as already present. */
describe("mergePool collapses legacy duplicate rows", () => {
	const PIC = "/api/personas/anjing/sheets/sheet-1.png";
	const dup = (id: string, extra: Partial<RefImage> = {}): RefImage =>
		ref(id, { label: "Anjing", role: "character", imageUrl: PIC, ...extra });

	test("a roster copy under a different id does not become a second card", () => {
		const pool = mergePool([dup("catalogue-copy")], [dup("roster-copy")], { inRoster: true });

		expect(pool).toHaveLength(1);
	});

	test("the roster copy wins the identity, so the document's selection resolves", () => {
		// The project selects by the id it attached. Surviving under the catalogue's
		// id would leave that selection pointing at no pool entry, and the surface
		// would call an attached reference unresolved.
		const pool = mergePool([dup("catalogue-copy")], [dup("roster-copy")], { inRoster: true });

		expect(pool[0]!.id).toBe("roster-copy");
		expect(pool[0]!.inRoster).toBe(true);
	});

	test("the collapsed card keeps its position in the list", () => {
		const pool = mergePool(
			[
				ref("first", { imageUrl: "/a.png" }),
				dup("catalogue-copy"),
				ref("last", { imageUrl: "/b.png" }),
			],
			[dup("roster-copy")],
			{ inRoster: true },
		);

		expect(pool.map((r) => r.id)).toEqual(["first", "roster-copy", "last"]);
	});

	test("a non-roster duplicate folds in without claiming the identity", () => {
		const pool = mergePool([dup("roster-copy", { inRoster: true })], [dup("catalogue-copy")], {
			mode: "fill",
		});

		expect(pool).toHaveLength(1);
		expect(pool[0]!.id).toBe("roster-copy");
		expect(pool[0]!.inRoster).toBe(true);
	});

	test("a different picture under the same label stays a separate card", () => {
		const pool = mergePool([dup("a")], [dup("b", { imageUrl: "/elsewhere.png" })], {
			inRoster: true,
		});

		expect(pool).toHaveLength(2);
	});

	test("entries with no image url are never collapsed together", () => {
		const pool = mergePool(
			[ref("no-pic-a", { label: "Same" })],
			[ref("no-pic-b", { label: "Same" })],
			{ inRoster: true },
		);

		expect(pool.map((r) => r.id)).toEqual(["no-pic-a", "no-pic-b"]);
	});
});

/* The collapse must not make an attached reference look broken.
 *
 * `unresolvedSelections` drives a "will not render" banner and the generation
 * preflight blocks on the same set. A selection naming the project's own roster
 * copy has to keep resolving through the collapsed card, or the surface reports
 * a reference that is attached and renders perfectly well. */
describe("collapsing duplicates does not strand a selection", () => {
	const PIC = "/api/personas/anjing/sheets/sheet-1.png";
	const dup = (id: string, extra: Partial<RefImage> = {}): RefImage =>
		ref(id, { label: "Anjing", role: "character", imageUrl: PIC, ...extra });

	test("a selection naming the roster copy resolves after the collapse", () => {
		const pool = mergePool([dup("catalogue-copy")], [dup("roster-copy")], { inRoster: true });

		expect(unresolvedSelections(pool, ["roster-copy"])).toEqual([]);
	});

	test("a selection naming a duplicate the project never attached is still reported", () => {
		// Genuine drift: the document locks one row, the roster holds another. The
		// preflight blocks on this, so the surface must say so rather than hide it
		// behind a card that happens to show the same picture.
		const pool = mergePool([dup("catalogue-copy")], [dup("roster-copy")], { inRoster: true });

		expect(unresolvedSelections(pool, ["some-other-copy"])).toEqual([
			{ id: "some-other-copy", label: "some-other-copy", reason: "missing" },
		]);
	});
});
