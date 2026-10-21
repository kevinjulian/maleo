/* What each view of a `reference_entity` row includes, pinned per row shape.
 *
 * Three decodes of one row existed across two packages: `toReferenceEntityWire`
 * here, and `projectRoster` + `projectCast` in `agent/visual-gen.ts`. Measuring
 * them against the same rows is what showed the divergence is not a bug but two
 * unnamed questions:
 *
 *                        style   imageless   invalid role
 *   wire                  kept     kept         kept
 *   castable subjects   DROPPED   dropped     unreachable
 *   resolution set       KEPT     dropped     unreachable
 *
 * "Invalid role" is unreachable because `unified-schema.ts:702` constrains the
 * column to exactly the five values `ROLES` declares, so `roleOf` cannot reject a
 * row that came from the table.
 *
 * These fixtures are rows, not a database: the rules under test are decode rules,
 * and needing SQLite to reach them was itself part of the problem. */
import { describe, expect, test } from "bun:test";
import type { ProjectReferenceRow } from "@maleo/db/references";
import { ROLES } from "@maleo/shared";
import { castableSubjects, resolutionSet, toReferenceEntityWire } from "./reference-entity.ts";

export function row(over: Partial<ProjectReferenceRow> = {}): ProjectReferenceRow {
	return {
		id: "anna",
		workspace: "default",
		role: "character",
		label: "Anna",
		description: "a woman in a red coat",
		canonical_image_url: "/uploads/anna.png",
		tags_json: null,
		origin: "linked",
		created_at: 1,
		updated_at: 1,
		selection_id: "sel-anna",
		project_id: "project-1",
		scene_key: null,
		is_primary: 0,
		selected_at: 1,
		...over,
	};
}

export const FIXTURES = {
	castable: row(),
	primary: row({ id: "lead", label: "Lead", is_primary: 1 }),
	style: row({ id: "look", role: "style", label: "Look" }),
	imageless: row({ id: "ghost", label: "Ghost", canonical_image_url: null }),
	styleImageless: row({ id: "bare-look", role: "style", canonical_image_url: null }),
};

describe("the wire view keeps every attached entity", () => {
	test("a style entity crosses to the editor", () => {
		expect(toReferenceEntityWire(FIXTURES.style).role).toBe("style");
	});

	test("an entity with no image crosses with a null imageUrl", () => {
		expect(toReferenceEntityWire(FIXTURES.imageless).imageUrl).toBeNull();
	});

	test("the row's database shape stops here", () => {
		const wire = toReferenceEntityWire(FIXTURES.primary);

		expect(wire.primary).toBe(true);
		expect(wire).not.toHaveProperty("is_primary");
		expect(wire).not.toHaveProperty("canonical_image_url");
		expect(wire).not.toHaveProperty("tags_json");
		expect(wire).not.toHaveProperty("selection_id");
	});

	test("tags fall back to the role when the column is null or unparseable", () => {
		expect(toReferenceEntityWire(row({ tags_json: null })).tags).toEqual(["character"]);
		expect(toReferenceEntityWire(row({ tags_json: "{ not json" })).tags).toEqual(["character"]);
		expect(toReferenceEntityWire(row({ tags_json: '["hero"]' })).tags).toEqual(["hero"]);
	});
});

describe("the role vocabulary has one owner", () => {
	/* This is what makes the `roleOf` rejection in `projectCast` dead code: the
	 * column cannot hold a value outside `ROLES`, so no row from the table can
	 * fail to resolve. If this ever fails, that branch has to come back. */
	test("the schema CHECK and ROLES declare the same five values", async () => {
		const schema = await Bun.file(
			new URL("../../../../../packages/db/src/db/unified-schema.ts", import.meta.url).pathname,
		).text();
		const check = schema.match(/role TEXT NOT NULL CHECK \(role IN \(([^)]+)\)\)/);
		expect(check).not.toBeNull();

		const constrained = check![1]!
			.split(",")
			.map((v) => v.trim().replace(/'/g, ""))
			.sort();
		expect(constrained).toEqual([...ROLES].sort());
	});
});

describe("the generation views answer different questions", () => {
	const rows = [
		FIXTURES.castable,
		FIXTURES.primary,
		FIXTURES.style,
		FIXTURES.imageless,
		FIXTURES.styleImageless,
	];

	test("castable subjects exclude style and imageless entities", () => {
		expect(castableSubjects(rows).map((s) => s.id)).toEqual(["anna", "lead"]);
	});

	test("the resolution set keeps style but still excludes imageless entities", () => {
		expect(resolutionSet(rows).map((e) => e.id)).toEqual(["anna", "lead", "look"]);
	});

	test("the two disagree only about style, and deliberately", () => {
		const castable = new Set(castableSubjects(rows).map((s) => s.id));
		const resolution = new Set(resolutionSet(rows).map((e) => e.id));
		const onlyInResolution = [...resolution].filter((id) => !castable.has(id));

		expect(onlyInResolution).toEqual(["look"]);
		expect([...castable].filter((id) => !resolution.has(id))).toEqual([]);
	});

	test("a subject with no label falls back to its id, so the reference map never names nothing", () => {
		expect(castableSubjects([row({ id: "nameless", label: "" })])[0]!.label).toBe("nameless");
	});

	test("the resolution set carries the lead subject through", () => {
		expect(resolutionSet(rows).find((e) => e.id === "lead")!.primary).toBe(true);
		expect(resolutionSet(rows).find((e) => e.id === "anna")!.primary).toBe(false);
	});

	test("a duplicate attachment contributes one entity", () => {
		expect(resolutionSet([FIXTURES.castable, FIXTURES.castable]).map((e) => e.id)).toEqual([
			"anna",
		]);
	});
});
