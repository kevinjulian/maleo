/* Creating a project carries its roster across the wire.
 *
 * The client sent the selected references on POST /projects and the route never
 * declared the field, so it was discarded — every new project loaded with an
 * empty roster, and a roster of 0 attaches nothing to a scene, so generation ran
 * refless without saying so. Nothing failed: the client's payload type and the
 * route's body type were declared independently and never compared.
 *
 * These drive the real route so the contract is asserted where it broke, rather
 * than one layer below it. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { getContentProject } from "@maleo/db/project-detail";
import { listContentProjects } from "@maleo/db/content-projects";
import { upsertReferenceEntity } from "@maleo/db/references";
import { registerProjectRoutes } from "./projects.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), "maleo-project-create-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	// The real operations app resolves the tenant ahead of every handler. Mounting
	// it here too keeps these driving the route as it is actually wired, rather
	// than a version of it with no workspace.
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

const json = { "content-type": "application/json" };

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

describe("POST /projects seeds the roster", () => {
	test("the entities the client selected are attached", async () => {
		const server = app();
		await upsertReferenceEntity({
			id: "anna",
			workspace: "default",
			role: "character",
			label: "Anna",
		});
		await upsertReferenceEntity({ id: "mug", workspace: "default", role: "prop", label: "Mug" });

		const id = await create(server, {
			title: "Has a roster",
			type: "video",
			reference_entity_ids: ["anna", "mug"],
			lead_entity_id: "anna",
		});

		const detail = (await getContentProject(id))!;
		expect(detail.entities.map((e) => e.id).sort()).toEqual(["anna", "mug"]);
		expect(detail.entities.filter((e) => e.is_primary === 1).map((e) => e.id)).toEqual(["anna"]);
	});

	test("a project created without references still has an empty roster", async () => {
		const server = app();

		const id = await create(server, { title: "No references", type: "video" });

		expect((await getContentProject(id))!.entities).toEqual([]);
	});

	test("a non-array field is ignored rather than crashing the create", async () => {
		const server = app();

		const id = await create(server, {
			title: "Junk roster",
			type: "video",
			reference_entity_ids: "anna",
		});

		expect((await getContentProject(id))!.entities).toEqual([]);
	});
});

/* Image and text projects are retired: existing ones still load and edit by
 * hand, but nothing new of either type may be created, and no project may be
 * turned into one. */
describe("only video projects can be created", () => {
	for (const type of ["image", "text"]) {
		test(`POST /projects refuses type ${type} and stores nothing`, async () => {
			const server = app();
			const res = await server.request("/projects", {
				method: "POST",
				headers: json,
				body: JSON.stringify({ title: "Retired", type }),
			});
			expect(res.status).toBe(400);
			expect(JSON.stringify(await res.json())).toContain("video");
			expect(await listContentProjects({ workspace: "default" })).toEqual([]);
		});

		test(`PUT /projects/:id refuses retyping to ${type}`, async () => {
			const server = app();
			const id = await create(server, { title: "Stays video", type: "video" });
			const res = await server.request(`/projects/${id}`, {
				method: "PUT",
				headers: json,
				body: JSON.stringify({ type }),
			});
			expect(res.status).toBe(400);
			expect((await getContentProject(id))!.project.type).toBe("video");
		});
	}

	test("a project created without a type is video", async () => {
		const id = await create(app(), { title: "Default type" });
		expect((await getContentProject(id))!.project.type).toBe("video");
	});
});
