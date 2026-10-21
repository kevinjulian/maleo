/* The Reference Library's pool.
 *
 * These fixtures are the shape of the failure that prompted the change: a
 * workspace whose `reference_entity` library was intact while its
 * `content_assets` mirror held two rows, read through a catalogue that only
 * knew about the mirror. The library rendered two entries and the operator
 * concluded their references were gone. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { suppressAssetRef, upsertContentAsset } from "@maleo/db/assets";
import {
	addProjectReference,
	getReferenceEntity,
	listProjectReferences,
	upsertReferenceEntity,
} from "@maleo/db/references";
import { createContentProject } from "@maleo/db/project-detail";
import { listContentCatalogueImages } from "./content-catalogue.ts";

const dbPath = join(tmpdir(), "maleo-content-catalogue.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
const dataDir = join(tmpdir(), "maleo-content-catalogue.test.data");

const WORKSPACE = "default";

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
	rmSync(dataDir, { force: true, recursive: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	// An empty data dir keeps `listItems` from importing a developer's real
	// workspace collections into the fixture.
	process.env.MALEO_DATA_DIR = dataDir;
	await resetDb();
});

afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	/* Restored, never deleted. `scripts/test-db-guard.ts` points MALEO_DATA_DIR
	 * at a temp directory so a later suite that clears its own DB path still
	 * falls back to a temp database; deleting the var removes that floor and the
	 * next suite opens the developer's real `data/maleo.db`. Enforced by
	 * `packages/db/tests/unit/test-db-guard-usage.test.ts`. */
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

async function entity(id: string, label: string, workspace = WORKSPACE): Promise<void> {
	await upsertReferenceEntity({
		id,
		workspace,
		role: "character",
		label,
		description: `${label} description`,
		canonical_image_url: `https://cdn.example.com/${id}.png`,
		origin: "linked",
	});
}

async function mirror(entityId: string, label: string): Promise<void> {
	await upsertContentAsset({
		scope: "workspace",
		workspace: WORKSPACE,
		kind: "character",
		label,
		tags: ["character", "mirrored"],
		note: "mirror note",
		seed: 42,
		default: false,
		src: `https://cdn.example.com/${entityId}.png`,
		source_type: "reference_entity",
		source_ref: entityId,
		item_id: entityId,
		meta_json: { id: entityId },
	});
}

/* Written straight to the table. `upsertReferenceEntity` now refuses to create
 * this shape, but it is what already sits in the database: rows minted before the
 * entity write path had a content key. They are not removed, because each is
 * attached to some project's roster. */
async function rawDuplicate(id: string, createdAt: number, label = "Anjing"): Promise<void> {
	await openDb().run(
		`INSERT INTO reference_entity (id, workspace, role, label, description, canonical_image_url, origin, created_at, updated_at)
		 VALUES (?, ?, 'character', ?, '', '/api/personas/anjing/sheets/sheet-1.png', 'linked', ?, ?)`,
		[id, WORKSPACE, label, createdAt, createdAt],
	);
}

describe("reference catalogue visibility", () => {
	test("an entity with no asset mirror still appears, with its canonical image", async () => {
		await entity("r-stickman", "Sketch Stickman");

		const images = await listContentCatalogueImages(WORKSPACE);

		const found = images.find((image) => image.id === "r-stickman");
		expect(found).toBeDefined();
		expect(found?.label).toBe("Sketch Stickman");
		expect(found?.kind).toBe("character");
		expect(found?.note).toBe("Sketch Stickman description");
		expect(found?.src).toBe("https://cdn.example.com/r-stickman.png");
		expect(found?.workspace).toBe(WORKSPACE);
	});

	test("a sparse mirror does not hide the rest of the library", async () => {
		// The Lidiman shape: a full entity library, two mirror rows.
		const labels = [
			"Pria",
			"Sketch Env #1",
			"Sketch Stickman",
			"Wanita",
			"Studio Backdrop",
			"Logo Mark",
		];
		for (const [index, label] of labels.entries()) await entity(`r-${index}`, label);
		await mirror("r-0", "Pria");
		await mirror("r-1", "Sketch Env #1");

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images).toHaveLength(labels.length);
		expect(images.map((image) => image.label).sort()).toEqual([...labels].sort());
	});

	test("a mirrored entity produces one entry, not two", async () => {
		await entity("r-stickman", "Sketch Stickman");
		await mirror("r-stickman", "Sketch Stickman");

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images.filter((image) => image.id === "r-stickman")).toHaveLength(1);
		expect(images).toHaveLength(1);
	});

	test("catalogue ids are entity ids, so a stored selection still resolves", async () => {
		// A project document that already selects this id must keep resolving after
		// the catalogue's source of truth moves off the mirror.
		const storedSelection = "r1783177064445p83";
		await entity(storedSelection, "Sketch Stickman");

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images.map((image) => image.id)).toContain(storedSelection);
		expect(images.find((image) => image.id === storedSelection)?.item_id).toBe(storedSelection);
	});

	test("a deleted reference stays deleted when its mirror row is gone", async () => {
		await entity("r-gone", "Retired Character");
		await entity("r-kept", "Kept Character");
		// What `DELETE /assets/:refId` records. The mirror row it removed is not
		// here at all, which is the case that used to resurrect the reference.
		await suppressAssetRef("r-gone", WORKSPACE, "deleted from the reference library");

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images.map((image) => image.id)).toEqual(["r-kept"]);
	});

	test("another workspace's entities are not listed", async () => {
		await entity("r-mine", "Mine");
		await entity("r-theirs", "Theirs", "other-workspace");

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images.map((image) => image.id)).toEqual(["r-mine"]);
	});

	test("an entity with no canonical image and no mirror is not listed", async () => {
		await upsertReferenceEntity({
			id: "r-imageless",
			workspace: WORKSPACE,
			role: "character",
			label: "Imageless",
			canonical_image_url: null,
			origin: "linked",
		});

		expect(await listContentCatalogueImages(WORKSPACE)).toEqual([]);
	});

	/* The library showed 69 cards for 23 references.
	 *
	 * `reference_entity` carries legacy duplicates: the persona-era project
	 * creation minted a fresh uuid for the same collection item on every new
	 * project, so one picture became seven rows. The asset-mirror read this
	 * catalogue replaced collapsed them by accident, keying its dedupe on
	 * `(kind, label, src)` — reading entities directly surfaced all of them.
	 *
	 * They cannot simply be deleted: every one is attached to some project's
	 * roster. So they collapse for display and every id stays resolvable. */
	test("rows describing the same picture collapse to one entry", async () => {
		await rawDuplicate("anjing-1", 10);
		await rawDuplicate("anjing-2", 30);
		await rawDuplicate("anjing-3", 20);

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images).toHaveLength(1);
		// The oldest row survives, so the representative does not move between reads.
		expect(images[0]?.id).toBe("anjing-1");
	});

	test("the collapsed entry is stable between reads", async () => {
		await rawDuplicate("anjing-1", 10);
		await rawDuplicate("anjing-2", 30);
		await rawDuplicate("anjing-3", 20);

		const first = await listContentCatalogueImages(WORKSPACE);
		const second = await listContentCatalogueImages(WORKSPACE);

		// A representative that moved between reads would reorder the library for
		// no reason the operator did anything to cause.
		expect(first.map((i) => i.id)).toEqual(second.map((i) => i.id));
	});

	test("collapsing retires no id — every duplicate still resolves and attaches", async () => {
		/* The rows are collapsed for display, never removed. Each is attached to
		 * some project's roster and named by some document's lock, so an id that
		 * stopped resolving would empty a roster and block a run. */
		const ids = ["anjing-1", "anjing-2", "anjing-3"];
		await Promise.all(ids.map((id, index) => rawDuplicate(id, 10 + index)));
		const projectId = (await createContentProject({ title: "resolves", type: "video" })).project.id;

		expect(await listContentCatalogueImages(WORKSPACE)).toHaveLength(1);
		for (const id of ids) {
			expect(await getReferenceEntity(id)).not.toBeNull();
			expect(await addProjectReference({ project_id: projectId, entity_id: id })).not.toBeNull();
		}
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(ids.length);
	});

	test("same label and role but a different picture stays two entries", async () => {
		await entity("env-a", "New Environment");
		await upsertReferenceEntity({
			id: "env-b",
			workspace: WORKSPACE,
			role: "character",
			label: "New Environment",
			canonical_image_url: "https://cdn.example.com/somewhere-else.png",
			origin: "linked",
		});

		expect(await listContentCatalogueImages(WORKSPACE)).toHaveLength(2);
	});

	test("the same picture under a different role stays two entries", async () => {
		await upsertReferenceEntity({
			id: "as-char",
			workspace: WORKSPACE,
			role: "character",
			label: "Dual",
			canonical_image_url: "/shared.png",
			origin: "linked",
		});
		await upsertReferenceEntity({
			id: "as-prop",
			workspace: WORKSPACE,
			role: "prop",
			label: "Dual",
			canonical_image_url: "/shared.png",
			origin: "linked",
		});

		expect(await listContentCatalogueImages(WORKSPACE)).toHaveLength(2);
	});

	test("an asset with no entity behind it still appears", async () => {
		await upsertContentAsset({
			scope: "workspace",
			workspace: WORKSPACE,
			kind: "location",
			label: "Uploaded Backdrop",
			tags: ["location"],
			note: "",
			seed: 7,
			default: false,
			src: "https://cdn.example.com/upload.png",
			source_type: "manual",
		});

		const images = await listContentCatalogueImages(WORKSPACE);

		expect(images.map((image) => image.label)).toEqual(["Uploaded Backdrop"]);
	});
});
