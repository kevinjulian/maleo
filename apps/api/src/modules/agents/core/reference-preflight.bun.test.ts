/* Repair first, then block.
 *
 * Projects written before the lock and the roster were saved together can hold
 * drift the operator never caused. Blocking them without repairing them would
 * take projects that generate the wrong pictures and turn them into projects
 * that generate nothing — a worse outcome, delivered by the fix.
 *
 * So the preflight reconciles what is attachable and blocks only on what is
 * not: an entity that no longer exists, or one belonging to another workspace. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { createContentProject } from "@maleo/db/project-detail";
import {
	addProjectReference,
	listProjectReferences,
	upsertReferenceEntity,
} from "@maleo/db/references";
import { readStoryboardDocument, writeStoryboardDocument } from "@maleo/shared";
import { preflightProjectReferences } from "./reference-preflight.ts";
import type { AgentJob } from "./model.ts";

const dbPath = join(tmpdir(), "maleo-reference-preflight.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

const STICKMAN = "r1783177064445p83";

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
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

async function entity(id: string, workspace = "default"): Promise<void> {
	await upsertReferenceEntity({
		id,
		workspace,
		role: "character",
		label: id,
		canonical_image_url: `/api/image-gen/files/${id}.png`,
		origin: "linked",
	});
}

/** A project whose document locks `entityIds` while the roster holds `attach`.
 *  Written through the DB directly, because the routes now refuse to produce
 *  this shape — it is what already exists in the database, not what is made. */
async function driftedProject(entityIds: string[], attach: string[]): Promise<string> {
	const projectId = (await createContentProject({ title: "drifted", type: "video" })).project.id;
	for (const id of attach) await addProjectReference({ project_id: projectId, entity_id: id });
	await addContentStoryboard({
		project_id: projectId,
		source_prompt: null,
		reference_notes: null,
		status: "draft",
		storyboard_json: writeStoryboardDocument({
			...readStoryboardDocument(undefined).doc,
			projectReferences: { prompt: "", entityIds },
		}) as Record<string, unknown>,
	});
	return projectId;
}

function job(
	projectId: string,
	projectRefIds: string[],
	scenes: Array<{ sceneKey: string; refIds?: string[] }> = [],
): AgentJob {
	return { projectId, projectRefIds, scenes, events: [] } as unknown as AgentJob;
}

async function rosterIds(projectId: string): Promise<string[]> {
	return (await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id).sort();
}

describe("reconciling legacy drift", () => {
	test("attaches a locked reference the project never attached, and passes", async () => {
		// The Lidiman shape, as it already sits in the database.
		await entity("pria");
		await entity("sketch-env-1");
		await entity(STICKMAN);
		const projectId = await driftedProject(
			["pria", "sketch-env-1", STICKMAN],
			["pria", "sketch-env-1"],
		);
		expect(await rosterIds(projectId)).not.toContain(STICKMAN);

		const preflight = await preflightProjectReferences(
			job(projectId, ["pria", "sketch-env-1", STICKMAN]),
		);

		expect(preflight.ok).toBe(true);
		expect(preflight.reconciled).toContain(STICKMAN);
		expect(await rosterIds(projectId)).toContain(STICKMAN);
	});

	test("is idempotent — a second pass reconciles nothing and still passes", async () => {
		await entity(STICKMAN);
		const projectId = await driftedProject([STICKMAN], []);

		await preflightProjectReferences(job(projectId, [STICKMAN]));
		const second = await preflightProjectReferences(job(projectId, [STICKMAN]));

		expect(second.ok).toBe(true);
		expect(second.reconciled).toEqual([]);
		expect(await listProjectReferences(projectId, { sceneKey: null })).toHaveLength(1);
	});

	test("a project with no drift is left alone", async () => {
		await entity("pria");
		const projectId = await driftedProject(["pria"], ["pria"]);

		const preflight = await preflightProjectReferences(job(projectId, ["pria"]));

		expect(preflight).toEqual({ ok: true, unresolved: [], reconciled: [] });
	});
});

describe("blocking what reconciliation cannot repair", () => {
	test("an id naming no entity blocks, and says why", async () => {
		await entity("pria");
		const projectId = await driftedProject(["pria", "deleted-entity"], ["pria"]);

		const preflight = await preflightProjectReferences(
			job(projectId, [], [{ sceneKey: "s1", refIds: ["deleted-entity"] }]),
		);

		expect(preflight.ok).toBe(false);
		expect(preflight.unresolved).toEqual([
			{ entityId: "deleted-entity", reason: "unknown_entity", sceneKey: "s1" },
		]);
	});

	test("an id from another workspace blocks as cross-workspace", async () => {
		await entity("mine");
		await entity("theirs", "other-workspace");
		const projectId = await driftedProject(["mine", "theirs"], ["mine"]);

		const preflight = await preflightProjectReferences(
			job(projectId, [], [{ sceneKey: "s1", refIds: ["theirs"] }]),
		);

		expect(preflight.ok).toBe(false);
		expect(preflight.unresolved.map((u) => u.reason)).toEqual(["cross_workspace"]);
		// Refused, not attached — a project may only select from its own library.
		expect(await rosterIds(projectId)).toEqual(["mine"]);
	});

	test("a scene cast id is checked too, and named with its scene", async () => {
		await entity("pria");
		const projectId = await driftedProject(["pria"], ["pria"]);

		const preflight = await preflightProjectReferences(
			job(projectId, ["pria"], [{ sceneKey: "s2", refIds: ["ghost"] }]),
		);

		expect(preflight.ok).toBe(false);
		expect(preflight.unresolved).toEqual([
			{ entityId: "ghost", reason: "unknown_entity", sceneKey: "s2" },
		]);
	});

	test("an unrelated roster entry is never substituted for the missing id", async () => {
		await entity("on-roster");
		const projectId = await driftedProject(["gone"], ["on-roster"]);

		const preflight = await preflightProjectReferences(
			job(projectId, [], [{ sceneKey: "s1", refIds: ["gone"] }]),
		);

		expect(preflight.ok).toBe(false);
		expect(preflight.unresolved.map((u) => u.entityId)).toEqual(["gone"]);
		expect(await rosterIds(projectId)).toEqual(["on-roster"]);
	});

	test("a project with no selection at all passes", async () => {
		const projectId = await driftedProject([], []);

		expect((await preflightProjectReferences(job(projectId, []))).ok).toBe(true);
	});
});
