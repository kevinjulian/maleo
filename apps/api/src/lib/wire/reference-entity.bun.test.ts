/* The database's vocabulary stops at this adapter. */
import { describe, expect, test } from "bun:test";
import type { ProjectReferenceRow } from "@maleo/db/references";
import { toReferenceEntityWire, toReferenceEntityWires } from "./reference-entity.ts";

const row = (over: Partial<ProjectReferenceRow> = {}): ProjectReferenceRow =>
	({
		id: "anna",
		workspace: "acme",
		role: "character",
		label: "Anna",
		description: "a woman in a red coat",
		canonical_image_url: "/api/image-gen/files/anna.png",
		tags_json: '["character","hero"]',
		origin: "linked",
		created_at: 1,
		updated_at: 1,
		selection_id: "sel-1",
		project_id: "p1",
		scene_key: null,
		is_primary: 0,
		selected_at: 1,
		...over,
	}) as ProjectReferenceRow;

describe("toReferenceEntityWire", () => {
	test("turns the row's storage shape into a domain object", () => {
		const wire = toReferenceEntityWire(row());
		expect(wire).toEqual({
			id: "anna",
			role: "character",
			label: "Anna",
			description: "a woman in a red coat",
			imageUrl: "/api/image-gen/files/anna.png",
			tags: ["character", "hero"],
			primary: false,
			origin: "linked",
		});
	});

	test("the lead-subject flag crosses as a boolean, not 0/1", () => {
		expect(toReferenceEntityWire(row({ is_primary: 1 })).primary).toBe(true);
		expect(toReferenceEntityWire(row({ is_primary: 0 })).primary).toBe(false);
	});

	test("an entity whose portrait never generated has no image", () => {
		expect(toReferenceEntityWire(row({ canonical_image_url: null })).imageUrl).toBeNull();
	});

	test("tags fall back to the role when absent or unparseable", () => {
		expect(toReferenceEntityWire(row({ tags_json: null })).tags).toEqual(["character"]);
		expect(toReferenceEntityWire(row({ tags_json: "{not json" })).tags).toEqual(["character"]);
		expect(toReferenceEntityWire(row({ tags_json: "[]" })).tags).toEqual(["character"]);
	});

	test("origin is narrowed to the two values the client branches on", () => {
		expect(toReferenceEntityWire(row({ origin: "generated" })).origin).toBe("generated");
		expect(toReferenceEntityWire(row({ origin: "whatever" as never })).origin).toBe("linked");
	});

	test("maps a list in order", () => {
		const wires = toReferenceEntityWires([row({ id: "a" }), row({ id: "b" })]);
		expect(wires.map((w) => w.id)).toEqual(["a", "b"]);
	});
});
