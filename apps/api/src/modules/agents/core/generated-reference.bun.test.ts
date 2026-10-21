import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { listProjectReferences } from "@maleo/db/references";
import {
	canonicalReferencePrompt,
	generatedReferenceId,
	upsertGeneratedReference,
} from "./generated-reference.ts";

const dbPath = join(tmpdir(), "maleo-generated-reference.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

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

describe("generated references", () => {
	test("uses a deterministic id before image generation has a url", () => {
		const id = generatedReferenceId({
			workspace: "default",
			role: "character",
			label: "POV manusia zaman batu",
			description: "Hands with stone tools.",
			purpose: "story-reference",
			key: "pov_protagonist",
		});

		expect(id).toBe(
			generatedReferenceId({
				workspace: " default ",
				role: "character",
				label: "pov manusia zaman batu",
				description: "Hands   with stone tools.",
				purpose: "story-reference",
				key: "pov_protagonist",
			}),
		);
	});

	test("creates one entity and one project attachment across retries", async () => {
		const projectId = (await createContentProject({ title: "POV", type: "video" })).project.id;
		const input = {
			projectId,
			key: "pov_protagonist",
			role: "character" as const,
			label: "POV manusia zaman batu",
			description: "First-person hands with rough hide wraps holding chipped stone tools.",
			visibilityMode: "hands_body" as const,
			purpose: "story-reference",
		};

		const first = await upsertGeneratedReference(input);
		const second = await upsertGeneratedReference({
			...input,
			canonicalImageUrl: "/uploads/pov.png",
		});

		expect(second.entity.id).toBe(first.entity.id);
		expect(second.entity.canonical_image_url).toBe("/uploads/pov.png");
		expect(
			(await listProjectReferences(projectId, { sceneKey: null })).map((row) => row.id),
		).toEqual([first.entity.id]);
	});

	test("canonical prompt respects POV visibility modes", () => {
		const base = { role: "character" as const, label: "POV", description: "Stone age survivor" };

		expect(canonicalReferencePrompt({ ...base, visibilityMode: "hands_body" })).toContain(
			"do not make a front-facing portrait",
		);
		expect(canonicalReferencePrompt({ ...base, visibilityMode: "reflection" })).toContain(
			"reflection",
		);
		expect(canonicalReferencePrompt({ ...base, visibilityMode: "face" })).toContain("portrait");
	});
});
