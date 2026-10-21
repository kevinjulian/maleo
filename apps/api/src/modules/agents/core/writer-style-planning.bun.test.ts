/* The workspace's writer style reaching story planning, and stopping there.
 *
 * The assertions that matter are the negative ones, as in `material-layers.bun.test.ts`:
 * a workspace that never chose a style must plan exactly as it did before this
 * existed, and a forbidden phrase must never cost an operator their plan. */
import { storyInputsOf } from "./story-inputs.ts";
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { putWorkspaceConfigText } from "@maleo/db/workspace-config";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	setStoryBibleAuthorForTests,
	setStoryPlannerForTests,
	type StoryPlanOpts,
} from "../../../lib/content-generator.ts";
import { redraftStoryPlanFlow } from "./services/planning.ts";
import { planStory } from "./__tests__/support/plan-story.ts";
import { getStoryPlan } from "./plan-state.ts";
import type { AgentJob } from "./model.ts";

const root = join(tmpdir(), `maleo-writer-style-${randomUUID().slice(0, 8)}`);
const dbPath = join(root, "maleo.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const priorDataDir = process.env.MALEO_DATA_DIR;

/** A workspace on disk, carrying the writer style key an operator chose (or none). */
async function workspaceNamed(name: string, writerStyle?: string): Promise<string> {
	await putWorkspaceConfigText(
		name,
		`name: ${name}\n${writerStyle ? `writer_style: ${writerStyle}\n` : ""}`,
	);
	return name;
}

function videoJob(projectId: string, brief: string, workspace?: string): AgentJob {
	return {
		id: `job-${randomUUID().slice(0, 8)}`,
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
		artifacts: fixtureArtifacts(projectId, [
			{
				kind: "research_bundle",
				payload: {
					topic: brief,
					sources: [
						{
							title: "Reference",
							url: "https://example.test/reference",
							excerpt: "A retrieved excerpt standing in for real research during tests.",
							retrievedAt: new Date(0).toISOString(),
						},
					],
					claimCount: 1,
				},
			},
		]),
		aspect: "9:16",
		brief,
		startedAt: Date.now(),
		// Skips the style-bible provider call, so planning stays offline.
		styleImageUrl: "/style.png",
		// Pre-seeded research artifact skips the live pass a factual brief would otherwise
		// trigger, which is what kept this suite offline and fast.
		workspace,
	};
}

/** Captures the options planning hands the planner, and narrates what it is told to. */
function capturingPlanner(narration: string) {
	const seen: StoryPlanOpts[] = [];
	setStoryPlannerForTests(async (_brief, _targetSec, opts) => {
		if (opts) seen.push(opts);
		return {
			planKind: "story" as const,
			sections: [
				{
					title: "One",
					narration,
					visualPrompt: "A wide establishing shot, no text",
					factual: false,
					sourceNotes: "",
				},
				{
					title: "Two",
					narration: "A clean second section with nothing banned in it.",
					visualPrompt: "A closer shot, no text",
					factual: false,
					sourceNotes: "",
				},
			],
			engagement: {
				premise: "p",
				hook: "h",
				tension: "t",
				escalation: "e",
				turn: "u",
				resolution: "r",
				emotionalArc: ["calm"],
				visualMotif: "m",
			},
			language: "en",
		};
	});
	return seen;
}

/* The data root is built once. Tearing it down per test meant every test paid to
 * recreate the database schema, which is what made this suite take sixteen seconds
 * for nine assertions. Workspaces are named per test, so they do not collide. */
beforeAll(() => {
	mkdirSync(root, { recursive: true });
	process.env.MALEO_DB_PATH = dbPath;
	process.env.MALEO_DATA_DIR = root;
});

/* Restored, never deleted. `scripts/test-db-guard.ts` points these at a per-run
 * temp dir precisely so a suite that clears them cannot fall back to the real
 * database; deleting them re-opens that hole, which is why the guard pins it. */
afterAll(async () => {
	await closeMaleoDb();
	rmSync(root, { recursive: true, force: true });
	if (priorDbPath !== undefined) process.env.MALEO_DB_PATH = priorDbPath;
	if (priorDataDir !== undefined) process.env.MALEO_DATA_DIR = priorDataDir;
});

beforeEach(() => {
	setStoryBibleAuthorForTests(async () => ({
		subjects: [{ id: "s", label: "subject" }],
		locations: [{ id: "l", label: "place" }],
		medium: "test medium",
		negatives: ["test negative"],
	}));
});

afterEach(() => {
	setStoryBibleAuthorForTests(null);
	setStoryPlannerForTests(null);
});

/** Plan at the flow's entry, the way its tool handler does. */
function planWithInputs(job: AgentJob, args: Parameters<typeof planStory>[1]) {
	return planStory(job, args);
}

describe("the workspace's writer style reaches planning", () => {
	test("a chosen style is handed to the planner", async () => {
		const seen = capturingPlanner("A plain section.");
		const workspace = await workspaceNamed("styled", "plainspoken_reportage");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(seen[0]?.writerStyle?.key).toBe("plainspoken_reportage");
	});

	/* Adopting the feature must not touch a workspace that never opted in. */
	test("a workspace with no style hands the planner none", async () => {
		const seen = capturingPlanner("A plain section.");
		const workspace = await workspaceNamed("plain");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(seen[0]?.writerStyle).toBeUndefined();
	});

	/* A retired key must not fail a plan — it degrades to no style. */
	test("a retired key plans without a style rather than failing", async () => {
		const seen = capturingPlanner("A plain section.");
		const workspace = await workspaceNamed("stale", "retired_profile");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const result = await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(seen[0]?.writerStyle).toBeUndefined();
		expect(result.note).toContain("Planned");
	});

	/* A workspace whose config does not exist is the common case in tests and on a
	 * fresh install. It must plan, not throw. */
	test("a missing workspace config plans without a style", async () => {
		const seen = capturingPlanner("A plain section.");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const result = await planWithInputs(videoJob(projectId, "How a lock works", "never-created"), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(seen[0]?.writerStyle).toBeUndefined();
		expect(result.note).toContain("Planned");
	});
});

describe("sentence density changes the word budget", () => {
	test("a dense style is given fewer words than a sparse one", async () => {
		const budgetFor = async (styleKey: string, name: string) => {
			const seen = capturingPlanner("A plain section.");
			const workspace = await workspaceNamed(name, styleKey);
			const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
			await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
				brief: "How a lock works",
				targetDurationSec: 300,
			});
			return seen[0]!.wordBudget!;
		};
		// procedural_precise is the densest profile, essayistic_reflective the sparsest.
		expect(await budgetFor("procedural_precise", "dense")).toBeLessThan(
			await budgetFor("essayistic_reflective", "sparse"),
		);
	});
});

describe("forbidden phrases are reported, never enforced", () => {
	test("a hit names the section and the phrase", async () => {
		capturingPlanner("Simply open the panel and the mechanism is exposed.");
		const workspace = await workspaceNamed("tutorial", "procedural_precise");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const result = await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(result.note).toContain("Writer style");
		expect(result.note).toContain("simply");
		expect(result.note).toContain("1:");
	});

	/* The whole point of warning rather than blocking: the plan still generates. */
	test("a hit leaves every section approvable", async () => {
		capturingPlanner("Simply open the panel and the mechanism is exposed.");
		const workspace = await workspaceNamed("tutorial", "procedural_precise");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const job = videoJob(projectId, "How a lock works", workspace);
		await planStory(job, { brief: "How a lock works", targetDurationSec: 120 });
		const plan = getStoryPlan(job);
		expect(plan?.sections.length).toBe(2);
		expect(plan?.sections.every((section) => section.status !== "failed")).toBe(true);
	});

	test("a revised draft reports its forbidden phrases without blocking", async () => {
		capturingPlanner("Open the panel. Seat the bracket. Tighten both screws.");
		const workspace = await workspaceNamed("revised-tutorial", "procedural_precise");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const job = videoJob(projectId, "How a lock works", workspace);
		await planStory(job, { brief: "How a lock works", targetDurationSec: 120 });

		capturingPlanner("Simply open the revised panel.");
		const result = await redraftStoryPlanFlow(
			job,
			"Make the instructions shorter.",
			storyInputsOf(job),
		);

		expect(result.note).toContain("Writer style");
		expect(result.note).toContain("simply");
		expect(getStoryPlan(job)?.sections.every((section) => section.status !== "failed")).toBe(true);
	});

	test("clean narration produces no warning", async () => {
		capturingPlanner("Open the panel. Seat the bracket. Tighten both screws.");
		const workspace = await workspaceNamed("tutorial", "procedural_precise");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const result = await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(result.note).not.toContain("Writer style");
	});

	test("no style means no scan at all", async () => {
		capturingPlanner("Simply open the panel and the mechanism is exposed.");
		const workspace = await workspaceNamed("plain");
		const projectId = (await createContentProject({ title: "Story", type: "video" })).project.id;
		const result = await planWithInputs(videoJob(projectId, "How a lock works", workspace), {
			brief: "How a lock works",
			targetDurationSec: 120,
		});
		expect(result.note).not.toContain("Writer style");
	});
});
