import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { listProjectReferences } from "@maleo/db/references";
import { setSceneFrameGeneratorForTests } from "../../visual-gen.ts";
import { createCharacter } from "./create-character.ts";
import type { AgentJob } from "../../model.ts";

const dbPath = join(tmpdir(), "maleo-create-character.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

beforeEach(async () => {
	process.env.MALEO_DB_PATH = dbPath;
	await resetDb();
	setSceneFrameGeneratorForTests(async () => "/uploads/character.png");
});

afterEach(async () => {
	setSceneFrameGeneratorForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

function job(projectId: string): AgentJob {
	return {
		id: "job-create-character",
		projectId,
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],

		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "story",
		styleImageUrl: "/style.png",
		startedAt: Date.now(),
	};
}

describe("create_character", () => {
	test("repeated calls attach one durable generated reference", async () => {
		const projectId = (await createContentProject({ title: "Characters", type: "video" })).project
			.id;
		const state = job(projectId);
		const args = { name: "Tetua Gua", description: "Older tribe member with ash markings." };
		const handler = createCharacter.handler;
		if (!handler) throw new Error("create_character handler missing");

		await handler({ job: state, helpers: {} as never }, args);
		await handler({ job: state, helpers: {} as never }, args);

		const refs = await listProjectReferences(projectId, { sceneKey: null });
		expect(refs).toHaveLength(1);
		expect(state.characters.map((character) => character.id)).toEqual([refs[0]!.id, refs[0]!.id]);
		expect(refs[0]!.canonical_image_url).toBe("/uploads/character.png");
	});
});
