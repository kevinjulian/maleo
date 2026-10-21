/* A preset's selected references reach the roster, not just the document.
 *
 * The failing project was created from Project Preset `Lidiman`. Its Project
 * Materials selected `Sketch Stickman` (`r1783177064445p83`), the document said
 * so, and `project_reference` attached only `Pria` and `Sketch Env #1`.
 * Generation resolves ids through the roster, so the reference the operator
 * chose could not resolve and the images came back without it.
 *
 * The mechanism was that a preset seeds `storyboard.projectReferences` — the
 * generation lock — while the creation form sends its own `pool` as
 * `reference_entity_ids`. A preset never populates the pool, so the two stores
 * disagreed from the project's first write. These drive the real routes, since
 * the routes are where the two stores are now written together. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { getContentProject } from "@maleo/db/project-detail";
import { listProjectReferences, upsertReferenceEntity } from "@maleo/db/references";
import { writeStoryboardDocument, readStoryboardDocument } from "@maleo/shared";
import { registerProjectRoutes } from "./projects.ts";
import { registerStoryboardRoutes } from "./storyboards.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), "maleo-preset-roster-sync.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

const STICKMAN = "r1783177064445p83";

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	registerProjectRoutes(instance);
	registerStoryboardRoutes(instance);
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

const json = { "content-type": "application/json" };

async function entity(id: string, label: string, workspace = "default"): Promise<void> {
	await upsertReferenceEntity({
		id,
		workspace,
		role: "character",
		label,
		canonical_image_url: `https://cdn.example.com/${id}.png`,
		origin: "linked",
	});
}

/** What a Project Preset seeds: a document whose lock names its references. */
function presetDocument(entityIds: string[]): unknown {
	return writeStoryboardDocument({
		...readStoryboardDocument(undefined).doc,
		projectReferences: { prompt: "", entityIds },
	});
}

async function create(server: Hono, body: Record<string, unknown>): Promise<string> {
	const res = await server.request("/projects", {
		method: "POST",
		headers: json,
		body: JSON.stringify(body),
	});
	expect(res.status).toBe(201);
	const payload = (await res.json()) as { project: { project: { id: string } } };
	return payload.project.project.id;
}

function saveDocument(server: Hono, projectId: string, entityIds: string[]): Promise<Response> {
	return Promise.resolve(
		server.request(`/projects/${projectId}/storyboards`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ storyboard_json: presetDocument(entityIds) }),
		}),
	);
}

async function rosterIds(projectId: string): Promise<string[]> {
	return (await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id).sort();
}

describe("creating a project from a preset", () => {
	test("attaches the references the preset selected, with an empty form pool", async () => {
		const server = app();
		await entity("pria", "Pria");
		await entity("sketch-env-1", "Sketch Env #1");
		await entity(STICKMAN, "Sketch Stickman");

		// The Lidiman shape exactly: the preset seeds the lock, the form pool is
		// empty because a preset never fills it.
		const id = await create(server, {
			title: "Lidiman project",
			type: "video",
			reference_entity_ids: [],
			seed_storyboard: {
				status: "draft",
				storyboard_json: presetDocument(["pria", "sketch-env-1", STICKMAN]),
			},
		});

		expect(await rosterIds(id)).toEqual([STICKMAN, "pria", "sketch-env-1"].sort());
		expect((await getContentProject(id))!.entities.map((e) => e.id)).toContain(STICKMAN);
	});

	test("unions the form pool with the preset lock rather than replacing it", async () => {
		const server = app();
		await entity("from-pool", "From Pool");
		await entity(STICKMAN, "Sketch Stickman");

		const id = await create(server, {
			title: "Both sources",
			type: "video",
			reference_entity_ids: ["from-pool"],
			seed_storyboard: { status: "draft", storyboard_json: presetDocument([STICKMAN]) },
		});

		expect(await rosterIds(id)).toEqual([STICKMAN, "from-pool"].sort());
	});

	test("a preset naming another workspace's entity does not attach it", async () => {
		const server = app();
		await entity("mine", "Mine");
		await entity("theirs", "Theirs", "other-workspace");

		const id = await create(server, {
			title: "Cross workspace preset",
			type: "video",
			seed_storyboard: { status: "draft", storyboard_json: presetDocument(["mine", "theirs"]) },
		});

		expect(await rosterIds(id)).toEqual(["mine"]);
	});
});

describe("applying a preset in the editor", () => {
	test("saving the document attaches the newly selected references", async () => {
		const server = app();
		await entity("pria", "Pria");
		await entity(STICKMAN, "Sketch Stickman");
		const id = await create(server, {
			title: "Editor preset change",
			type: "video",
			reference_entity_ids: ["pria"],
		});
		expect(await rosterIds(id)).toEqual(["pria"]);

		const res = await saveDocument(server, id, ["pria", STICKMAN]);

		expect(res.status).toBe(201);
		expect(await rosterIds(id)).toEqual([STICKMAN, "pria"].sort());
	});

	test("re-applying the same preset leaves one roster row per entity", async () => {
		const server = app();
		await entity(STICKMAN, "Sketch Stickman");
		const id = await create(server, { title: "Idempotent", type: "video" });

		await saveDocument(server, id, [STICKMAN]);
		await saveDocument(server, id, [STICKMAN]);
		await saveDocument(server, id, [STICKMAN]);

		expect(await listProjectReferences(id, { sceneKey: null })).toHaveLength(1);
	});

	test("an unresolvable selected id is reported rather than silently saved", async () => {
		const server = app();
		await entity("pria", "Pria");
		await entity("theirs", "Theirs", "other-workspace");
		const id = await create(server, { title: "Reports unresolved", type: "video" });

		const res = await saveDocument(server, id, ["pria", "theirs", "never-existed"]);
		const body = (await res.json()) as { references: { attached: string[]; unresolved: string[] } };

		expect(body.references.attached).toEqual(["pria"]);
		expect(body.references.unresolved.sort()).toEqual(["never-existed", "theirs"]);
		expect(await rosterIds(id)).toEqual(["pria"]);
	});

	test("a document that selects nothing does not detach the existing roster", async () => {
		const server = app();
		await entity("pria", "Pria");
		const id = await create(server, {
			title: "No detach",
			type: "video",
			reference_entity_ids: ["pria"],
		});

		await saveDocument(server, id, []);

		// Attaching is this route's job; detaching stays an explicit operator
		// action through DELETE /projects/:id/reference-entities/:entityId.
		expect(await rosterIds(id)).toEqual(["pria"]);
	});
});
