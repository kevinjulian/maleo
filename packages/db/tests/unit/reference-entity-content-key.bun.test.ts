/* One row per reference, enforced where rows are written.
 *
 * `reference_entity` is unique on `id` alone and the upsert deduplicates only
 * ON CONFLICT(id), so a caller that mints a fresh id has always inserted — however
 * many rows already described the same picture. The persona-era project-creation
 * path did exactly that: one new entity per project for the same collection item,
 * leaving 46 redundant rows out of 89, seven of them "Anjing", six created in the
 * same minute as six different projects.
 *
 * That path is gone, but nothing stopped the next one. The accepted requirement
 * already said "a single `reference_entity` row" — these make it true rather than
 * merely stated. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import {
	findReferenceEntityByContent,
	listReferenceEntities,
	upsertReferenceEntity,
} from "@maleo/db/references";

const dbPath = join(tmpdir(), "maleo-reference-content-key.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

const WORKSPACE = "default";
const PICTURE = "/api/personas/anjing/collections/characters/items/96e31005/sheets/sheet-1.png";

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	openDb();
});

afterEach(async () => {
	await resetDb();
	// Restored, never deleted — see packages/db/tests/unit/test-db-guard-usage.test.ts.
	if (priorDbPath !== undefined) process.env.MALEO_DB_PATH = priorDbPath;
});

/** What the persona-era caller did: a fresh id every time, no lookup. */
function addWithMintedId(overrides: Partial<Parameters<typeof upsertReferenceEntity>[0]> = {}) {
	return upsertReferenceEntity({
		id: randomUUID(),
		workspace: WORKSPACE,
		role: "character",
		label: "Anjing",
		canonical_image_url: PICTURE,
		origin: "linked",
		...overrides,
	});
}

describe("a minted id does not fork the library", () => {
	test("a fresh id matching an existing entity by content reuses it", async () => {
		const first = await addWithMintedId();

		const second = await addWithMintedId();

		expect(second?.id).toBe(first!.id);
		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});

	test("the persona-era shape: seven projects adding the same reference leave one entity", async () => {
		// Concurrent, as seven agent runs would be: the dedupe must hold under a pool.
		const ids = await Promise.all(
			Array.from({ length: 7 }, async () => (await addWithMintedId())?.id),
		);

		expect(new Set(ids).size).toBe(1);
		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});

	test("the reused row takes the newer description, so the later caller is not ignored", async () => {
		await addWithMintedId({ description: "" });

		const updated = await addWithMintedId({ description: "a scruffy street dog" });

		expect(updated?.description).toBe("a scruffy street dog");
		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});

	test("matching ignores label case and surrounding whitespace", async () => {
		const first = await addWithMintedId({ label: "Anjing" });

		const second = await addWithMintedId({ label: "  anjing  " });

		expect(second?.id).toBe(first!.id);
		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});

	test("a different picture under the same label is a different entity", async () => {
		await addWithMintedId();

		await addWithMintedId({ canonical_image_url: "/uploads/somewhere-else.png" });

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(2);
	});

	test("the same picture under a different role is a different entity", async () => {
		await addWithMintedId({ role: "character" });

		await addWithMintedId({ role: "prop" });

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(2);
	});

	test("another workspace's identical reference is untouched", async () => {
		await addWithMintedId();

		await addWithMintedId({ workspace: "other-workspace" });

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
		expect(await listReferenceEntities("other-workspace")).toHaveLength(1);
	});
});

describe("an entity with no image has no content key", () => {
	test("two imageless entities sharing a role and label stay two entities", async () => {
		// An entity awaiting an image is not a duplicate of another awaiting one:
		// there is nothing to compare, so the id stands alone.
		await addWithMintedId({ canonical_image_url: null, label: "New Location", role: "location" });
		await addWithMintedId({ canonical_image_url: null, label: "New Location", role: "location" });

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(2);
	});

	test("an imageless entity is never matched against one that has an image", async () => {
		await addWithMintedId();

		await addWithMintedId({ canonical_image_url: null });

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(2);
	});
});

describe("an edit by id is an edit, not a merge", () => {
	test("renaming an entity onto another's content key updates only the named row", async () => {
		const anjing = await addWithMintedId({ label: "Anjing" });
		const kunti = await upsertReferenceEntity({
			id: "kunti-fixed",
			workspace: WORKSPACE,
			role: "character",
			label: "Kunti",
			canonical_image_url: PICTURE,
			origin: "linked",
		});

		// Same picture, same role — renaming to "Anjing" lands on anjing's content
		// key. Supplying an existing id means this is an edit and must stay one.
		const renamed = await upsertReferenceEntity({
			id: kunti!.id,
			workspace: WORKSPACE,
			role: "character",
			label: "Anjing",
			canonical_image_url: PICTURE,
			origin: "linked",
		});

		expect(renamed?.id).toBe("kunti-fixed");
		expect(renamed?.label).toBe("Anjing");
		expect((await listReferenceEntities(WORKSPACE)).map((e) => e.id).sort()).toEqual(
			[anjing!.id, "kunti-fixed"].sort(),
		);
	});

	test("editing an entity by its own id never redirects onto another row", async () => {
		const entity = await upsertReferenceEntity({
			id: "stable",
			workspace: WORKSPACE,
			role: "character",
			label: "Pria",
			canonical_image_url: "/uploads/pria.png",
			origin: "linked",
		});

		const edited = await upsertReferenceEntity({
			id: "stable",
			workspace: WORKSPACE,
			role: "character",
			label: "Pria Dewasa",
			canonical_image_url: "/uploads/pria.png",
			origin: "linked",
		});

		expect(edited?.id).toBe(entity!.id);
		expect(edited?.label).toBe("Pria Dewasa");
		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});
});

describe("findReferenceEntityByContent", () => {
	test("finds the entity a content key names", async () => {
		const created = await addWithMintedId();

		const found = await findReferenceEntityByContent({
			workspace: WORKSPACE,
			role: "character",
			label: "Anjing",
			canonical_image_url: PICTURE,
		});

		expect(found?.id).toBe(created!.id);
	});

	test("returns null when nothing matches", async () => {
		expect(
			await findReferenceEntityByContent({
				workspace: WORKSPACE,
				role: "character",
				label: "Nobody",
				canonical_image_url: PICTURE,
			}),
		).toBeNull();
	});

	test("returns null without an image url, which is not a content key", async () => {
		await addWithMintedId({ canonical_image_url: null });

		expect(
			await findReferenceEntityByContent({
				workspace: WORKSPACE,
				role: "character",
				label: "Anjing",
				canonical_image_url: null,
			}),
		).toBeNull();
	});

	test("returns the oldest match when the library already holds duplicates", async () => {
		/* Written straight to the table, because the guard above now refuses to
		 * produce this shape. It is what already sits in the database: rows minted
		 * before the content key existed, which are not removed because each is
		 * attached to some project's roster. The lookup still has to resolve
		 * deterministically over them. */
		for (const [id, created] of [
			["legacy-a", 10],
			["legacy-b", 5],
		] as const) {
			await openDb().run(
				`INSERT INTO reference_entity (id, workspace, role, label, description, canonical_image_url, origin, created_at, updated_at)
				 VALUES (?, ?, 'character', 'Anjing', '', ?, 'linked', ?, ?)`,
				[id, WORKSPACE, PICTURE, created, created],
			);
		}

		expect(
			(
				await findReferenceEntityByContent({
					workspace: WORKSPACE,
					role: "character",
					label: "Anjing",
					canonical_image_url: PICTURE,
				})
			)?.id,
		).toBe("legacy-b");
	});

	test("the guard itself refuses to create the legacy shape", async () => {
		// The regression this whole change exists to prevent, stated directly.
		await upsertReferenceEntity({
			id: randomUUID(),
			workspace: WORKSPACE,
			role: "character",
			label: "Anjing",
			canonical_image_url: PICTURE,
		});
		await upsertReferenceEntity({
			id: randomUUID(),
			workspace: WORKSPACE,
			role: "character",
			label: "Anjing",
			canonical_image_url: PICTURE,
		});

		expect(await listReferenceEntities(WORKSPACE)).toHaveLength(1);
	});
});
