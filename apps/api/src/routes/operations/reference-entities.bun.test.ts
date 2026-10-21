import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import {
	getReferenceEntity,
	listProjectReferences,
	upsertReferenceEntity,
} from "@maleo/db/references";
import { registerReferenceRoutes } from "./references.ts";
import { workspaceScope } from "../../lib/active-workspace.ts";
import { installTestCaller } from "../../middleware/auth-testing.ts";

const dbPath = join(tmpdir(), "maleo-reference-entity-route.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

function app(): Hono {
	const instance = new Hono();
	instance.use("*", installTestCaller());
	instance.use("*", workspaceScope());
	registerReferenceRoutes(instance);
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

async function project(): Promise<string> {
	return (await createContentProject({ title: "roster test", type: "video" })).project.id;
}

async function entity(id: string, workspace = "default"): Promise<string> {
	const row = await upsertReferenceEntity({
		id,
		workspace,
		role: "character",
		label: id,
		origin: "linked",
	});
	if (!row) throw new Error(`could not create entity ${id}`);
	return row.id;
}

const json = { "content-type": "application/json" };
const attach = (server: Hono, projectId: string, entityId: string): Promise<Response> =>
	Promise.resolve(
		server.request(`/projects/${projectId}/reference-entities`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ entity_id: entityId }),
		}),
	);

describe("project reference entities (the roster)", () => {
	test("updates the canonical workspace entity, not an asset mirror", async () => {
		const server = app();
		const entityId = await entity("char-edit");
		const res = await server.request(`/reference-entities/${entityId}`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({
				role: "prop",
				label: "Hero mug",
				description: "Use when the hero mug is on the desk",
				imageUrl: "/mug.png",
				tags: ["prop", "ceramic"],
			}),
		});
		expect(res.status).toBe(200);
		const row = await getReferenceEntity(entityId);
		expect(row).toMatchObject({
			id: entityId,
			role: "prop",
			label: "Hero mug",
			description: "Use when the hero mug is on the desk",
			canonical_image_url: "/mug.png",
		});
	});

	test("deletes the canonical workspace entity and roster rows", async () => {
		const server = app();
		const projectId = await project();
		const entityId = await entity("char-delete");
		await attach(server, projectId, entityId);

		const res = await server.request(`/reference-entities/${entityId}`, { method: "DELETE" });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, removed: true });
		expect(await getReferenceEntity(entityId)).toBeNull();
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(0);
	});

	test("refuses to delete another workspace's entity", async () => {
		const server = app();
		const entityId = await entity("char-foreign-delete", "other-workspace");

		const res = await server.request(`/reference-entities/${entityId}`, { method: "DELETE" });
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ error: "cross_workspace_entity" });
		expect(await getReferenceEntity(entityId)).not.toBeNull();
	});

	test("attach is idempotent — attaching twice leaves one row", async () => {
		const server = app();
		const projectId = await project();
		const entityId = await entity("char-a");

		expect((await attach(server, projectId, entityId)).status).toBe(201);
		expect((await attach(server, projectId, entityId)).status).toBe(201);

		const listed = (await (
			await server.request(`/projects/${projectId}/reference-entities`)
		).json()) as { items: unknown[]; total: number };
		expect(listed.total).toBe(1);
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(1);
	});

	test("refuses an entity from another workspace, leaving the roster unchanged", async () => {
		const server = app();
		const projectId = await project();
		const foreign = await entity("char-foreign", "other-workspace");

		const response = await attach(server, projectId, foreign);
		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({ error: "cross_workspace_entity" });
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(0);
	});

	test("distinguishes an unknown project from an unknown entity", async () => {
		const server = app();
		const projectId = await project();
		expect((await attach(server, "no-such-project", await entity("char-b"))).status).toBe(404);
		expect(await (await attach(server, projectId, "no-such-entity")).json()).toEqual({
			error: "entity_not_found",
		});
		expect(
			(
				await server.request(`/projects/${projectId}/reference-entities`, {
					method: "POST",
					headers: json,
					body: JSON.stringify({}),
				})
			).status,
		).toBe(400);
	});

	test("detach reports removal, and detaching an unattached entity is not an error", async () => {
		const server = app();
		const projectId = await project();
		const entityId = await entity("char-c");
		await attach(server, projectId, entityId);

		const removed = await server.request(`/projects/${projectId}/reference-entities/${entityId}`, {
			method: "DELETE",
		});
		expect(removed.status).toBe(200);
		expect(await removed.json()).toEqual({ ok: true, removed: true });

		const again = await server.request(`/projects/${projectId}/reference-entities/${entityId}`, {
			method: "DELETE",
		});
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual({ ok: true, removed: false });
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(0);
	});

	test("setting a lead subject clears the previous one", async () => {
		const server = app();
		const projectId = await project();
		const first = await entity("char-lead");
		const second = await entity("char-second");
		await attach(server, projectId, first);
		await attach(server, projectId, second);

		const setPrimary = async (entityId: string | null): Promise<Response> =>
			await Promise.resolve(
				server.request(`/projects/${projectId}/reference-entities/primary`, {
					method: "PUT",
					headers: json,
					body: JSON.stringify({ entity_id: entityId }),
				}),
			);

		expect((await setPrimary(first)).status).toBe(200);
		expect(
			(await listProjectReferences(projectId, { sceneKey: null }))
				.filter((e) => e.is_primary === 1)
				.map((e) => e.id),
		).toEqual([first]);

		await setPrimary(second);
		const primaries = (await listProjectReferences(projectId, { sceneKey: null })).filter(
			(e) => e.is_primary === 1,
		);
		expect(primaries.map((e) => e.id)).toEqual([second]);

		await setPrimary(null);
		expect(
			(await listProjectReferences(projectId, { sceneKey: null })).filter(
				(e) => e.is_primary === 1,
			),
		).toHaveLength(0);
	});

	test("refuses a lead subject that is not on the roster", async () => {
		const server = app();
		const projectId = await project();
		const unattached = await entity("char-unattached");
		const response = await server.request(`/projects/${projectId}/reference-entities/primary`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({ entity_id: unattached }),
		});
		expect(response.status).toBe(409);
	});
});

describe("project notes (text-only, not reference entities)", () => {
	// The write path used to go through content_references with kind='note'. The
	// entity migration copied those rows into project_note and left the writer
	// behind, so a note created afterwards lived only in the legacy table.
	const put = (server: Hono, projectId: string, noteId: string, body: unknown): Promise<Response> =>
		Promise.resolve(
			server.request(`/projects/${projectId}/notes/${noteId}`, {
				method: "PUT",
				headers: json,
				body: JSON.stringify(body),
			}),
		);

	test("writes to the note store and reads back on the project", async () => {
		const server = app();
		const projectId = await project();
		const res = await put(server, projectId, "n1", {
			label: "Tone",
			body: "warm",
			tags: ["tone"],
			is_default: true,
		});
		expect(res.status).toBe(200);

		const notes = (await getContentProject(projectId))?.notes ?? [];
		expect(notes).toHaveLength(1);
		expect(notes[0]).toMatchObject({ id: "n1", label: "Tone", body: "warm", is_default: 1 });
		expect(notes[0]!.tags).toEqual(["tone"]);
		// The note store is the only place a note lives; content_references is gone.
		expect((await getContentProject(projectId))?.notes ?? []).toHaveLength(1);
	});

	test("upserts by id rather than accumulating rows", async () => {
		const server = app();
		const projectId = await project();
		await put(server, projectId, "n1", { label: "Tone", body: "warm" });
		await put(server, projectId, "n1", { label: "Tone", body: "colder", is_default: false });
		const notes = (await getContentProject(projectId))?.notes ?? [];
		expect(notes).toHaveLength(1);
		expect(notes[0]!.body).toBe("colder");
	});

	test("rejects a note with no label, and an unknown project", async () => {
		const server = app();
		expect((await put(server, await project(), "n1", { body: "no label" })).status).toBe(400);
		expect((await put(server, "no-such-project", "n1", { label: "Tone" })).status).toBe(404);
	});

	test("delete reports whether a row went", async () => {
		const server = app();
		const projectId = await project();
		await put(server, projectId, "n1", { label: "Tone", body: "warm" });
		const removed = await server.request(`/projects/${projectId}/notes/n1`, { method: "DELETE" });
		expect(await removed.json()).toEqual({ ok: true, removed: true });
		expect((await getContentProject(projectId))?.notes ?? []).toHaveLength(0);
	});
});

/* The wire seam was applied on reads and skipped on writes: attaching an entity
 * answered with the raw joined row — selection_id, is_primary as 0/1, tags_json,
 * canonical_image_url — while reading the same entity answered in the domain
 * shape. Nothing broke, because both web callers discard the response body; it
 * was a contract waiting for its first reader. */
describe("writes answer in the domain shape, not the row", () => {
	test("attaching an entity answers the way a read would", async () => {
		const server = app();
		const projectId = await project();
		const entityId = await entity("char-wire");

		const body = (await (await attach(server, projectId, entityId)).json()) as {
			reference: Record<string, unknown>;
		};

		expect(body.reference).toMatchObject({ id: entityId, role: "character", primary: false });
		for (const column of [
			"selection_id",
			"is_primary",
			"tags_json",
			"canonical_image_url",
			"project_id",
			"scene_key",
		]) {
			expect(body.reference).not.toHaveProperty(column);
		}
	});

	test("upserting a note answers the way a read would", async () => {
		const server = app();
		const projectId = await project();

		const res = await server.request(`/projects/${projectId}/notes/n-wire`, {
			method: "PUT",
			headers: json,
			body: JSON.stringify({
				label: "Tone",
				body: "keep it dry",
				tags: ["voice"],
				is_default: true,
			}),
		});
		const body = (await res.json()) as { note: Record<string, unknown> };

		expect(body.note).toMatchObject({
			id: "n-wire",
			label: "Tone",
			body: "keep it dry",
			isDefault: true,
		});
		expect(body.note).not.toHaveProperty("is_default");
		expect(body.note).not.toHaveProperty("project_id");
	});
});
