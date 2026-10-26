/* Saving an edit-only run onto the document as it stands now
 * (`migrate-editor-to-shared-rust-core` 4.6): the run's commands execute in the
 * engine onto the latest saved version, once each, and a version saved since the
 * run started is kept — rebased onto when it left the run's clips alone, never
 * overwritten when it did not. */
import { afterAll, describe, expect, test } from "bun:test";
import {
	readStoryboardDocument,
	toTimelineDoc,
	type Clip,
	type Scene,
	type TimelineDoc,
} from "@maleo/shared";
import {
	engineExecutor,
	insertClip,
	readAgentEditMarker,
	updateClip,
	type EditScope,
} from "@maleo/shared/editor";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import { editorEngine } from "../../../../../lib/editor-engine.ts";
import { buildAgentJob } from "../../run-bracket.ts";
import { executeEdit, runCommandWire, runDocument } from "../../edit-document.ts";
import { persist } from "../../persistence.ts";
import { runState } from "../../runtime/run-state.ts";
import type { AgentJob } from "../../model.ts";

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
const base = toTimelineDoc(
	[scene(7, "Open"), scene(9, "Close")],
	[],
	[{ id: 2, content: "Hi", start: 0, dur: 2, track: 0, preset: "plain" }],
	[],
	[],
	[],
);

async function versions(projectId: string) {
	return (
		(await getContentProject(projectId, undefined, { storyboardLimit: null }))?.storyboards ?? []
	);
}

async function latestDoc(projectId: string): Promise<{ doc: TimelineDoc; json: unknown }> {
	const [latest] = await versions(projectId);
	return {
		doc: readStoryboardDocument(latest?.storyboard_json ?? null).doc as TimelineDoc,
		json: latest?.storyboard_json,
	};
}

const clip = (doc: TimelineDoc, id: string): Clip | undefined => doc.clips.find((c) => c.id === id);

/** A project saved at `base`, and a run started from it that renamed the title. */
async function startedRun(title: string): Promise<{ job: AgentJob; projectId: string }> {
	const { project } = await createContentProject({ title, type: "video" });
	await addContentStoryboard({
		project_id: project.id,
		storyboard_json: { schemaVersion: 2, clips: base.clips, markers: base.markers },
	});
	const job = await buildAgentJob({ projectId: project.id, instruction: "", contentType: "video" });
	const text = clip(runDocument(job), "text:2")!;
	expect(
		executeEdit(job, updateClip("text:2", { text: { ...text.text!, content: "Hello" } })),
	).toEqual({ ok: true });
	return { job, projectId: project.id };
}

/** A hand save: the latest document with one clip changed. */
async function handSave(
	projectId: string,
	id: string,
	change: (clip: Clip) => Clip,
): Promise<void> {
	const { doc } = await latestDoc(projectId);
	await addContentStoryboard({
		project_id: projectId,
		storyboard_json: {
			schemaVersion: 2,
			clips: doc.clips.map((c) => (c.id === id ? change(c) : c)),
			markers: doc.markers,
		},
	});
}

describe("an edit-only run's save", () => {
	test("an approval checkpoint before any command leaves newer manual saves untouched", async () => {
		const { job, projectId } = await startedRun("Approval checkpoint");
		job.editCommands = [];
		runState(job);
		job.status = "awaiting_input";
		await handSave(projectId, "scene:9", (c) => ({
			...c,
			scene: { ...c.scene!, name: "Manual while waiting" },
		}));
		const count = (await versions(projectId)).length;
		await persist(job);
		expect((await versions(projectId)).length).toBe(count);
		expect(clip((await latestDoc(projectId)).doc, "scene:9")?.scene?.name).toBe(
			"Manual while waiting",
		);
	});

	test("on the version it started from: the run's commands, executed as the editor executes them", async () => {
		const { job, projectId } = await startedRun("Rebase parity");
		const before = await latestDoc(projectId);
		await persist(job);
		const after = await latestDoc(projectId);
		expect(clip(after.doc, "text:2")?.text?.content).toBe("Hello");
		expect(readAgentEditMarker(after.json)).toEqual({ runId: job.id, applied: 1 });
		/* Server/client parity: the editor applying the settled run's commands to the
		 * same document, through its executor, reaches the same clips. */
		let scope: EditScope = {
			mediaAssets: [],
			doc: { schemaVersion: 2, clips: before.doc.clips, markers: before.doc.markers },
			slides: [],
			posts: [],
		};
		const client = engineExecutor(editorEngine());
		for (const command of runCommandWire(job).commands ?? [])
			scope = client.execute(scope, command).scope;
		expect(JSON.stringify(after.doc.clips)).toBe(JSON.stringify(scope.doc.clips));
	});

	test("saved again, applies nothing twice: execution is identified by run and position", async () => {
		const { job, projectId } = await startedRun("Rebase identity");
		await persist(job);
		const count = (await versions(projectId)).length;
		await persist(job);
		expect((await versions(projectId)).length).toBe(count);
		/* An insert would duplicate if re-executed: only the new command runs. */
		const added = { ...clip(runDocument(job), "text:2")!, id: "text:99", startSec: 4 };
		expect(executeEdit(job, insertClip(added))).toEqual({ ok: true });
		await persist(job);
		await persist(job);
		const { doc, json } = await latestDoc(projectId);
		expect(doc.clips.filter((c) => c.id === "text:99")).toHaveLength(1);
		expect(clip(doc, "text:2")?.text?.content).toBe("Hello");
		expect(readAgentEditMarker(json)).toEqual({ runId: job.id, applied: 2 });
	});

	test("after a hand save that left the run's clips alone: rebased onto it, both kept", async () => {
		const { job, projectId } = await startedRun("Rebase onto newer");
		await handSave(projectId, "scene:9", (c) => ({
			...c,
			scene: { ...c.scene!, name: "Closing shot" },
		}));
		await persist(job);
		const { doc } = await latestDoc(projectId);
		expect(clip(doc, "scene:9")?.scene?.name).toBe("Closing shot");
		expect(clip(doc, "text:2")?.text?.content).toBe("Hello");
		expect(job.editConflict).toBeUndefined();
	});

	test("after a hand save of the clip the run edits: nothing written, the conflict reported", async () => {
		const { job, projectId } = await startedRun("Rebase conflict");
		await handSave(projectId, "text:2", (c) => ({ ...c, text: { ...c.text!, content: "Mine" } }));
		const count = (await versions(projectId)).length;
		await persist(job);
		expect((await versions(projectId)).length).toBe(count);
		expect(clip((await latestDoc(projectId)).doc, "text:2")?.text?.content).toBe("Mine");
		expect(job.editConflict).toContain("text:2");
		expect(runCommandWire(job).commandConflict).toContain("text:2");
	});

	test("after a hand save that removed the clip the run edits: nothing written", async () => {
		const { job, projectId } = await startedRun("Rebase removed");
		const { doc } = await latestDoc(projectId);
		await addContentStoryboard({
			project_id: projectId,
			storyboard_json: {
				schemaVersion: 2,
				clips: doc.clips.filter((c) => c.id !== "text:2"),
				markers: doc.markers,
			},
		});
		await persist(job);
		expect(clip((await latestDoc(projectId)).doc, "text:2")).toBeUndefined();
		expect(job.editConflict).toContain("text:2");
	});
});

describe("an agent edit the engine refuses", () => {
	test("is a diagnosable refusal that leaves the job as it was", async () => {
		const { job } = await startedRun("Refused edit");
		const families = JSON.stringify([job.scenes, job.textOverlays, job.editCommands]);
		const outcome = executeEdit(job, { type: "clip.remove", id: "text:404" });
		expect(outcome.ok).toBe(false);
		expect(outcome.ok ? "" : outcome.error).toContain("text:404");
		const unknown = executeEdit(job, JSON.parse('{"type":"clip.teleport","id":"text:2"}'));
		expect(unknown.ok ? "" : unknown.error).toContain("clip.teleport");
		expect(JSON.stringify([job.scenes, job.textOverlays, job.editCommands])).toBe(families);
	});
});
