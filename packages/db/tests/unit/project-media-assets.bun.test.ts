/* The project media library (`p1-media-library`): server-owned rows, changed in
 * the command log, imported once from a stored list, pruned with retention. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { MediaAsset } from "@maleo/shared/editor/storyboard-scope";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { createContentProject, setContentEditorState } from "../../src/db/project-detail.ts";
import { addContentStoryboard } from "../../src/db/storyboards.ts";
import {
	commandEntriesBetween,
	headCommandSeq,
	recordCommandEntry,
} from "../../src/db/project-commands.ts";
import {
	admitProjectMediaAsset,
	applyMediaLibraryChange,
	projectMediaLibrary,
} from "../../src/db/project-media-assets.ts";

let db: Db;
let t: TestDb;
let projectId: string;

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	const created = await createContentProject({ title: "Library", type: "video" }, db);
	if (!created) throw new Error("project not created");
	projectId = created.project.id;
});
afterEach(() => t.close());

const asset = (id: string, url = `/api/media/${id}`): MediaAsset => ({
	id,
	label: id,
	url,
	kind: "image",
	source: "upload",
});
const document = { schemaVersion: 2, clips: [], markers: [] };
const ids = async () => (await projectMediaLibrary(projectId, db)).map((item) => item.id);

describe("library rows", () => {
	test("a difference inserts, updates and deletes rows, newest first", async () => {
		await projectMediaLibrary(projectId, db);
		await applyMediaLibraryChange(db, projectId, [], [asset("b"), asset("a")]);
		expect(await ids()).toEqual(["b", "a"]);
		const before = await projectMediaLibrary(projectId, db);
		await applyMediaLibraryChange(db, projectId, before, [
			asset("c"),
			{ ...asset("b"), favorite: true },
		]);
		const after = await projectMediaLibrary(projectId, db);
		expect(after.map((item) => item.id)).toEqual(["c", "b"]);
		expect(after[1]!.favorite).toBe(true);
	});

	test("two assets cannot share a URL", async () => {
		await projectMediaLibrary(projectId, db);
		await expect(
			applyMediaLibraryChange(db, projectId, [], [asset("a", "/same"), asset("b", "/same")]),
		).rejects.toThrow();
	});

	test("admitting records one versionless media.admit entry", async () => {
		expect(await admitProjectMediaAsset(projectId, asset("a"), db)).toEqual({
			id: "a",
			added: true,
		});
		expect(await ids()).toEqual(["a"]);
		const entries = await commandEntriesBetween(projectId, 0, 1, db);
		expect(entries).toEqual([
			{
				seq: 1,
				version: null,
				commands: [{ type: "media.admit", asset: asset("a") }],
				actor: "system",
			},
		]);
		const versions = await db.all(`SELECT 1 FROM content_storyboards WHERE project_id = ?`, [
			projectId,
		]);
		expect(versions).toHaveLength(0);
	});

	test("admitting a held URL or id answers the held identity and records nothing", async () => {
		await admitProjectMediaAsset(projectId, asset("a", "/u/1"), db);
		expect(await admitProjectMediaAsset(projectId, asset("b", "/u/1"), db)).toEqual({
			id: "a",
			added: false,
		});
		expect(await admitProjectMediaAsset(projectId, asset("a", "/u/2"), db)).toEqual({
			id: "a",
			added: false,
		});
		expect(await ids()).toEqual(["a"]);
		expect(await headCommandSeq(db, projectId)).toBe(1);
	});

	test("a finished import completes the held pending asset of its id", async () => {
		await admitProjectMediaAsset(projectId, { ...asset("u"), favorite: true }, db);
		const finished = {
			...asset("u"),
			label: "clip.mp4",
			importedSource: {
				revision: "r1",
				fingerprint: "f",
				originalMediaId: "o",
				playbackMediaId: "u",
			},
		} as MediaAsset;
		expect(await admitProjectMediaAsset(projectId, finished, db)).toEqual({
			id: "u",
			added: false,
		});
		const [held] = await projectMediaLibrary(projectId, db);
		expect(held).toMatchObject({
			label: "clip.mp4",
			favorite: true,
			importedSource: { revision: "r1" },
		});
		const entries = (await commandEntriesBetween(projectId, 1, 2, db))!;
		expect(entries[0]!.commands[0]!.type).toBe("media.update");
		// Finishing again changes nothing.
		await admitProjectMediaAsset(projectId, finished, db);
		expect(await headCommandSeq(db, projectId)).toBe(2);
	});

	test("a version written without commands carries the library in its scope.replace", async () => {
		await admitProjectMediaAsset(projectId, asset("a"), db);
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		const [entry] = (await commandEntriesBetween(projectId, 1, 2, db))!;
		const command = entry!.commands[0]!;
		expect(command.type === "scope.replace" && command.scope.mediaAssets).toEqual([asset("a")]);
	});
});

describe("a stored list is imported once", () => {
	// A project saved before the rows existed: a stored list, not yet imported.
	const storeList = (list: MediaAsset[]) =>
		db.run(`UPDATE content_projects SET editor_state_json = ? WHERE id = ?`, [
			JSON.stringify({ media_assets: list }),
			projectId,
		]);
	const legacy = async () => {
		await storeList([asset("a", "/u/1"), asset("b", "/u/2")]);
		await db.run(`UPDATE content_projects SET media_library_imported_at = NULL WHERE id = ?`, [
			projectId,
		]);
	};

	test("the editor state's list and the document's merge by URL", async () => {
		await db.run(`UPDATE content_projects SET media_library_imported_at = 0 WHERE id = ?`, [
			projectId,
		]);
		await addContentStoryboard(
			{
				project_id: projectId,
				storyboard_json: { ...document, media_assets: [asset("c", "/u/2"), asset("d", "/u/3")] },
			},
			db,
		);
		await legacy();
		expect(await ids()).toEqual(["a", "b", "d"]);
	});

	test("a second read imports nothing", async () => {
		await legacy();
		expect(await ids()).toEqual(["a", "b"]);
		await storeList([asset("z")]);
		expect(await ids()).toEqual(["a", "b"]);
	});

	test("saving editor state keeps the stored list and leaves the library alone", async () => {
		await legacy();
		await projectMediaLibrary(projectId, db);
		expect(await setContentEditorState(projectId, { chat: [], media_assets: [] }, db)).toBe(true);
		expect(await ids()).toEqual(["a", "b"]);
		const row = await db.get<{ editor_state_json: string }>(
			`SELECT editor_state_json FROM content_projects WHERE id = ?`,
			[projectId],
		);
		expect(JSON.parse(row!.editor_state_json).media_assets).toHaveLength(2);
	});

	test("two concurrent first reads import once", async () => {
		await legacy();
		const [one, two] = await Promise.all([
			projectMediaLibrary(projectId, db),
			projectMediaLibrary(projectId, db),
		]);
		expect(one.map((item) => item.id)).toEqual(["a", "b"]);
		expect(two.map((item) => item.id)).toEqual(["a", "b"]);
		const rows = await db.all(`SELECT id FROM project_media_assets WHERE project_id = ?`, [
			projectId,
		]);
		expect(rows).toHaveLength(2);
	});

	test("a project with no stored list starts empty", async () => {
		expect(await ids()).toEqual([]);
	});
});

describe("versionless entries follow retention", () => {
	test("entries behind the oldest kept version are pruned; MAX(seq) never decreases", async () => {
		const policy = { window: 1 };
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db, policy);
		await admitProjectMediaAsset(projectId, asset("a"), db); // seq 2, behind version 1
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db, policy);
		await admitProjectMediaAsset(projectId, asset("b"), db); // seq 4, after the head version
		const seqs = async () =>
			(
				await db.all<{ seq: number; version: number | null }>(
					`SELECT DISTINCT seq, version FROM content_project_commands WHERE project_id = ? ORDER BY seq`,
					[projectId],
				)
			).map((row) => [row.seq, row.version]);
		expect(await seqs()).toEqual([
			[3, 2],
			[4, null],
		]);
		expect(await headCommandSeq(db, projectId)).toBe(4);
		// A client behind the pruned range reads a snapshot.
		expect(await commandEntriesBetween(projectId, 0, 4, db)).toBeNull();
		expect((await commandEntriesBetween(projectId, 2, 4, db))!.map((e) => e.seq)).toEqual([3, 4]);
	});

	test("a versionless entry newer than every kept version stays", async () => {
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		await recordCommandEntry(db, {
			project_id: projectId,
			version: null,
			commands: [{ command: { type: "noop" } }],
			actor_type: "system",
			created_at: 0,
		});
		expect(await headCommandSeq(db, projectId)).toBe(2);
	});
});
