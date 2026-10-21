/* A run records the document it started from (`move-agent-tools-to-editor-commands`
 * 3.6), so the editor can fence its commands even when it did not start the run. */
import { afterAll, describe, expect, test } from "bun:test";
import { clipFingerprint, toTimelineDoc, type Scene } from "@maleo/shared";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { buildAgentJob } from "../../run-bracket.ts";

afterAll(async () => {
	await closeMaleoDb();
});

const scene = (id: number, name: string): Scene =>
	({
		id,
		dur: 3,
		name,
		shot: "Medium Shot",
		move: "Static",
		transition: "fade",
		vis: "",
		vo: "",
		img: false,
	}) as Scene;
const doc = toTimelineDoc(
	[scene(7, "Open"), scene(9, "Close")],
	[],
	[{ id: 2, content: "Hi", start: 0, dur: 2, track: 0, preset: "title" }],
	[],
	[],
	[],
);

describe("a video run's starting document", () => {
	test("is the client's live clips when it sent them", async () => {
		const { project } = await createContentProject({ title: "Base live", type: "video" });
		const job = await buildAgentJob({
			projectId: project.id,
			instruction: "",
			contentType: "video",
			seedClips: doc.clips,
		});
		expect(job.baseFingerprints).toEqual(doc.clips.map(clipFingerprint));
	});

	test("is the saved document when the run started without an editor (MCP)", async () => {
		const { project } = await createContentProject({ title: "Base saved", type: "video" });
		await addContentStoryboard({
			project_id: project.id,
			storyboard_json: { schemaVersion: 2, clips: doc.clips, markers: doc.markers },
		});
		const job = await buildAgentJob({
			projectId: project.id,
			instruction: "",
			contentType: "video",
		});
		expect(job.baseFingerprints?.map((fp) => fp.id)).toEqual(doc.clips.map((clip) => clip.id));
		expect(job.editorScenes?.map((s) => s.name)).toEqual(["Open", "Close"]);
	});
});
