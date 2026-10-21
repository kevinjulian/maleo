/* Reusable material records. Points MALEO_DB_PATH at a throwaway file so the
 * shared maleo.db is never touched. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createContentMaterial,
	deleteContentMaterial,
	getContentMaterial,
	getContentMaterials,
	listContentMaterials,
	updateContentMaterial,
} from "./content-materials.ts";
import { closeMaleoDb, openDb } from "./connection.ts";

const tmpDir = mkdtempSync(join(tmpdir(), "content-materials-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

const WS = "acme";
const OTHER = "globex";

/** A material input with everything defaulted, so tests name only what they mean. */
function input(over: Partial<Parameters<typeof createContentMaterial>[0]> = {}) {
	return { name: "M", description: "", group: "visual" as const, body: "", assetIds: [], ...over };
}

beforeEach(async () => {
	await openDb().run("DELETE FROM content_materials");
});

afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("create and read", () => {
	test("round-trips every field, including the owning workspace", async () => {
		const created = await createContentMaterial(
			input({
				name: "House visual",
				description: "brand look",
				group: "visual",
				body: "stickman on white",
				assetIds: ["e1", "e2"],
			}),
			WS,
		);
		expect(await getContentMaterial(created.id, WS)).toEqual(created);
		expect(created.workspace).toBe(WS);
		expect(created.group).toBe("visual");
		expect(created.assetIds).toEqual(["e1", "e2"]);
	});

	test("defaults description, body and assets", async () => {
		const created = await createContentMaterial({ name: "Rules", group: "rules" } as never, WS);
		expect(created.description).toBe("");
		expect(created.body).toBe("");
		expect(created.assetIds).toEqual([]);
	});

	test("rejects a nameless material", () => {
		expect(() => createContentMaterial(input({ name: "  " }), WS)).toThrow();
	});

	test("rejects an unknown group", () => {
		expect(() => createContentMaterial({ name: "x", group: "style" } as never, WS)).toThrow();
	});

	test("a missing id reads as null, not a throw", async () => {
		expect(await getContentMaterial("nope", WS)).toBeNull();
	});

	/* The body cannot carry a workspace — the input schema is strict and has no such
	 * field — so a cross-tenant write cannot be arranged by sending different JSON. */
	test("a workspace in the input is rejected rather than honoured", () => {
		expect(() =>
			createContentMaterial({ name: "x", group: "story", workspace: OTHER } as never, WS),
		).toThrow();
	});
});

describe("list", () => {
	test("filters by group within the workspace", async () => {
		await createContentMaterial(input({ name: "V", group: "visual" }), WS);
		await createContentMaterial(input({ name: "S", group: "story" }), WS);
		expect((await listContentMaterials(WS, "visual")).map((m) => m.name)).toEqual(["V"]);
		expect((await listContentMaterials(WS)).length).toBe(2);
	});
});

/* A material is operator writing — a brief, a look, a set of constraints — which
 * is exactly the content one tenant must never see from another. Every read and
 * write is asserted against a second workspace, because a single missing WHERE
 * clause is the whole bug and it is invisible in a single-tenant test. */
describe("workspace isolation", () => {
	test("a list never returns another workspace's materials", async () => {
		await createContentMaterial(input({ name: "Mine" }), WS);
		await createContentMaterial(input({ name: "Theirs" }), OTHER);
		expect((await listContentMaterials(WS)).map((m) => m.name)).toEqual(["Mine"]);
		expect((await listContentMaterials(OTHER)).map((m) => m.name)).toEqual(["Theirs"]);
	});

	test("a group-filtered list is scoped too", async () => {
		await createContentMaterial(input({ name: "Mine", group: "story" }), WS);
		await createContentMaterial(input({ name: "Theirs", group: "story" }), OTHER);
		expect((await listContentMaterials(OTHER, "story")).map((m) => m.name)).toEqual(["Theirs"]);
	});

	/* Reading by id takes the workspace as part of the LOOKUP rather than checking
	 * it after. A fetch-then-compare leaks existence: the caller can tell "no such
	 * material" from "not yours" by which branch it lands in. */
	test("another workspace's material reads as absent, not as forbidden", async () => {
		const theirs = await createContentMaterial(input({ name: "Theirs" }), OTHER);
		expect(await getContentMaterial(theirs.id, WS)).toBeNull();
		expect(await getContentMaterial(theirs.id, OTHER)).not.toBeNull();
	});

	test("a bulk resolve skips ids belonging to another workspace", async () => {
		const mine = await createContentMaterial(input({ name: "Mine" }), WS);
		const theirs = await createContentMaterial(input({ name: "Theirs" }), OTHER);
		expect((await getContentMaterials([mine.id, theirs.id], WS)).map((m) => m.name)).toEqual([
			"Mine",
		]);
	});

	test("an update cannot reach across workspaces", async () => {
		const theirs = await createContentMaterial(input({ name: "Theirs", body: "original" }), OTHER);
		expect(
			await updateContentMaterial(theirs.id, input({ name: "Hijacked", body: "rewritten" }), WS),
		).toBeNull();
		expect((await getContentMaterial(theirs.id, OTHER))?.body).toBe("original");
	});

	test("a delete cannot reach across workspaces", async () => {
		const theirs = await createContentMaterial(input({ name: "Theirs" }), OTHER);
		expect(await deleteContentMaterial(theirs.id, WS)).toBe(false);
		expect(await getContentMaterial(theirs.id, OTHER)).not.toBeNull();
	});

	test("the same name in two workspaces is two independent rows", async () => {
		const mine = await createContentMaterial(input({ name: "House" }), WS);
		const theirs = await createContentMaterial(input({ name: "House" }), OTHER);
		expect(mine.id).not.toBe(theirs.id);
		expect((await listContentMaterials(WS)).length).toBe(1);
	});
});

describe("getContentMaterials", () => {
	test("keeps the requested order rather than row order", async () => {
		const a = await createContentMaterial(input({ name: "A", group: "story" }), WS);
		const b = await createContentMaterial(input({ name: "B", group: "visual" }), WS);
		expect((await getContentMaterials([b.id, a.id], WS)).map((m) => m.name)).toEqual(["B", "A"]);
	});

	test("a deleted material is skipped rather than failing the whole resolve", async () => {
		const a = await createContentMaterial(input({ name: "A", group: "story" }), WS);
		expect((await getContentMaterials([a.id, "gone"], WS)).map((m) => m.name)).toEqual(["A"]);
	});

	test("resolving nothing touches no rows", async () => {
		expect(await getContentMaterials([], WS)).toEqual([]);
	});
});

describe("update and delete", () => {
	test("update replaces the value and bumps updated_at", async () => {
		const created = await createContentMaterial(input({ name: "V", body: "old" }), WS);
		const updated = await updateContentMaterial(
			created.id,
			input({ name: "V2", description: "d", body: "new", assetIds: ["e1"] }),
			WS,
		);
		expect(updated?.name).toBe("V2");
		expect(updated?.body).toBe("new");
		expect(updated?.assetIds).toEqual(["e1"]);
		expect(updated!.updatedAt).toBeGreaterThanOrEqual(created.updatedAt);
	});

	test("updating a missing id reads as null rather than creating one", async () => {
		expect(
			await updateContentMaterial("nope", input({ name: "x", group: "story" }), WS),
		).toBeNull();
		expect((await listContentMaterials(WS)).length).toBe(0);
	});

	test("an update cannot move a row to another workspace", async () => {
		const created = await createContentMaterial(input({ name: "V" }), WS);
		await updateContentMaterial(created.id, input({ name: "V2" }), WS);
		expect((await getContentMaterial(created.id, WS))?.workspace).toBe(WS);
	});

	test("delete reports whether a row went", async () => {
		const created = await createContentMaterial(input({ name: "V" }), WS);
		expect(await deleteContentMaterial(created.id, WS)).toBe(true);
		expect(await deleteContentMaterial(created.id, WS)).toBe(false);
	});
});

describe("rows written by hand or by an older build", () => {
	async function insertRaw(
		id: string,
		group: string,
		assetIds: string,
		workspace = WS,
	): Promise<void> {
		const now = Date.now();
		await openDb().run(
			`INSERT INTO content_materials (id, workspace, name, description, material_group, body, asset_ids_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			[id, workspace, "Row", "", group, "text", assetIds, now, now],
		);
	}

	test("an unrecognised group reads as story rather than vanishing", async () => {
		await insertRaw("m_odd", "style", "[]");
		expect((await getContentMaterial("m_odd", WS))?.group).toBe("story");
	});

	test("unparseable asset ids read as none rather than throwing", async () => {
		await insertRaw("m_bad", "visual", "not json");
		expect((await getContentMaterial("m_bad", WS))?.assetIds).toEqual([]);
	});

	test("non-string asset ids are dropped", async () => {
		await insertRaw("m_mixed", "visual", '["e1", 7, "", null]');
		expect((await getContentMaterial("m_mixed", WS))?.assetIds).toEqual(["e1"]);
	});

	/* A database that predates the column gets it via reconcileColumns with the
	 * schema default, so pre-existing rows land in the default workspace rather
	 * than becoming invisible to every tenant. */
	test("a row inserted without a workspace lands in the default one", async () => {
		const now = Date.now();
		await openDb().run(
			`INSERT INTO content_materials (id, name, description, material_group, body, asset_ids_json, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			["m_legacy", "Legacy", "", "story", "text", "[]", now, now],
		);
		expect((await getContentMaterial("m_legacy", "default"))?.workspace).toBe("default");
	});
});
