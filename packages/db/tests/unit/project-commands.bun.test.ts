/* The project command log (`p1-command-log`): every version has one entry,
 * written and pruned in the version's own transaction. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { openTestDb, type TestDb } from "../../src/db/handle-testing.ts";
import type { Db } from "../../src/db/handle.ts";
import { createContentProject } from "../../src/db/project-detail.ts";
import { addContentStoryboard } from "../../src/db/storyboards.ts";
import { commandEntriesBetween, commandOutcomes } from "../../src/db/project-commands.ts";

let db: Db;
let t: TestDb;
let projectId: string;

beforeEach(async () => {
	t = await openTestDb("postgres");
	db = t.db;
	const created = await createContentProject({ title: "Log", type: "video" }, db);
	if (!created) throw new Error("project not created");
	projectId = created.project.id;
});
afterEach(() => t.close());

const clip = {
	id: "text:1",
	type: "text",
	startSec: 0,
	durationSec: 1,
	track: 0,
	text: { id: 1, preset: "plain", content: "Text", start: 0, dur: 1 },
};
const document = { schemaVersion: 2, clips: [clip], markers: [] };
const move = { type: "clip.move", id: "text:1", patch: { startSec: 2 } } as const;
const remove = { type: "clip.remove", id: "text:1" } as const;

const entryRows = async () =>
	db.all<{ seq: number; version: number; position: number; client_command_id: string | null }>(
		`SELECT seq, version, position, client_command_id FROM content_project_commands
		 WHERE project_id = ? ORDER BY seq, position`,
		[projectId],
	);

describe("each storyboard version has one log position", () => {
	test("a write with commands records them in order", async () => {
		const row = await addContentStoryboard(
			{
				project_id: projectId,
				storyboard_json: document,
				commands: [
					{ command: move, clientCommandId: "c1" },
					{ command: remove, clientCommandId: "c2" },
				],
				actor_type: "editor",
			},
			db,
		);
		expect(await entryRows()).toEqual([
			{ seq: 1, version: row!.version, position: 0, client_command_id: "c1" },
			{ seq: 1, version: row!.version, position: 1, client_command_id: "c2" },
		]);
		expect(await commandEntriesBetween(projectId, 0, 1, db)).toEqual([
			{ seq: 1, version: 1, commands: [move, remove], actor: "editor" },
		]);
		const outcomes = await commandOutcomes(projectId, ["c1", "c2", "unknown"], db);
		expect(outcomes.get("c1")).toEqual({ state: "accepted", seq: 1, version: 1 });
		expect(outcomes.has("unknown")).toBe(false);
	});

	test("a write without commands records one scope.replace of the written scope", async () => {
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		const [entry] = (await commandEntriesBetween(projectId, 0, 1, db))!;
		expect(entry!.actor).toBe("system");
		expect(entry!.commands).toHaveLength(1);
		const command = entry!.commands[0]!;
		expect(command.type).toBe("scope.replace");
		if (command.type !== "scope.replace") return;
		expect(command.scope.doc.clips.map((c) => c.id)).toEqual(["text:1"]);
		expect(command.scope.mediaAssets).toEqual([]);
	});

	test("a failed write leaves no entry", async () => {
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		const duplicate = addContentStoryboard(
			{
				project_id: projectId,
				storyboard_json: document,
				commands: [
					{ command: move, clientCommandId: "same" },
					{ command: move, clientCommandId: "same" },
				],
			},
			db,
		);
		await expect(duplicate).rejects.toThrow();
		expect((await entryRows()).map((row) => row.seq)).toEqual([1]);
		const versions = await db.all(`SELECT version FROM content_storyboards WHERE project_id = ?`, [
			projectId,
		]);
		expect(versions).toHaveLength(1);
	});

	test("a range with a sequence that has no entry reads as null", async () => {
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db);
		await db.run(`DELETE FROM content_project_commands WHERE project_id = ? AND seq = 1`, [
			projectId,
		]);
		expect(await commandEntriesBetween(projectId, 0, 2, db)).toBeNull();
		expect((await commandEntriesBetween(projectId, 1, 2, db))!.map((e) => e.seq)).toEqual([2]);
		expect(await commandEntriesBetween(projectId, 2, 2, db)).toEqual([]);
	});
});

describe("log entries follow version retention", () => {
	test("a pruned version's entry is gone and a retained version's entry remains", async () => {
		const policy = { window: 2 };
		for (let i = 0; i < 4; i++)
			await addContentStoryboard({ project_id: projectId, storyboard_json: document }, db, policy);
		const retained = (
			await db.all<{ version: number }>(
				`SELECT version FROM content_storyboards WHERE project_id = ? ORDER BY version`,
				[projectId],
			)
		).map((row) => row.version);
		expect(retained).toEqual([3, 4]);
		expect([...new Set((await entryRows()).map((row) => row.version))]).toEqual([3, 4]);
		expect([...new Set((await entryRows()).map((row) => row.seq))]).toEqual([3, 4]);
	});
});
