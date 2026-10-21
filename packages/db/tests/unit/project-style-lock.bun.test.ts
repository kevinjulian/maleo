/* The per-project style lock, moved out of content_references.
 *
 * It was 6,270 rows all sharing the logical id 'style-bible' — one per project,
 * differing only by job_id. A per-project generated plate is project state, not a
 * reusable library entry; living in the reference table made it look castable.
 *
 * The subtle behavior to preserve: the bible text and the style-board image are
 * produced at different points in a run, so saving text alone must NOT clear an
 * image that was already generated. The old code achieved this by re-reading the
 * existing row's source_url and passing it back in. */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { createContentProject } from "../../src/db/project-detail.ts";
import { getProjectStyleLock, upsertProjectStyleLock } from "../../src/db/project-children.ts";

let db: Db;
let t: TestDb;

async function makeProject(): Promise<string> {
	const created = await createContentProject({ title: "Style", type: "video" }, db);
	if (!created) throw new Error("project not created");
	return created.project.id;
}

describe("project style lock", () => {
	beforeEach(async () => {
		t = await openTestDb("postgres");
		db = t.db;
	});

	it("round-trips the bible text", async () => {
		const p = await makeProject();
		await upsertProjectStyleLock({ project_id: p, visual_style: "muted 16mm film grain" }, db);
		expect((await getProjectStyleLock(p, db))?.visual_style).toBe("muted 16mm film grain");
	});

	it("holds exactly one row per project however many times it is saved", async () => {
		const p = await makeProject();
		await upsertProjectStyleLock({ project_id: p, visual_style: "v1" }, db);
		await upsertProjectStyleLock({ project_id: p, visual_style: "v2" }, db);
		await upsertProjectStyleLock({ project_id: p, visual_style: "v3" }, db);
		expect((await getProjectStyleLock(p, db))?.visual_style).toBe("v3");
	});

	it("keeps projects independent", async () => {
		const a = await makeProject();
		const b = await makeProject();
		await upsertProjectStyleLock({ project_id: a, visual_style: "look A" }, db);
		await upsertProjectStyleLock({ project_id: b, visual_style: "look B" }, db);
		expect((await getProjectStyleLock(a, db))?.visual_style).toBe("look A");
		expect((await getProjectStyleLock(b, db))?.visual_style).toBe("look B");
	});

	it("does NOT clear an existing board image when saving text alone", async () => {
		const p = await makeProject();
		await upsertProjectStyleLock(
			{ project_id: p, visual_style: "look", board_image_url: "/api/image-gen/files/board.png" },
			db,
		);
		// A later text-only save (the ordering a real run produces).
		await upsertProjectStyleLock({ project_id: p, visual_style: "look refined" }, db);
		const row = await getProjectStyleLock(p, db);
		expect(row?.visual_style).toBe("look refined");
		expect(row?.board_image_url).toBe("/api/image-gen/files/board.png");
	});

	it("sets the board image on a later save", async () => {
		const p = await makeProject();
		await upsertProjectStyleLock({ project_id: p, visual_style: "look" }, db);
		expect((await getProjectStyleLock(p, db))?.board_image_url).toBeNull();
		await upsertProjectStyleLock(
			{ project_id: p, visual_style: "look", board_image_url: "/api/image-gen/files/board.png" },
			db,
		);
		expect((await getProjectStyleLock(p, db))?.board_image_url).toBe(
			"/api/image-gen/files/board.png",
		);
	});

	it("replaces the board image when a new one is supplied", async () => {
		const p = await makeProject();
		await upsertProjectStyleLock(
			{ project_id: p, visual_style: "look", board_image_url: "/api/image-gen/files/a.png" },
			db,
		);
		await upsertProjectStyleLock(
			{ project_id: p, visual_style: "look", board_image_url: "/api/image-gen/files/b.png" },
			db,
		);
		expect((await getProjectStyleLock(p, db))?.board_image_url).toBe("/api/image-gen/files/b.png");
	});

	it("returns null for a project with no lock", async () => {
		expect(await getProjectStyleLock(await makeProject())).toBeNull();
	});
});
afterEach(() => t.close());
