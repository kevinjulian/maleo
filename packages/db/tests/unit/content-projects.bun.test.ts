/* Content projects — the list, the feed, the patch, storyboards and the per-project
 * children.
 *
 * These functions had no direct test: reaching them meant a temp file, an
 * environment variable and a singleton reset. They take a handle now. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { listContentFeed, listContentProjects } from "../../src/db/content-projects.ts";
import {
	createContentProject,
	getContentProject,
	setContentEditorState,
	updateContentProject,
} from "../../src/db/project-detail.ts";
import { addContentStoryboard } from "../../src/db/storyboards.ts";
import { createContentProjectOutput } from "../../src/db/outputs.ts";
import {
	deleteProjectNote,
	listProjectSpeakers,
	upsertProjectNote,
	upsertProjectSpeaker,
} from "../../src/db/project-children.ts";
import { addProjectReference, upsertReferenceEntity } from "../../src/db/references.ts";

let db: Db;
let t: TestDb;

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
});
afterEach(() => t.close());

const project = async (
	title = "Test project",
	over: Record<string, unknown> = {},
): Promise<string> => {
	const created = await createContentProject({ title, type: "video", ...over }, db);
	if (!created) throw new Error("project not created");
	return created.project.id;
};

describe("listing projects", () => {
	/* Timestamps are set explicitly so this asserts the ordering rather than the
	 * clock. It used to pass on wall-clock alone, but only because
	 * `createContentProject` was slow — its final `getContentProject` read the
	 * roster and speakers from the shared connection instead of the caller's
	 * handle, and that round trip pushed the two creations onto different
	 * milliseconds. Fixing the handle made creation fast enough to tie. */
	test("lists what was created, newest first", async () => {
		const first = await project("First");
		const second = await project("Second");
		await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [1_000, first]);
		await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [2_000, second]);

		expect((await listContentProjects({}, db)).map((p) => p.title)).toEqual(["Second", "First"]);
	});

	/* Ties are reachable — two projects touched in the same millisecond — and
	 * without a unique final sort key, paging over them can repeat or skip a row.
	 *
	 * Be honest about what this test does and does not do: it passes with or
	 * without the `p.id` tiebreaker, because SQLite's current plan happens to
	 * return tied rows in rowid order. It pins the property we depend on, not the
	 * absence of the key. The tiebreaker is what makes that property contractual
	 * instead of incidental — a different plan, index or SQLite version is free to
	 * reorder ties, and relying on incidental order is the same class of mistake
	 * that made the ordering test above depend on a slow database read. */
	test("projects sharing a timestamp keep a stable order across calls", async () => {
		const ids = await Promise.all(["Alpha", "Beta", "Gamma"].map((title) => project(title)));
		for (const id of ids)
			await db.run(`UPDATE content_projects SET updated_at = ? WHERE id = ?`, [5_000, id]);

		const once = (await listContentProjects({}, db)).map((p) => p.id);
		const twice = (await listContentProjects({}, db)).map((p) => p.id);
		const paged = [
			...(await listContentProjects({ limit: 2, offset: 0 }, db)).map((p) => p.id),
			...(await listContentProjects({ limit: 2, offset: 2 }, db)).map((p) => p.id),
		];

		expect(once).toEqual(twice);
		// Every project appears exactly once across the pages, none twice, none lost.
		expect(paged).toEqual(once);
		expect(new Set(paged).size).toBe(3);
	});

	test("filters by type and by status", async () => {
		await project("A video", { type: "video" });
		await project("An image", { type: "image" });

		expect((await listContentProjects({ type: "image" }, db)).map((p) => p.title)).toEqual([
			"An image",
		]);
		const status = (await listContentProjects({}, db))[0]!.status;
		expect((await listContentProjects({ status }, db)).length).toBe(2);
		expect(await listContentProjects({ status: "archived" }, db)).toEqual([]);
	});

	test("honours limit and offset", async () => {
		await project("A");
		await project("B");
		await project("C");

		expect(await listContentProjects({ limit: 2 }, db)).toHaveLength(2);
		expect(await listContentProjects({ limit: 2, offset: 2 }, db)).toHaveLength(1);
	});
});

describe("the content feed", () => {
	test("sorts globally before paging, counts output updates, and reads newest authored preview", async () => {
		const alpha = await project("alpha");
		const beta = await project("Beta");
		const gamma = await project("Gamma");
		await addContentStoryboard(
			{
				project_id: alpha,
				storyboard_json: {
					schemaVersion: 2,
					clips: [{ id: "old", type: "image", startSec: 0, durationSec: 90, track: 0 }],
				},
			},
			db,
		);
		await addContentStoryboard(
			{
				project_id: alpha,
				storyboard_json: {
					schemaVersion: 2,
					clips: [
						{
							id: "new",
							type: "image",
							startSec: 2,
							durationSec: 3,
							track: 0,
							video: { kind: "image", url: "/api/media/preview" },
						},
					],
				},
			},
			db,
		);
		const output = await createContentProjectOutput({ project_id: beta, title: "Rendered" }, db);
		for (const [id, timestamp] of [
			[alpha, 100],
			[beta, 50],
			[gamma, 200],
		] as const)
			await db.run("UPDATE content_projects SET updated_at = ? WHERE id = ?", [timestamp, id]);
		await db.run("UPDATE content_project_outputs SET updated_at = ? WHERE id = ?", [
			300,
			output!.id,
		]);
		const first = await listContentFeed({ sort: "modified", limit: 1 }, db);
		expect(first.items[0]?.id).toBe(beta);
		expect(
			(await listContentFeed({ sort: "modified", limit: 1, offset: 1 }, db)).items[0]?.id,
		).toBe(gamma);
		const named = await listContentFeed({ sort: "name", limit: 1 }, db);
		expect(named.items[0]).toMatchObject({
			id: alpha,
			thumbnail_url: "/api/media/preview",
			duration_sec: 5,
		});
		expect(named.items[0]).not.toHaveProperty("latest_storyboard_json");
		expect((await listContentFeed({ sort: "name", limit: 1, offset: 1 }, db)).items[0]?.id).toBe(
			beta,
		);
		expect(first.total).toBe(3);
		expect((await listContentFeed({ sort: "modified-asc" }, db)).items.map((p) => p.id)).toEqual([
			alpha,
			gamma,
			beta,
		]);
		expect((await listContentFeed({ sort: "name-desc" }, db)).items.map((p) => p.id)).toEqual([
			gamma,
			beta,
			alpha,
		]);
		await db.run("UPDATE content_projects SET title = 'Tie', updated_at = 400", []);
		for (const sort of ["modified", "modified-asc", "name", "name-desc"] as const) {
			const all = (await listContentFeed({ sort }, db)).items.map((p) => p.id);
			const pages = [
				...(await listContentFeed({ sort, limit: 2 }, db)).items,
				...(await listContentFeed({ sort, limit: 2, offset: 2 }, db)).items,
			].map((p) => p.id);
			expect(pages).toEqual(all);
			expect(new Set(pages).size).toBe(3);
		}
	});
	test("reports a real total, not the page length", async () => {
		for (const t of ["A", "B", "C"]) await project(t);

		const page = await listContentFeed({ limit: 2 }, db);
		expect(page.items).toHaveLength(2);
		expect(page.total).toBe(3);
	});

	test("searches by title", async () => {
		await project("Morning routine");
		await project("Evening wind-down");

		expect((await listContentFeed({ search: "morning" }, db)).items.map((p) => p.title)).toEqual([
			"Morning routine",
		]);
	});

	test("filters by type", async () => {
		await project("A video", { type: "video" });
		await project("An image", { type: "image" });

		expect((await listContentFeed({ type: "image" }, db)).items.map((p) => p.title)).toEqual([
			"An image",
		]);
	});
});

describe("patching a project", () => {
	test("applies only the fields the patch names", async () => {
		const id = await project("Original", { target_audience: "everyone" });

		const patched = await updateContentProject(id, { title: "Renamed" }, db);
		expect(patched?.project.title).toBe("Renamed");
		expect(patched?.project.target_audience).toBe("everyone");
	});

	test("an unknown project yields nothing", async () => {
		expect(await updateContentProject("no-such-project", { title: "x" }, db)).toBeNull();
	});

	test("editor state is written separately from the storyboard", async () => {
		const id = await project();

		expect(await setContentEditorState(id, { chat: [{ role: "user" }] }, db)).toBe(true);
		expect((await getContentProject(id, db))?.project.editor_state_json).toEqual({
			chat: [{ role: "user" }],
		});
	});

	test("editor state for an unknown project is refused", async () => {
		expect(await setContentEditorState("no-such-project", { chat: [] }, db)).toBe(false);
	});
});

describe("storyboards", () => {
	test("versions increment per project", async () => {
		const id = await project();

		const first = await addContentStoryboard(
			{ project_id: id, storyboard_json: { schemaVersion: 2, clips: [] } },
			db,
		);
		const second = await addContentStoryboard(
			{ project_id: id, storyboard_json: { schemaVersion: 2, clips: [] } },
			db,
		);

		expect(first?.version).toBe(1);
		expect(second?.version).toBe(2);
	});

	test("a storyboard for an unknown project is refused", async () => {
		expect(
			await addContentStoryboard({ project_id: "no-such-project", storyboard_json: {} }, db),
		).toBeNull();
	});

	test("the detail returns storyboards newest first", async () => {
		const id = await project();
		await addContentStoryboard({ project_id: id, storyboard_json: { v: 1 } }, db);
		await addContentStoryboard({ project_id: id, storyboard_json: { v: 2 } }, db);

		expect((await getContentProject(id, db))?.storyboards[0]?.version).toBe(2);
	});

	/* Every storyboard row carries a full document, so an unbounded read of them
	 * is what made a long-lived project's detail megabytes. The default is the
	 * head version; the artifact scan is the one caller that opts out. */
	test("the detail reads one storyboard version by default", async () => {
		const id = await project();
		for (let v = 1; v <= 5; v++)
			await addContentStoryboard({ project_id: id, storyboard_json: { v } }, db);

		const detail = await getContentProject(id, db);
		expect(detail?.storyboards).toHaveLength(1);
		expect(detail?.storyboards[0]?.version).toBe(5);
	});

	test("storyboardLimit: null reads every version, newest first", async () => {
		const id = await project();
		for (let v = 1; v <= 5; v++)
			await addContentStoryboard({ project_id: id, storyboard_json: { v } }, db);

		const detail = await getContentProject(id, db, { storyboardLimit: null });
		expect(detail?.storyboards.map((s) => s.version)).toEqual([5, 4, 3, 2, 1]);
	});

	test("an explicit storyboardLimit takes the newest N", async () => {
		const id = await project();
		for (let v = 1; v <= 5; v++)
			await addContentStoryboard({ project_id: id, storyboard_json: { v } }, db);

		expect(
			(await getContentProject(id, db, { storyboardLimit: 2 }))?.storyboards.map((s) => s.version),
		).toEqual([5, 4]);
	});
});

describe("project children", () => {
	test("a note round-trips and is deletable", async () => {
		const id = await project();

		const note = await upsertProjectNote(
			{ id: "n1", project_id: id, label: "Tone", body: "warm", tags: ["tone"] },
			db,
		);
		expect(note?.label).toBe("Tone");
		expect((await getContentProject(id, db))?.notes).toHaveLength(1);

		expect(await deleteProjectNote(id, "n1", db)).toBe(true);
		expect((await getContentProject(id, db))?.notes).toEqual([]);
	});

	test("upserting the same note id replaces rather than duplicates", async () => {
		const id = await project();
		await upsertProjectNote({ id: "n1", project_id: id, label: "Tone", body: "warm" }, db);
		await upsertProjectNote({ id: "n1", project_id: id, label: "Tone", body: "cool" }, db);

		const notes = (await getContentProject(id, db))?.notes ?? [];
		expect(notes).toHaveLength(1);
		expect(notes[0]?.body).toBe("cool");
	});

	test("a note for an unknown project is refused", async () => {
		expect(
			await upsertProjectNote(
				{ id: "n1", project_id: "no-such-project", label: "x", body: "y" },
				db,
			),
		).toBeNull();
	});

	test("speakers are project-scoped voice identities, not reference entities", async () => {
		const id = await project();
		await upsertProjectSpeaker(
			{ project_id: id, voice_key: "vox-1", name: "Narrator", is_default: true },
			db,
		);

		const speakers = await listProjectSpeakers(id, db);
		expect(speakers.map((s) => s.voice_key)).toEqual(["vox-1"]);
		expect(speakers[0]?.is_default).toBe(1);
	});
});

describe("the detail aggregate", () => {
	test("an unknown project has no detail", async () => {
		expect(await getContentProject("no-such-project", db)).toBeNull();
	});

	test("a fresh project has empty children rather than missing ones", async () => {
		const id = await project();
		const detail = (await getContentProject(id, db))!;

		expect(detail.entities).toEqual([]);
		expect(detail.notes).toEqual([]);
		expect(detail.renders).toEqual([]);
		expect(detail.outputs).toEqual([]);
	});

	test("creation records an event", async () => {
		const id = await project();
		expect((await getContentProject(id, db))!.events.length).toBeGreaterThan(0);
	});

	/* The roster used to be dropped at create: the client sent it, the route never
	 * declared the field, and every new project loaded with an empty roster — which
	 * silently attaches nothing to a scene at generation time. */
	test("a project is created with its roster attached", async () => {
		await upsertReferenceEntity(
			{ id: "lead", workspace: "default", role: "character", label: "Lead" },
			db,
		);
		await upsertReferenceEntity(
			{ id: "prop-1", workspace: "default", role: "prop", label: "Mug" },
			db,
		);

		const created = await createContentProject(
			{
				title: "With a roster",
				type: "video",
				reference_entity_ids: ["lead", "prop-1", "lead"],
				lead_entity_id: "lead",
			},
			db,
		);

		const detail = (await getContentProject(created!.project.id, db))!;
		expect(detail.entities.map((e) => e.id).sort()).toEqual(["lead", "prop-1"]);
		expect(detail.entities.filter((e) => e.is_primary === 1).map((e) => e.id)).toEqual(["lead"]);
	});

	test("a lead that was never attached does not become the primary", async () => {
		await upsertReferenceEntity(
			{ id: "attached", workspace: "default", role: "character", label: "In" },
			db,
		);
		await upsertReferenceEntity(
			{ id: "stranger", workspace: "default", role: "character", label: "Out" },
			db,
		);

		const created = await createContentProject(
			{
				title: "Lead outside the roster",
				type: "video",
				reference_entity_ids: ["attached"],
				lead_entity_id: "stranger",
			},
			db,
		);

		const detail = (await getContentProject(created!.project.id, db))!;
		expect(detail.entities.map((e) => e.id)).toEqual(["attached"]);
		expect(detail.entities.some((e) => e.is_primary === 1)).toBe(false);
	});

	/* The aggregate reads seven families. It used to read five from the handle it
	 * was given and two — the roster and the speakers — from the shared connection,
	 * because it called their accessors without passing the handle on. The empty
	 * case above could not see it: an unseeded project reads empty from either
	 * database. Only a seeded one distinguishes them. */
	test("the roster and speakers come from the caller's database", async () => {
		const id = await project();
		await upsertReferenceEntity(
			{ id: "ent-1", workspace: "default", role: "character", label: "Lead" },
			db,
		);
		await addProjectReference({ project_id: id, entity_id: "ent-1" }, db);
		await upsertProjectSpeaker({ project_id: id, voice_key: "vo-1", name: "Narrator" }, db);

		const detail = (await getContentProject(id, db))!;

		expect(detail.entities.map((e) => e.id)).toEqual(["ent-1"]);
		expect(detail.speakers.map((s) => s.name)).toEqual(["Narrator"]);
	});
});
