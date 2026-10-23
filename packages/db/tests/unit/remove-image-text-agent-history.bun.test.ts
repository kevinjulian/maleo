/* Migration 0008: image and text projects lose their agent history, once.
 *
 * Run against a populated database of the real engine, migrated to the version
 * before this one, because the property is about what survives: video projects
 * untouched, legacy slides, posts, produced media and billing kept, and a stored
 * editor state that is not valid JSON left as it is rather than failing the
 * whole migration. */
import { afterEach, describe, expect, test } from "bun:test";
import { createTestDatabase, type TestDatabase } from "../../src/db/pg-testing.ts";
import { loadMigrations, migrate } from "../../src/db/migrate.ts";

const VERSION = 8;
const opened: TestDatabase[] = [];
afterEach(async () => {
	await Promise.all(opened.splice(0).map((db) => db.drop()));
});

const NOW = 1_700_000_000_000;
const state = (extra: Record<string, unknown> = {}) =>
	JSON.stringify({
		chat: [{ role: "user", text: "make it" }],
		settings: { aspect: "9:16" },
		...extra,
	});

async function seeded(): Promise<TestDatabase> {
	const db = await createTestDatabase({ migrated: false });
	opened.push(db);
	await migrate(
		db.sql,
		loadMigrations().filter((migration) => migration.version < VERSION),
	);
	const project = (id: string, type: string, editorState: string | null) => db.sql`
		INSERT INTO content_projects (id, title, type, status, editor_state_json, created_at, updated_at)
		VALUES (${id}, ${id}, ${type}, 'storyboard', ${editorState}, ${NOW}, ${NOW})`;
	await project("video-1", "video", state());
	await project("image-1", "image", state({ slides: [{ caption: "kept" }] }));
	await project("text-1", "text", state());
	await project("text-broken", "text", "{not json");
	for (const [projectId, type] of [
		["video-1", "video"],
		["image-1", "image"],
		["text-1", "text"],
	] as const) {
		const run = `run-${projectId}`;
		await db.sql`INSERT INTO workflow_run (id, project_id, content_type, status, created_at, updated_at) VALUES (${run}, ${projectId}, ${type}, 'done', ${NOW}, ${NOW})`;
		await db.sql`INSERT INTO step_run (id, workflow_run_id, idx, tool_name, status, created_at, updated_at) VALUES (${`step-${projectId}`}, ${run}, 0, 'tool', 'completed', ${NOW}, ${NOW})`;
		await db.sql`INSERT INTO tool_run (id, workflow_run_id, tool_name, status, created_at, updated_at) VALUES (${`tool-${projectId}`}, ${run}, 'tool', 'completed', ${NOW}, ${NOW})`;
		await db.sql`INSERT INTO required_action (id, workflow_run_id, type, created_at) VALUES (${`action-${projectId}`}, ${run}, 'approval', ${NOW})`;
		await db.sql`INSERT INTO run_artifact (id, project_id, tool_run_id, kind, public_url, created_at) VALUES (${`artifact-${projectId}`}, ${projectId}, ${`tool-${projectId}`}, 'image', ${`/api/media/${projectId}.png`}, ${NOW})`;
		await db.sql`INSERT INTO credit_transactions (id, account_id, type, amount_credits, balance_available_after, balance_reserved_after, reference_type, reference_id, created_at)
			VALUES (${`credit-${projectId}`}, 'account', 'capture', -1, 0, 0, 'workflow_run', ${run}, ${NOW})`;
	}
	return db;
}

const ids = async (db: TestDatabase, table: string) =>
	(await db.sql.unsafe<{ id: string }[]>(`SELECT id FROM ${table} ORDER BY id`)).map(
		(row) => row.id,
	);
const editorState = async (db: TestDatabase, id: string) =>
	(
		await db.sql<
			{ editor_state_json: string | null }[]
		>`SELECT editor_state_json FROM content_projects WHERE id = ${id}`
	)[0]?.editor_state_json ?? null;

describe("removing image and text agent history", () => {
	test("legacy runs and their children are deleted; video's are not", async () => {
		const db = await seeded();
		await migrate(db.sql, loadMigrations());
		expect(await ids(db, "workflow_run")).toEqual(["run-video-1"]);
		expect(await ids(db, "step_run")).toEqual(["step-video-1"]);
		expect(await ids(db, "tool_run")).toEqual(["tool-video-1"]);
		expect(await ids(db, "required_action")).toEqual(["action-video-1"]);
	});

	test("legacy chat is stripped and the rest of the editor state is kept", async () => {
		const db = await seeded();
		await migrate(db.sql, loadMigrations());
		expect(JSON.parse((await editorState(db, "image-1"))!)).toEqual({
			settings: { aspect: "9:16" },
			slides: [{ caption: "kept" }],
		});
		expect(JSON.parse((await editorState(db, "text-1"))!)).toEqual({
			settings: { aspect: "9:16" },
		});
		expect(JSON.parse((await editorState(db, "video-1"))!)).toEqual(JSON.parse(state()));
	});

	test("an editor state that is not valid JSON is left unchanged and does not fail the migration", async () => {
		const db = await seeded();
		expect(
			await migrate(
				db.sql,
				loadMigrations().filter((migration) => migration.version <= VERSION),
			),
		).toEqual({ applied: [VERSION] });
		expect(await editorState(db, "text-broken")).toBe("{not json");
	});

	test("projects, produced media and billing are kept", async () => {
		const db = await seeded();
		await migrate(db.sql, loadMigrations());
		expect(await ids(db, "content_projects")).toEqual([
			"image-1",
			"text-1",
			"text-broken",
			"video-1",
		]);
		expect(await ids(db, "run_artifact")).toEqual([
			"artifact-image-1",
			"artifact-text-1",
			"artifact-video-1",
		]);
		expect(await ids(db, "credit_transactions")).toEqual([
			"credit-image-1",
			"credit-text-1",
			"credit-video-1",
		]);
	});
});
