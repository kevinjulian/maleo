/* The content_assets reference mirror, after collapsing its source_type fanout.
 *
 * Five source_type values keyed the same logical ref under
 * UNIQUE(source_type, source_ref), so one reference could produce up to five rows.
 * Worse, origin was ENCODED in source_type ('generated_reference' vs 'reference'),
 * and source_type is half the unique key — so flipping a reference from linked to
 * generated changed the key, inserted a second row, and orphaned the first.
 *
 * Delete was a source_type rewrite to 'reference_deleted', so delete-then-re-add
 * left a tombstone plus a live row. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import {
	deleteContentAssetReference,
	listContentAssets,
	listSuppressedAssetRefs,
	suppressAssetRef,
	unsuppressAssetRef,
	upsertContentAsset,
} from "../../src/db/assets.ts";

let db: Db;
let t: TestDb;

async function mirror(
	logicalRef: string,
	origin: "linked" | "generated",
	label = "Anna",
): Promise<void> {
	await upsertContentAsset(
		{
			scope: "project",
			project_id: "p1",
			kind: "character",
			label,
			tags: ["character"],
			src: "/api/image-gen/files/anna.png",
			source_type: "reference",
			origin,
			source_ref: logicalRef,
			item_id: logicalRef,
			meta_json: { id: logicalRef },
		},
		db,
	);
}

const assetsFor = async (ref: string) =>
	(await listContentAssets({ limit: 100 }, db)).filter((a) => a.source_ref === ref);

describe("asset mirror", () => {
	beforeEach(async () => {
		t = await openTestDb("postgres");
		db = t.db;
	});

	it("flipping origin updates the row in place instead of orphaning it", async () => {
		await mirror("anna", "linked");
		expect(await assetsFor("anna")).toHaveLength(1);

		await mirror("anna", "generated");

		const rows = await assetsFor("anna");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.origin).toBe("generated");
	});

	it("flips back without fanning out", async () => {
		await mirror("anna", "generated");
		await mirror("anna", "linked");
		await mirror("anna", "generated");
		const rows = await assetsFor("anna");
		expect(rows).toHaveLength(1);
		expect(rows[0]?.origin).toBe("generated");
	});

	it("keeps origin out of source_type", async () => {
		await mirror("anna", "generated");
		expect((await assetsFor("anna"))[0]?.source_type).toBe("reference");
	});

	it("keeps distinct references distinct", async () => {
		await mirror("anna", "linked", "Anna");
		await mirror("bob", "linked", "Bob");
		expect(await assetsFor("anna")).toHaveLength(1);
		expect(await assetsFor("bob")).toHaveLength(1);
	});

	it("delete-then-recreate leaves exactly one row and no tombstone", async () => {
		await mirror("anna", "linked");
		await deleteContentAssetReference("anna", "default", db);
		expect(await assetsFor("anna")).toHaveLength(0);

		await mirror("anna", "linked");

		const rows = await assetsFor("anna");
		expect(rows).toHaveLength(1);
		// No fake row standing in for the deletion.
		expect(
			(await listContentAssets({ limit: 100 })).some((a) => a.src === "__deleted_reference__"),
		).toBe(false);
		expect(
			(await listContentAssets({ limit: 100 })).some((a) => a.source_type === "reference_deleted"),
		).toBe(false);
	});

	it("records suppression separately from the asset table", async () => {
		await mirror("anna", "linked");
		await deleteContentAssetReference("anna", "default", db);
		await suppressAssetRef("anna", "default", "deleted", db);

		expect((await listSuppressedAssetRefs("default", db)).has("anna")).toBe(true);
		// Suppression is not an asset.
		expect((await listContentAssets({ limit: 100 })).some((a) => a.source_ref === "anna")).toBe(
			false,
		);
	});

	it("suppression is idempotent", async () => {
		await suppressAssetRef("x", "default", "one", db);
		await suppressAssetRef("x", "default", "two", db);
		expect(
			[...(await listSuppressedAssetRefs("default", db))].filter((r) => r === "x"),
		).toHaveLength(1);
	});

	it("suppression can be lifted", async () => {
		await suppressAssetRef("x", "default", "lifted later", db);
		expect(await unsuppressAssetRef("x", "default", db)).toBe(true);
		expect((await listSuppressedAssetRefs("default", db)).has("x")).toBe(false);
	});

	it("defaults origin to linked when unspecified", async () => {
		await upsertContentAsset(
			{
				kind: "character",
				label: "No origin",
				src: "/api/image-gen/files/x.png",
				source_type: "reference",
				source_ref: "no-origin",
			},
			db,
		);
		expect((await assetsFor("no-origin"))[0]?.origin).toBe("linked");
	});
});
afterEach(() => t.close());
