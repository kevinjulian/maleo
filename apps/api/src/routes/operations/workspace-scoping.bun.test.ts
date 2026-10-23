/* The content path and the catalogue show ONE workspace's work.
 *
 * These drive the real routes through the same middleware the app mounts,
 * because the defect these close was never in an accessor: `listContentFeed`
 * had no workspace parameter at all, and `listContentCatalogueImages` iterated
 * every workspace on disk. Both read correctly at the SQL level and returned
 * every tenant's work at the HTTP level.
 *
 * The negative assertions carry the weight. A scoped surface that returns the
 * right rows is only half the property — the other half is that another
 * workspace's rows are absent, rather than filtered out later or deduped away. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { upsertContentAsset } from "@maleo/db/assets";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { scaffoldWorkspace } from "../../lib/workspace/scaffold.ts";
import { projectWorkspaceScope, workspaceScope } from "../../lib/active-workspace.ts";
import { registerAssetRoutes } from "./assets.ts";
import { registerProjectRoutes } from "./projects.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;
let dataDir = "";

const json = { "content-type": "application/json" };

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	instance.use("/projects/:id/*", projectWorkspaceScope());
	instance.use("/projects/:id", projectWorkspaceScope());
	registerProjectRoutes(instance);
	registerAssetRoutes(instance);
	return instance;
}

beforeEach(async () => {
	dataDir = mkdtempSync(join(tmpdir(), "maleo-scoping-"));
	process.env.MALEO_DATA_DIR = dataDir;
	process.env.MALEO_DB_PATH = join(dataDir, "test.db");
	await closeMaleoDb();
	await scaffoldWorkspace("veronika");
	await scaffoldWorkspace("kunti");
});

afterEach(async () => {
	await closeMaleoDb();
	rmSync(dataDir, { recursive: true, force: true });
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
	// Restored, never deleted: MALEO_DATA_DIR is the floor that keeps a suite
	// which clears MALEO_DB_PATH off the real database. See
	// scripts/test-db-guard.ts.
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

describe("the content feed shows one workspace's projects", () => {
	test("sorts only authorized workspace records and rejects unknown sort", async () => {
		await createContentProject({ title: "Zebra", workspace: "veronika" });
		await createContentProject({ title: "Alpha", workspace: "veronika" });
		await createContentProject({ title: "Aardvark", workspace: "kunti" });
		const res = await app().request("/content/feed?workspace=veronika&sort=name&limit=1");
		expect((await res.json()) as { items: Array<{ title: string }>; total: number }).toMatchObject({
			items: [{ title: "Alpha" }],
			total: 2,
		});
		expect((await app().request("/content/feed?workspace=veronika&sort=invalid")).status).toBe(400);
	});
	test("another workspace's projects are absent, not merely ordered later", async () => {
		await createContentProject({ title: "Veronika's", workspace: "veronika" });
		await createContentProject({ title: "Kunti's", workspace: "kunti" });

		const res = await app().request("/content/feed?workspace=veronika");
		const body = (await res.json()) as { items: Array<{ title: string }>; total: number };

		expect(body.items.map((i) => i.title)).toEqual(["Veronika's"]);
		// The total drives pagination. A scoped page with an unscoped total pages
		// through rows the operator can never be shown.
		expect(body.total).toBe(1);
	});

	test("the platform facet does not offer another workspace's platforms", async () => {
		await createContentProject({ title: "Theirs", workspace: "kunti", target_platform: "tiktok" });
		await createContentProject({
			title: "Mine",
			workspace: "veronika",
			target_platform: "youtube",
		});

		const res = await app().request("/content/feed?workspace=veronika");

		expect(((await res.json()) as { facets: { platforms: string[] } }).facets.platforms).toEqual([
			"youtube",
		]);
	});
});

describe("a created project joins the active workspace", () => {
	test("the tenant comes from the request, not the body", async () => {
		const res = await app().request("/projects?workspace=veronika", {
			method: "POST",
			headers: json,
			// A body-supplied workspace must not decide the tenant: one place names
			// it, and this is not that place.
			body: JSON.stringify({ title: "New", type: "video", workspace: "kunti" }),
		});

		expect(res.status).toBe(201);
		const id = ((await res.json()) as { project: { project: { id: string } } }).project.project.id;
		expect((await getContentProject(id))!.project.workspace).toBe("veronika");
	});

	test("it then appears in its own workspace's feed and no other", async () => {
		await app().request("/projects?workspace=veronika", {
			method: "POST",
			headers: json,
			body: JSON.stringify({ title: "New", type: "video" }),
		});

		const mine = (await (await app().request("/content/feed?workspace=veronika")).json()) as {
			total: number;
		};
		const theirs = (await (await app().request("/content/feed?workspace=kunti")).json()) as {
			total: number;
		};

		expect(mine.total).toBe(1);
		expect(theirs.total).toBe(0);
	});
});

describe("the catalogue serves one tenant", () => {
	async function asset(workspace: string, label: string): Promise<void> {
		await upsertContentAsset({
			scope: "workspace",
			workspace,
			kind: "style",
			label,
			tags: ["style"],
			seed: 1,
			default: false,
			src: `/uploads/${label}.png`,
			source_type: "reference",
			source_ref: label,
		});
	}

	test("another workspace's reference images are absent", async () => {
		await asset("veronika", "mine");
		await asset("kunti", "theirs");

		const res = await app().request("/catalogue?workspace=veronika");
		const body = (await res.json()) as { images: Array<{ label: string }> };

		expect(body.images.map((i) => i.label)).toEqual(["mine"]);
	});

	test("an identically-labelled image in another workspace is excluded, not deduped away", async () => {
		// Same label and kind in both workspaces. The catalogue dedupes on a key
		// built from those, so a leak here would silently return ONE image and look
		// like correct deduplication rather than a cross-tenant read.
		await asset("veronika", "portrait");
		await asset("kunti", "portrait");

		const res = await app().request("/catalogue?workspace=kunti");
		const body = (await res.json()) as { images: Array<{ label: string; workspace: string }> };

		expect(body.images.map((i) => i.workspace)).toEqual(["kunti"]);
	});
});

describe("an unregistered workspace never reaches an accessor", () => {
	test("the feed refuses it rather than serving default's projects", async () => {
		await createContentProject({ title: "Default's", workspace: "default" });

		const res = await app().request("/content/feed?workspace=veronikaa");

		expect(res.status).toBe(400);
	});
});

describe("a project is reachable only from its own workspace", () => {
	test("read, edit and editor-state writes from another workspace find nothing", async () => {
		const theirs = (await createContentProject({ title: "Kunti's", workspace: "kunti" }))!;
		const id = theirs.project.id;
		const refused = { error: "project_not_found" };
		const read = await app().request(`/projects/${id}?workspace=veronika`);
		expect(read.status).toBe(404);
		expect(await read.json()).toEqual(refused);
		const edit = await app().request(`/projects/${id}?workspace=veronika`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ title: "Taken" }),
		});
		expect(edit.status).toBe(404);
		const state = await app().request(`/projects/${id}/editor-state?workspace=veronika`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ editor_state: { media_assets: [] } }),
		});
		expect(state.status).toBe(404);
		const after = (await getContentProject(id))!.project;
		expect(after.title).toBe("Kunti's");
		expect(after.editor_state_json).toBeNull();
		// Its own workspace still reads it.
		expect((await app().request(`/projects/${id}?workspace=kunti`)).status).toBe(200);
	});
});
