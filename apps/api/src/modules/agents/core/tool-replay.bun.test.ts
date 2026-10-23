/* Replayable tool output — a segment retry that replays a completed expensive
 * generate tool re-applies the stored asset instead of calling the provider
 * again (no double-bill). Covers the applicator, the lookup, and the end-to-end
 * dedupe through runValidatedTool. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJob } from "./model.ts";
import { applyToolReplay } from "./tool-replay.ts";
import { beginToolRun, saveRun, recordToolRun, lookupToolReplay } from "./run-repository.ts";
import { runValidatedTool } from "./tool-executor.ts";
import { setSceneFrameGeneratorForTests } from "./visual-gen.ts";
import {
	clearWorkflowRunsForTests,
	listRunArtifacts,
	listToolRuns,
} from "@maleo/db/workflow-run-db";
import { closeMaleoDb } from "@maleo/db/connection";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "tool-replay-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

/* A video run with one scene and a global style reference, so the frame tool
 * renders without generating a style bible or calling a model. */
function makeJob(over: Partial<AgentJob> = {}): AgentJob {
	return {
		id: "run-r",
		projectId: "proj-1",
		contentType: "video",
		status: "running",
		events: [],
		run: {
			instruction: "i",
			transcript: "t",
			step: 5,
			builtSomething: false,
			finishRejected: false,
			asks: 0,
		},
		scenes: [
			{
				name: "s",
				durationSec: 3,
				shot: "w",
				move: "s",
				transition: "fade",
				visual: "a cat",
				voiceover: "vo",
			},
		],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "b",
		startedAt: Date.now(),
		styleImageUrl: "http://style/ref.png",
		...over,
	};
}

beforeEach(() => clearWorkflowRunsForTests());
afterEach(() => setSceneFrameGeneratorForTests(null));
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("applyToolReplay", () => {
	test("re-applies a scene frame, no-op on missing index", () => {
		const job = makeJob();
		expect(applyToolReplay(job, { kind: "scene_frame", index: 0, url: "f1" })).toBe(true);
		expect(job.scenes[0]?.image).toBe("f1");
		expect(applyToolReplay(job, { kind: "scene_frame", index: 9, url: "f2" })).toBe(false);
	});
});

describe("lookupToolReplay", () => {
	test("returns a stored replayable result for the same (run,step,tool,args)", async () => {
		await saveRun(makeJob());
		await recordToolRun({
			runId: "run-r",
			projectId: "proj-1",
			tool: "generate_frame",
			args: { index: 0 },
			startedAt: Date.now(),
			stepIndex: 5,
			result: { note: "img", thumbs: ["u"], replay: { kind: "scene_frame", index: 0, url: "u" } },
		});
		const hit = await lookupToolReplay("run-r", 5, "generate_frame", { index: 0 });
		expect(hit?.replay).toEqual({ kind: "scene_frame", index: 0, url: "u" });
		expect(await lookupToolReplay("run-r", 6, "generate_frame", { index: 0 })).toBeNull(); // different step
		expect(await lookupToolReplay("run-r", 5, "generate_frame", { index: 1 })).toBeNull(); // different args
	});

	test("a note-only tool_run (no replay) does not dedupe", async () => {
		await saveRun(makeJob());
		await recordToolRun({
			runId: "run-r",
			projectId: "proj-1",
			tool: "add_scene",
			args: { name: "x" },
			startedAt: Date.now(),
			stepIndex: 2,
			result: { note: "added" },
		});
		expect(await lookupToolReplay("run-r", 2, "add_scene", { name: "x" })).toBeNull();
	});
});

describe("runValidatedTool dedupe (no double-bill on replay)", () => {
	test("persists tool intent before invoking the image provider", async () => {
		const job = makeJob();
		await saveRun(job);
		setSceneFrameGeneratorForTests(async () => {
			expect(await listToolRuns(job.id)).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ tool_name: "generate_frame", status: "running" }),
				]),
			);
			return "http://img/planned.png";
		});
		await runValidatedTool(job, "generate_frame", { index: 0 });
		expect((await listToolRuns(job.id))[0]?.status).toBe("completed");
	});

	test("refuses an uncertain prior attempt instead of calling provider twice", async () => {
		const job = makeJob();
		await saveRun(job);
		await beginToolRun({ runId: job.id, tool: "generate_frame", args: { index: 0 }, stepIndex: 5 });
		let calls = 0;
		setSceneFrameGeneratorForTests(async () => {
			calls++;
			return "http://img/unsafe.png";
		});
		await expect(runValidatedTool(job, "generate_frame", { index: 0 })).rejects.toThrow(
			"uncertain prior attempt",
		);
		expect(calls).toBe(0);
	});

	/* Story asset generation reuses every finished section by input hash, so the
	 * durable host re-entering it after a crash is safe: only the sections in
	 * flight at the crash are asked for again. */
	test("a reentrant tool runs again over an uncertain prior attempt", async () => {
		const job = makeJob({ contentType: "video", artifacts: [] });
		await saveRun(job);
		await beginToolRun({ runId: job.id, tool: "generate_story_assets", args: {}, stepIndex: 5 });
		const result = await runValidatedTool(job, "generate_story_assets", {});
		expect(result.note).not.toContain("uncertain prior attempt");
		expect((await listToolRuns(job.id)).map((row) => row.status)).toEqual(["completed"]);
	});

	test("second run at the same step re-applies the stored image, provider called once", async () => {
		let calls = 0;
		setSceneFrameGeneratorForTests(async () => {
			calls++;
			return `http://img/${calls}.png`;
		});
		const job = makeJob();
		await saveRun(job);

		const r1 = await runValidatedTool(job, "generate_frame", { index: 0 });
		expect(calls).toBe(1);
		expect(r1.thumbs?.[0]).toBe("http://img/1.png");
		expect(job.scenes[0]?.image).toBe("http://img/1.png");

		// Simulate a retry replaying the same step: clear the applied image, re-run.
		job.scenes = job.scenes.map((scene, i) => (i === 0 ? { ...scene, image: undefined } : scene));
		const r2 = await runValidatedTool(job, "generate_frame", { index: 0 });
		expect(calls).toBe(1); // NOT re-billed
		expect(job.scenes[0]?.image).toBe("http://img/1.png"); // re-applied from storage
		expect(r2.thumbs?.[0]).toBe("http://img/1.png");
	});

	test("a different step regenerates (distinct idempotency key)", async () => {
		let calls = 0;
		setSceneFrameGeneratorForTests(async () => {
			calls++;
			return `http://img/${calls}.png`;
		});
		const job = makeJob();
		await saveRun(job);
		await runValidatedTool(job, "generate_frame", { index: 0 }); // step 5
		job.run!.step = 6;
		await runValidatedTool(job, "generate_frame", { index: 0 }); // step 6 → new key
		expect(calls).toBe(2);
		const artifacts = (await listRunArtifacts(job.projectId)).filter(
			(artifact) => artifact.logical_ref === "scene:0:visual",
		);
		expect(artifacts.map((artifact) => artifact.version).sort((a, b) => a - b)).toEqual([1, 2]);
		expect(artifacts.filter((artifact) => artifact.active === 1)).toHaveLength(1);
		expect(artifacts.find((artifact) => artifact.version === 2)?.parent_artifact_id).toBe(
			artifacts.find((artifact) => artifact.version === 1)?.id,
		);
	});
});

describe("run.jobWrites (move-agent-tools-to-editor-commands)", () => {
	const videoJob = () =>
		makeJob({
			contentType: "video",
			artifacts: [],
			scenes: [
				{
					id: 4,
					startSec: 0,
					name: "s",
					durationSec: 3,
					shot: "w",
					move: "s",
					transition: "fade",
					visual: "v",
					voiceover: "vo",
				},
			],
		});

	test("an editing tool leaves it unset and records its command", async () => {
		const job = videoJob();
		await saveRun(job);
		await runValidatedTool(job, "update_scene", { index: 0, name: "renamed" });
		expect(job.run?.jobWrites).toBeUndefined();
		expect(job.editCommands).toHaveLength(1);
	});

	test("a tool that writes the job sets it", async () => {
		const job = videoJob();
		await saveRun(job);
		await runValidatedTool(job, "add_scene", { name: "new", visual: "v", voiceover: "vo" });
		expect(job.run?.jobWrites).toBe(true);
	});

	test("a read leaves it unset", async () => {
		const job = videoJob();
		await saveRun(job);
		await runValidatedTool(job, "view_timeline", {});
		expect(job.run?.jobWrites).toBeUndefined();
	});
});

describe("a retried editing call reuses its recorded commands", () => {
	const videoJob = () =>
		makeJob({
			contentType: "video",
			artifacts: [],
			scenes: [
				{
					id: 4,
					startSec: 0,
					name: "s",
					durationSec: 3,
					shot: "w",
					move: "s",
					transition: "fade",
					visual: "v",
					voiceover: "vo",
				},
			],
		});

	test("crash before the snapshot was saved: the commands are applied once", async () => {
		const job = videoJob();
		await saveRun(job);
		const snapshot = structuredClone(job);
		await runValidatedTool(job, "update_scene", { index: 0, name: "renamed" });

		await runValidatedTool(snapshot, "update_scene", { index: 0, name: "renamed" });
		expect(snapshot.editCommands).toEqual(job.editCommands);
		expect(snapshot.scenes[0]!.name).toBe("renamed");
	});

	test("crash after the snapshot was saved: nothing is applied again", async () => {
		const job = videoJob();
		await saveRun(job);
		await runValidatedTool(job, "update_scene", { index: 0, name: "renamed" });

		await runValidatedTool(job, "update_scene", { index: 0, name: "renamed" });
		expect(job.editCommands).toHaveLength(1);
	});
});
