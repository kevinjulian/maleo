/* The project read returns the media library from its rows, and an editor-state
 * save cannot replace it (`p1-media-library`). Drives the real routes. */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { admitProjectMediaAsset } from "@maleo/db/project-media-assets";
import { registerProjectRoutes } from "./projects.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), "maleo-project-media-library.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	registerProjectRoutes(instance);
	return instance;
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
});
afterEach(async () => {
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

const asset = { id: "a", label: "a", url: "/api/media/a", kind: "image", source: "stock" } as const;
const libraryOf = async (server: Hono, id: string) =>
	((await (await server.request(`/projects/${id}`)).json()) as { mediaAssets: { id: string }[] })
		.mediaAssets;

test("the project read returns the library from rows", async () => {
	const id = (await createContentProject({ title: "Library" })).project.id;
	await admitProjectMediaAsset(id, asset);
	expect((await libraryOf(app(), id)).map((item) => item.id)).toEqual(["a"]);
});

test("an editor-state save with a media list leaves the library unchanged", async () => {
	const id = (await createContentProject({ title: "Library" })).project.id;
	await admitProjectMediaAsset(id, asset);
	const server = app();
	const res = await server.request(`/projects/${id}/editor-state`, {
		method: "PUT",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({
			editor_state: { chat: [], media_assets: [{ ...asset, id: "b", url: "/api/media/b" }] },
		}),
	});
	expect(res.status).toBe(200);
	expect((await libraryOf(server, id)).map((item) => item.id)).toEqual(["a"]);
});
