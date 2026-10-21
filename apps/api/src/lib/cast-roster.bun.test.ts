import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { buildAgentJob } from "../modules/agents/core/run-bracket.ts";
import { saveRun } from "../modules/agents/core/run-repository.ts";
import { runValidatedTool } from "../modules/agents/core/tool-executor.ts";
import { clearAgentJobsForTests } from "../modules/agents/core/session-store.ts";
import {
	projectRoster,
	setSceneFrameGeneratorForTests,
} from "../modules/agents/core/visual-gen.ts";
import { createContentProject } from "@maleo/db/project-detail";
import { addProjectReference, upsertReferenceEntity } from "@maleo/db/references";

beforeEach(() => {
	setSceneFrameGeneratorForTests(async () => "/uploads/frame.png");
});

afterEach(() => {
	setSceneFrameGeneratorForTests(null);
	clearAgentJobsForTests();
});

const F = (name: string) => `/api/image-gen/files/${name}`;

/* The cast comes from reference entities selected into the project. It used to be
 * built from content_references rows carrying the role in meta_json.tags. */
async function projectWithCast() {
	const project = await createContentProject({ title: "cast roster", type: "video" });
	const workspace = project.project.workspace;
	for (const [id, label, role] of [
		["man", "The Man", "character"],
		["woman", "The Woman", "character"],
		["look", "Look", "style"],
	] as const) {
		await upsertReferenceEntity({
			id,
			workspace,
			role,
			label,
			description: "",
			canonical_image_url: F(`${id}.png`),
			tags: [role],
		});
		await addProjectReference({ project_id: project.project.id, entity_id: id });
	}
	return project;
}

describe("projectRoster", () => {
	it("lists selectable subjects by logical id and excludes style", async () => {
		const project = await projectWithCast();
		// Order is not a contract: the roster is ordered by selection time, and
		// entities attached in the same millisecond tie.
		const roster = [...(await projectRoster(project.project.id))].sort((a, b) =>
			a.id.localeCompare(b.id),
		);
		expect(roster).toEqual([
			{ id: "man", label: "The Man", role: "character" },
			{ id: "woman", label: "The Woman", role: "character" },
		]);
	});

	it("is empty for a project with no references", async () => {
		const project = await createContentProject({ title: "bare", type: "video" });
		expect(await projectRoster(project.project.id)).toEqual([]);
	});
});

const seedScene = {
	name: "S0",
	durationSec: 3,
	shot: "Medium Shot",
	move: "Static",
	transition: "cut",
	visual: "intro",
	voiceover: "",
};

describe("add_scene refIds validation", () => {
	it("keeps known cast ids and drops unknown ones", async () => {
		const project = await projectWithCast();
		const job = await buildAgentJob({
			projectId: project.project.id,
			instruction: "edit: add a scene",
			contentType: "video",
			scenes: [seedScene],
		});
		await saveRun(job);
		await runValidatedTool(job, "add_scene", {
			name: "S1",
			visual: "man walks",
			voiceover: "",
			durationSec: 3,
			refIds: ["man", "ghost"],
		});
		expect(job.scenes.at(-1)?.refIds).toEqual(["man"]);
	});

	it("leaves refIds undefined when none are valid", async () => {
		const project = await projectWithCast();
		const job = await buildAgentJob({
			projectId: project.project.id,
			instruction: "edit: add a scene",
			contentType: "video",
			scenes: [seedScene],
		});
		await saveRun(job);
		await runValidatedTool(job, "add_scene", {
			name: "S1",
			visual: "empty",
			voiceover: "",
			durationSec: 3,
			refIds: ["ghost"],
		});
		expect(job.scenes.at(-1)?.refIds).toBeUndefined();
	});
});
