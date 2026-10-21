/* adopt-mastra-internal-agent 2.3: the existing-edit gate as a domain
 * precondition. The agent may choose any tool; the tool decides whether the
 * effect may happen. Generation and re-planning moved to their workflows
 * (story-assets.bun.test.ts). Real suspend/resume through a Mastra instance. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import type { AgentJob } from "../../../model.ts";
import { runState } from "../../run-state.ts";
import { answer, callTool } from "../support/scripted-model.ts";
import { conversation } from "../support/conversation.ts";
import { installStoryProviders, removeStoryProviders } from "../support/story-fixture.ts";
import { SAVED_SCENE, savedVideoProject } from "../support/video-fixture.ts";
import type { AgentScene } from "../../../model.ts";

/** A run on a video project, optionally holding a saved timeline of `scenes`. */
async function runOn(
	prepare?: (job: AgentJob) => void | Promise<void>,
	scenes?: AgentScene[],
): Promise<AgentJob> {
	const projectId = scenes
		? await savedVideoProject("Preconditions", scenes)
		: (await createContentProject({ title: "Preconditions", type: "video" })).project.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "go",
		brief: "a lighthouse keeper's last night",
		contentType: "video",
	});
	runState(job).instruction = "go";
	await prepare?.(job);
	await saveRun(job);
	return job;
}

const lastQuestion = (job: AgentJob) =>
	job.events.filter((event) => event.kind === "question").at(-1);

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	installStoryProviders();
});
afterEach(() => removeStoryProviders());
afterAll(async () => {
	await closeMaleoDb();
});

describe("editing existing work", () => {
	// A finished scene: a build that leaves a frameless scene is held back by the finish gate.
	const saved: AgentScene[] = [{ ...SAVED_SCENE, image: "/uploads/jar.png" }];
	const names = async (job: AgentJob) => (await loadRun(job.id))!.scenes.map((scene) => scene.name);

	test("waits for approval, then applies the approved edit", async () => {
		const job = await runOn(undefined, saved);
		const chat = conversation(job, [
			callTool("update_scene", { index: 0, name: "Feed it twice a day" }),
			answer("Updated."),
		]);
		const asked = await chat.start();
		expect(asked.finishReason).toBe("suspended");
		expect(await names(job)).toEqual(["Feed it daily"]);
		expect(
			lastQuestion((await loadRun(job.id))!)?.kind === "question" &&
				lastQuestion((await loadRun(job.id))!)?.question,
		).toContain("Update scene 1: Feed it daily");

		await chat.answer("approve");
		expect(await names(job)).toEqual(["Feed it twice a day"]);
	});

	test("a rejected edit leaves the work as it was", async () => {
		const job = await runOn(undefined, saved);
		const chat = conversation(job, [callTool("remove_scene", { index: 0 }), answer("Kept it.")]);
		await chat.start();
		await chat.answer("reject");
		expect(await names(job)).toEqual(["Feed it daily"]);
	});

	test("adding new work needs no approval", async () => {
		const job = await runOn(undefined, saved);
		// Two steps: the add, then the answer the finish gate holds back (the new scene has no frame yet).
		const result = await conversation(job, [
			callTool("add_scene", {
				name: "Keep it warm",
				visual: "a warm shelf",
				voiceover: "Keep it warm.",
			}),
			answer("Added."),
		]).start(2);
		expect(result.finishReason).not.toBe("suspended");
		expect(await names(job)).toEqual(["Feed it daily", "Keep it warm"]);
	});
});
