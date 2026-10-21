import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import {
	createContentProject,
	getContentProject,
	setContentEditorState,
} from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { getMediaObject } from "@maleo/db/media-objects";
import { imageGenRoutes } from "./image-gen.ts";

const oldBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
const oldDataDir = process.env.MALEO_DATA_DIR;
const oldDbPath = process.env.MALEO_DB_PATH;
let root: string | undefined;

afterEach(async () => {
	await closeMaleoDb();
	if (oldBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = oldBackend;
	process.env.MALEO_DATA_DIR = oldDataDir ?? join(tmpdir(), "maleo-test-data-fallback");
	if (oldDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = oldDbPath;
	if (root) await rm(root, { recursive: true, force: true });
});

test("project upload uses project owner despite active workspace mismatch and refuses non-members", async () => {
	root = await mkdtemp(join(tmpdir(), "maleo-image-upload-"));
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_DATA_DIR = root;
	process.env.MALEO_DB_PATH = join(root, "test.db");
	await closeMaleoDb();
	const db = openDb();
	for (const name of ["one", "two"]) {
		await db.run(
			`INSERT INTO workspaces (name, display_name, workspace_dir, created_at, updated_at)
			VALUES (?, ?, ?, 1, 1)`,
			[name, name, root],
		);
	}
	await addWorkspaceMember({ workspace: "one", user_id: "owner" }, db);
	await addWorkspaceMember({ workspace: "two", user_id: "stranger" }, db);
	const project = await createContentProject({ title: "test", workspace: "one" }, db);
	const app = imageGenRoutes();
	const upload = (userId: string) => {
		const body = new FormData();
		body.set("project_id", project.project.id);
		body.set("file", new File(["image bytes"], "test.png", { type: "image/png" }));
		return app.fetch(
			new Request("http://api.test/upload?workspace=two", { method: "POST", body }),
			{
				caller: { userId, email: `${userId}@test.local`, role: "member" },
			},
		);
	};
	const denied = await upload("stranger");
	expect(denied.status).toBe(400);
	expect((await db.get<{ n: number }>(`SELECT count(*) AS n FROM media_objects`))?.n).toBe(0);
	const allowed = await upload("owner");
	expect(allowed.status).toBe(200);
	const payload = (await allowed.json()) as { url: string };
	expect(payload.url).toMatch(/^\/api\/media\/[0-9a-f-]+$/);
	expect((await getMediaObject(payload.url.split("/").at(-1)!, db))?.workspace).toBe("one");
	await setContentEditorState(project.project.id, { library: [{ url: payload.url }] }, db);
	await addContentStoryboard(
		{
			project_id: project.project.id,
			storyboard_json: { timeline: { clips: [{ src: payload.url }] } },
		},
		db,
	);
	// Read back through the runtime: the rows are in the database, not a cache.
	const reloaded = await getContentProject(project.project.id, openDb());
	expect(reloaded?.project.editor_state_json).toEqual({ library: [{ url: payload.url }] });
	expect(reloaded?.storyboards[0]?.storyboard_json).toEqual({
		timeline: { clips: [{ src: payload.url }] },
	});
	expect(JSON.stringify(reloaded)).not.toContain("signature=");
});
