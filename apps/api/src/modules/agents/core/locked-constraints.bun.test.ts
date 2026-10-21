/* Locked constraints reach the generators that could contradict them.
 *
 * The failing prompt held two layers arguing with each other: operator/preset
 * text said "only sketch stickman" and "no human presence", while generated
 * scene and style text asked for prehistoric people and cinematic
 * paleo-realism. The contradiction was not a wording problem — the style bible
 * and the section planner had simply never been told what they must not
 * contradict, and the compiler downstream was left choosing between them.
 *
 * Catching it downstream would mean keyword-matching generated prose and
 * deleting it on a guess. These assert the constraints arrive upstream instead,
 * where the prose is written. */
import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { addProjectReference, upsertReferenceEntity } from "@maleo/db/references";
import {
	generateStyleBible,
	planStorySections,
	setStyleBibleGeneratorForTests,
	setStoryPlannerForTests,
	type LockedVisualConstraints,
} from "../../../lib/content-generator.ts";
import { lockedConstraintsFor } from "./visual-gen.ts";
import type { AgentJob } from "./model.ts";

const dbPath = join(tmpdir(), "maleo-locked-constraints.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;

async function resetDb(): Promise<void> {
	await closeMaleoDb();
	for (const suffix of ["", "-shm", "-wal"]) rmSync(`${dbPath}${suffix}`, { force: true });
}

afterEach(async () => {
	setStyleBibleGeneratorForTests(null);
	setStoryPlannerForTests(null);
	await resetDb();
	if (priorDbPath === undefined) delete process.env.MALEO_DB_PATH;
	else process.env.MALEO_DB_PATH = priorDbPath;
});

const SKETCH_ONLY = "Only sketch stickman figures, hand-drawn line art.";
const NO_HUMANS = "No human presence in any frame.";

describe("collecting the constraints from a project", () => {
	test("carries Visual material, Rules, and the roster's reference traits", async () => {
		process.env.MALEO_DB_PATH = dbPath;
		await resetDb();
		const project = await createContentProject({ title: "Lidiman", type: "video" });
		await upsertReferenceEntity({
			id: "r-stickman",
			workspace: project.project.workspace,
			role: "character",
			label: "Sketch Stickman",
			description: "a hand-drawn stick figure",
			canonical_image_url: "/api/image-gen/files/stickman.png",
		});
		await addProjectReference({ project_id: project.project.id, entity_id: "r-stickman" });

		const job = {
			projectId: project.project.id,
			direction: { raw: "", story: "", visual: SKETCH_ONLY, voice: "", rules: NO_HUMANS },
			events: [],
		} as unknown as AgentJob;

		expect(await lockedConstraintsFor(job)).toEqual({
			visual: SKETCH_ONLY,
			rules: NO_HUMANS,
			references: [{ label: "Sketch Stickman", description: "a hand-drawn stick figure" }],
		});
	});

	test("a project with no references and no materials yields empty constraints", async () => {
		process.env.MALEO_DB_PATH = dbPath;
		await resetDb();
		const project = await createContentProject({ title: "Bare", type: "video" });
		const job = { projectId: project.project.id, events: [] } as unknown as AgentJob;

		expect(await lockedConstraintsFor(job)).toEqual({
			visual: undefined,
			rules: undefined,
			references: [],
		});
	});
});

describe("the style bible generator is told what it may not contradict", () => {
	const locked: LockedVisualConstraints = {
		visual: SKETCH_ONLY,
		rules: NO_HUMANS,
		references: [{ label: "Sketch Stickman", description: "a hand-drawn stick figure" }],
	};

	test("the constraints reach the generator", async () => {
		let received: LockedVisualConstraints | undefined;
		setStyleBibleGeneratorForTests(async (_brief, passed) => {
			received = passed;
			return "line art, flat ink, no shading";
		});

		await generateStyleBible("the story of fire", locked);

		expect(received).toEqual(locked);
	});

	test("without constraints the generator is given none, not a stale set", async () => {
		let received: LockedVisualConstraints | undefined = locked;
		setStyleBibleGeneratorForTests(async (_brief, passed) => {
			received = passed;
			return "anything";
		});

		await generateStyleBible("the story of fire");

		expect(received).toBeUndefined();
	});
});

describe("the section planner is told what it may not contradict", () => {
	test("the constraints reach the planner", async () => {
		const locked: LockedVisualConstraints = {
			visual: SKETCH_ONLY,
			rules: NO_HUMANS,
			references: [],
		};
		let received: LockedVisualConstraints | undefined;
		setStoryPlannerForTests(async (_brief, _target, opts) => {
			received = opts?.locked;
			return {
				planKind: "story",
				sections: [
					{
						title: "Fire",
						narration: "A short section about fire.",
						visualPrompt: "small fire in a dark cave",
					},
				],
			};
		});

		await planStorySections("the story of fire", 120, { locked });

		expect(received).toEqual(locked);
	});
});
