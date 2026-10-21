/* Roster-size cast defaulting — previously specified but NOT implemented.
 *
 * generation-cast-selection's "Roster-size cast defaulting" is a normative SHALL:
 * roster 0 attaches nothing, roster 1 auto-casts its single entity into every
 * scene, roster >= 2 uses the declared cast with a designated primary backfilling
 * an empty one.
 *
 * The live path (`resolveRefImages`) implemented none of it: a project with
 * exactly one character got no reference on any scene the planner left untagged.
 * `selectCast` encoded the rule but had zero production callers. These tests pin
 * the behavior now that it is wired, and cover the cap interaction that a naive
 * wiring gets wrong. */
import { describe, expect, it } from "vite-plus/test";
import {
	capCastSubjects,
	DEFAULT_CAST_SUBJECT_CAP,
	selectCast,
	type CastEntity,
} from "../../../shared/src/generation-cast.ts";

function entity(id: string, role: CastEntity["role"], primary = false): CastEntity {
	return {
		id,
		role,
		imageUrl: `/api/image-gen/files/${id}.png`,
		description: `${id} description`,
		primary,
	};
}

describe("roster size 0", () => {
	it("attaches nothing regardless of what the planner declared", () => {
		expect(selectCast([], [])).toEqual([]);
		expect(selectCast(["anything"], [])).toEqual([]);
	});
});

describe("roster size 1 — auto-cast", () => {
	it("casts the single entity into a scene the planner left untagged", () => {
		const roster = [entity("anna", "character")];
		expect(selectCast([], roster)).toEqual(["anna"]);
	});

	it("casts it even when the planner declared an unknown id", () => {
		const roster = [entity("anna", "character")];
		expect(selectCast(["hallucinated"], roster)).toEqual(["anna"]);
	});

	it("auto-casts a non-subject entity too", () => {
		const roster = [entity("cafe", "location")];
		expect(selectCast([], roster)).toEqual(["cafe"]);
	});
});

describe("roster size >= 2 — declared cast, primary backfill", () => {
	const roster = [
		entity("anna", "character", true),
		entity("bob", "character"),
		entity("cafe", "location"),
	];

	it("honours the declared cast in order", () => {
		expect(selectCast(["bob", "cafe"], roster)).toEqual(["bob", "cafe"]);
	});

	it("backfills the primary when the cast is empty", () => {
		expect(selectCast([], roster)).toEqual(["anna"]);
	});

	it("backfills the primary when every declared id is unknown", () => {
		expect(selectCast(["ghost", "phantom"], roster)).toEqual(["anna"]);
	});

	it("drops unknown ids but keeps known ones without backfilling", () => {
		expect(selectCast(["bob", "ghost"], roster)).toEqual(["bob"]);
	});

	it("de-duplicates a repeated declared id", () => {
		expect(selectCast(["bob", "bob", "cafe"], roster)).toEqual(["bob", "cafe"]);
	});

	it("attaches nothing when the cast is empty and no primary is designated", () => {
		const noPrimary = [entity("anna", "character"), entity("bob", "character")];
		expect(selectCast([], noPrimary)).toEqual([]);
	});
});

describe("subject cap interaction", () => {
	it("caps subjects at the default and keeps a trailing location", () => {
		const refs = [
			{ role: "character", id: "a" },
			{ role: "character", id: "b" },
			{ role: "character", id: "c" },
			{ role: "character", id: "d" },
			{ role: "location", id: "env" },
		];
		const capped = capCastSubjects(refs);
		expect(capped.map((r) => r.id)).toEqual(["a", "b", "c", "env"]);
	});

	it("does not let a full subject quota block later non-subjects", () => {
		// The regression a naive wiring introduces: breaking on total length instead
		// of continuing past an over-quota subject truncates the location ref.
		const refs = [
			{ role: "character", id: "a" },
			{ role: "character", id: "b" },
			{ role: "character", id: "c" },
			{ role: "character", id: "d" },
			{ role: "location", id: "env" },
			{ role: "style", id: "look" },
			{ role: "prop", id: "mug" },
		];
		const capped = capCastSubjects(refs);
		expect(capped.map((r) => r.id)).toEqual(["a", "b", "c", "env", "look", "mug"]);
	});

	it("keeps the primary subject when trimming over the cap", () => {
		const refs = [
			{ role: "character", id: "a" },
			{ role: "character", id: "b" },
			{ role: "character", id: "c" },
			{ role: "character", id: "lead", primary: true },
		];
		const capped = capCastSubjects(refs);
		expect(capped.map((r) => r.id)).toContain("lead");
	});

	it("never caps prop, location, or style however many there are", () => {
		const refs = [
			{ role: "prop", id: "p1" },
			{ role: "prop", id: "p2" },
			{ role: "prop", id: "p3" },
			{ role: "location", id: "e1" },
			{ role: "location", id: "e2" },
			{ role: "style", id: "s1" },
		];
		expect(capCastSubjects(refs)).toHaveLength(6);
	});

	it("uses the documented default cap", () => {
		const subjects = Array.from({ length: 10 }, (_, i) => ({ role: "character", id: `c${i}` }));
		expect(capCastSubjects(subjects)).toHaveLength(DEFAULT_CAST_SUBJECT_CAP);
	});
});
