/* A video project with a saved one-scene timeline, and a run on it.
 *
 * The runtime suites need a project with existing work for reads, edits and
 * single-tool runs. The timeline is saved the way a run saves one, so a new run
 * loads it from the project rather than from a hand-built job. */
import { createContentProject } from "@maleo/db/project-detail";
import { buildAgentJob } from "../../../run-bracket.ts";
import { persist } from "../../../persistence.ts";
import { saveRun } from "../../../run-repository.ts";
import type { AgentJob, AgentScene } from "../../../model.ts";

export const SAVED_SCENE: AgentScene = {
	name: "Feed it daily",
	durationSec: 4,
	shot: "Close-up",
	move: "Static",
	transition: "fade",
	visual: "a jar",
	voiceover: "Feed the starter every day.",
};

/** A global style reference, so frame generation needs no style bible or board. */
export const STYLE_REFERENCE = "http://style.test/ref.png";

export async function savedVideoProject(
	title: string,
	scenes: AgentScene[] = [SAVED_SCENE],
	workspace?: string,
): Promise<string> {
	const projectId = (
		await createContentProject({ title, type: "video", ...(workspace ? { workspace } : {}) })
	).project.id;
	const seed = await buildAgentJob({ projectId, instruction: "", contentType: "video", scenes });
	await persist({ ...seed, status: "done" });
	return projectId;
}

/** A saved run on a video project that already holds `scenes`. */
export async function savedVideoRun(
	title: string,
	scenes: AgentScene[] = [SAVED_SCENE],
): Promise<AgentJob> {
	const projectId = await savedVideoProject(title, scenes);
	const job = await buildAgentJob({
		projectId,
		instruction: "",
		contentType: "video",
		styleImageUrl: STYLE_REFERENCE,
	});
	await saveRun(job);
	return job;
}
