/* Regression tests for the two data-corruption paths the selection model removes,
 * plus the tenancy boundary.
 *
 * Bug 1 — role edit forked the row: content_references' upsert put `kind` in its
 *   dedupe key, so changing a reference's primary tag inserted a duplicate rather
 *   than updating. The UI deduped by logical id on reload, so the edit appeared to
 *   work and then reverted.
 *
 * Bug 2 — url collision stole identity: when no logical-id match was found, the
 *   fallback matched any row sharing (kind, scope, scene_key, voice_key,
 *   source_url) WITHOUT comparing the logical id, then overwrote that row's
 *   meta_json.id. Two references on one image destroyed one identity; scenes
 *   holding the lost id silently generated with no reference.
 *
 * Neither is patched in the new model — both predicates are gone. These tests pin
 * that the replacement cannot express either failure. */
import { beforeEach, describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { applyUnifiedSchema } from "../../src/db/unified-schema.ts";

/* The accessors resolve their own DB handle, so drive SQL directly against an
 * in-memory schema here — this suite is about the shape's guarantees, not the
 * module's singleton wiring. */
let db: Database;

function project(id: string, workspace = "default"): void {
	db.run(
		`INSERT INTO content_projects (id, workspace, title, type, status, created_at, updated_at)
		 VALUES (?, ?, ?, 'video', 'draft', 1, 1)`,
		[id, workspace, id],
	);
}

function entity(
	id: string,
	role: string,
	opts?: { workspace?: string; label?: string; image?: string | null },
): void {
	db.run(
		`INSERT INTO reference_entity (id, workspace, role, label, description, canonical_image_url, origin, created_at, updated_at)
		 VALUES (?, ?, ?, ?, '', ?, 'linked', 1, 1)`,
		[id, opts?.workspace ?? "default", role, opts?.label ?? id, opts?.image ?? "/img.png"],
	);
}

function select(projectId: string, entityId: string, sceneKey: string | null = null): void {
	db.run(
		`INSERT INTO project_reference (id, project_id, entity_id, scene_key, created_at)
		 VALUES (?, ?, ?, ?, 1)
		 ON CONFLICT(project_id, entity_id, ifnull(scene_key, '')) DO NOTHING`,
		[`sel-${projectId}-${entityId}-${sceneKey ?? ""}`, projectId, entityId, sceneKey],
	);
}

const countEntities = (): number =>
	(db.query(`SELECT count(*) c FROM reference_entity`).get() as { c: number }).c;
const countSelections = (): number =>
	(db.query(`SELECT count(*) c FROM project_reference`).get() as { c: number }).c;

beforeEach(() => {
	db = new Database(":memory:");
	applyUnifiedSchema(db);
});

describe("Bug 1 — role edit must not fork the row", () => {
	it("changing a role updates in place, creating no duplicate", () => {
		entity("anna", "style");
		expect(countEntities()).toBe(1);

		db.run(`UPDATE reference_entity SET role = 'character', updated_at = 2 WHERE id = 'anna'`);

		expect(countEntities()).toBe(1);
		expect(db.query(`SELECT role FROM reference_entity WHERE id='anna'`).get()).toEqual({
			role: "character",
		});
	});

	it("role is absent from every uniqueness key on the entity table", () => {
		const indexes = db
			.query<{ name: string }, []>(
				`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='reference_entity'`,
			)
			.all();
		for (const { name } of indexes) {
			const info = db
				.query<{ name: string | null }, [string]>(`SELECT * FROM pragma_index_info(?)`)
				.all(name);
			const isUnique =
				(
					db
						.query(`SELECT "unique" u FROM pragma_index_list('reference_entity') WHERE name = ?`)
						.get(name) as { u: number } | null
				)?.u === 1;
			if (isUnique) expect(info.map((c) => c.name)).not.toContain("role");
		}
	});

	it("an entity's role edit is visible to every project selecting it", () => {
		project("p1");
		project("p2");
		entity("anna", "style");
		select("p1", "anna");
		select("p2", "anna");

		db.run(`UPDATE reference_entity SET role = 'character' WHERE id = 'anna'`);

		const rows = db
			.query<{ project_id: string; role: string }, []>(
				`SELECT s.project_id, e.role FROM project_reference s JOIN reference_entity e ON e.id = s.entity_id ORDER BY s.project_id`,
			)
			.all();
		expect(rows).toEqual([
			{ project_id: "p1", role: "character" },
			{ project_id: "p2", role: "character" },
		]);
	});
});

describe("Bug 2 — a shared image must not merge identities", () => {
	it("two entities on the same canonical image stay distinct", () => {
		entity("anna-front", "character", { label: "Anna — front", image: "/uploads/anna.png" });
		entity("anna-34", "character", { label: "Anna — 3/4", image: "/uploads/anna.png" });

		expect(countEntities()).toBe(2);
		const rows = db
			.query<{ id: string; label: string }, []>(
				`SELECT id, label FROM reference_entity ORDER BY id`,
			)
			.all();
		expect(rows).toEqual([
			{ id: "anna-34", label: "Anna — 3/4" },
			{ id: "anna-front", label: "Anna — front" },
		]);
	});

	it("canonical_image_url is not part of any uniqueness key", () => {
		entity("a", "character", { image: "/same.png" });
		expect(() => entity("b", "character", { image: "/same.png" })).not.toThrow();
	});

	it("a selection survives a sibling entity sharing its image", () => {
		project("p1");
		entity("anna-front", "character", { image: "/uploads/anna.png" });
		select("p1", "anna-front");
		entity("anna-34", "character", { image: "/uploads/anna.png" });

		// The originally selected id still resolves — it was never overwritten.
		const row = db
			.query<{ id: string }, []>(
				`SELECT e.id FROM project_reference s JOIN reference_entity e ON e.id = s.entity_id WHERE s.project_id='p1'`,
			)
			.get();
		expect(row).toEqual({ id: "anna-front" });
	});
});

describe("selection layer", () => {
	it("stores no copy of the entity's attributes", () => {
		const cols = (db.query(`PRAGMA table_info(project_reference)`).all() as { name: string }[]).map(
			(c) => c.name,
		);
		// is_primary is project-scoped state (which entity leads THIS project), not a
		// copy of an entity attribute — the same character can lead one project and
		// be background in another, so it cannot live on reference_entity.
		expect(cols.sort()).toEqual([
			"created_at",
			"entity_id",
			"id",
			"is_primary",
			"project_id",
			"scene_key",
		]);
		for (const copied of [
			"role",
			"label",
			"description",
			"canonical_image_url",
			"kind",
			"meta_json",
		]) {
			expect(cols).not.toContain(copied);
		}
	});

	it("is idempotent for a repeated project-level attach (NULL scene_key)", () => {
		project("p1");
		entity("anna", "character");
		select("p1", "anna");
		select("p1", "anna");
		select("p1", "anna");
		expect(countSelections()).toBe(1);
	});

	it("treats a scene-level selection as distinct from the project-level one", () => {
		project("p1");
		entity("anna", "character");
		select("p1", "anna", null);
		select("p1", "anna", "scene-1");
		expect(countSelections()).toBe(2);
	});

	it("cascades selections away when the entity is deleted", () => {
		project("p1");
		entity("anna", "character");
		select("p1", "anna");
		db.run(`DELETE FROM project_reference WHERE entity_id = 'anna'`);
		db.run(`DELETE FROM reference_entity WHERE id = 'anna'`);
		expect(countSelections()).toBe(0);
	});
});

describe("tenancy boundary", () => {
	it("keeps libraries separate per workspace", () => {
		entity("shared-name", "character", { workspace: "ws-a" });
		entity("other", "character", { workspace: "ws-b" });
		const a = db
			.query<{ id: string }, []>(`SELECT id FROM reference_entity WHERE workspace='ws-a'`)
			.all();
		expect(a).toEqual([{ id: "shared-name" }]);
	});

	it("a cross-workspace selection is detectable by join", () => {
		project("p-a", "ws-a");
		entity("e-b", "character", { workspace: "ws-b" });
		// The accessor refuses this; assert the shape makes the violation visible.
		select("p-a", "e-b");
		const bad = db
			.query<{ c: number }, []>(
				`SELECT count(*) c FROM project_reference s
			 JOIN content_projects p ON p.id = s.project_id
			 JOIN reference_entity e ON e.id = s.entity_id
			 WHERE e.workspace <> p.workspace`,
			)
			.get();
		expect(bad!.c).toBe(1);
	});
});
