import { expect, test } from "bun:test";
import { mintMediaId } from "@maleo/shared";
import { createContentProject } from "@maleo/db/project-detail";
import { failProjectMediaImport, reserveProjectMediaImport } from "@maleo/db/media-imports";
import { buildAgentJob } from "./run-bracket.ts";

test("a run records the project's unfinished imports, and only those", async () => {
	const project = (await createContentProject({ title: "Pending media run" }))!;
	const reserve = (requestKey: string) =>
		reserveProjectMediaImport({
			workspace: project.project.workspace,
			projectId: project.project.id,
			requestKey,
			filename: "clip.mp4",
			kind: "video",
			uploadTimeoutMs: 60_000,
		});
	const running = mintMediaId(),
		failed = mintMediaId();
	await reserve(running);
	await failProjectMediaImport((await reserve(failed)).row, "broken");
	const job = await buildAgentJob({
		projectId: project.project.id,
		instruction: "edit: tighten pacing",
		contentType: "video",
		scenes: [],
	});
	expect(job.pendingMediaIds).toEqual([running]);
});
