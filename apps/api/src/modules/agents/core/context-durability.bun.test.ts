/* The captured context survives a restart.
 *
 * A run can be reaped mid-flight by a server restart and resumed later. If the
 * envelope did not survive that, a resumed run would rebuild context from the
 * project as it is NOW — a different project than the one it planned against,
 * since the user has been editing in the meantime. It would then apply a result
 * computed from one state onto another, which is exactly what the fencing this
 * change adds exists to prevent.
 *
 * The envelope rides in the run snapshot, so this is really a test that it is
 * inside the snapshot and comes back byte-identical. */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { loadRun, runBelongsToProject, saveRun } from "./run-repository.ts";
import type { AgentJob } from "./model.ts";
import { EMPTY_CHAT_PROJECT_INDEX, type ChatContextEnvelope } from "@maleo/shared";

const dbPath = join(tmpdir(), "maleo-context-durability.test.db");
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

function envelopeFor(projectId: string): ChatContextEnvelope {
	return {
		projectId,
		capturedAt: 1_700_000_000_000,
		documentHash: "abc123",
		index: {
			...EMPTY_CHAT_PROJECT_INDEX,
			timeline: [{ kind: "clip", id: "scene:1", label: "Opening" }],
		},
		detail: [],
		fingerprints: [{ kind: "clip", id: "scene:1", hash: "deadbeefdeadbeef" }],
		focus: { source: "selection", entities: [{ kind: "clip", id: "scene:1" }] },
		memory: {
			decisions: [
				{
					kind: "approval",
					question: "Which ending?",
					answer: "quiet",
					recordedAt: 1,
					provenance: { messageId: 7, runId: "run_1" },
				},
			],
			unresolved: [],
			recentTurns: [{ role: "user", text: "make it punchier", provenance: { messageId: 8 } }],
		},
		pendingAction: { actionId: "a1", kind: "clarification", question: "Which cut?" },
		inputs: { referenceIds: ["ref_1"], brief: "a short video", aspect: "9:16" },
	};
}

function jobWithContext(projectId: string, context: ChatContextEnvelope): AgentJob {
	return {
		id: `job-${Date.now()}`,
		projectId,
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "a short video",
		startedAt: Date.now(),
		context,
		run: {
			instruction: "make it punchier",
			transcript: "",
			step: 3,
			builtSomething: false,
			finishRejected: false,
			asks: 0,
		},
	};
}

describe("captured context survives restart and resume", () => {
	test("focus, fingerprints, memory and pending action come back identical", async () => {
		const project = (await createContentProject({ title: "p", type: "video" })).project;
		const context = envelopeFor(project.id);
		const job = jobWithContext(project.id, context);

		await saveRun(job);
		// A restart loses every in-process job; the only thing left is the row.
		const restored = await loadRun(job.id);

		expect(restored?.context).toEqual(context);
		expect(restored?.context?.focus.entities).toEqual([{ kind: "clip", id: "scene:1" }]);
		expect(restored?.context?.fingerprints).toEqual([
			{ kind: "clip", id: "scene:1", hash: "deadbeefdeadbeef" },
		]);
		expect(restored?.context?.memory.decisions[0]?.provenance).toEqual({
			messageId: 7,
			runId: "run_1",
		});
		expect(restored?.context?.pendingAction?.actionId).toBe("a1");
	});

	test("the resume cursor is preserved alongside the context", async () => {
		const project = (await createContentProject({ title: "p", type: "video" })).project;
		const job = jobWithContext(project.id, envelopeFor(project.id));
		await saveRun(job);
		expect((await loadRun(job.id))?.run?.step).toBe(3);
	});

	test("a run saved without context restores without one rather than failing", async () => {
		// Runs started before this change have no envelope; loading one must not throw.
		const project = (await createContentProject({ title: "p", type: "video" })).project;
		const job = jobWithContext(project.id, envelopeFor(project.id));
		delete job.context;
		await saveRun(job);
		expect((await loadRun(job.id))?.context).toBeUndefined();
	});
});

describe("runBelongsToProject", () => {
	test("true for the project that owns the run", async () => {
		const project = (await createContentProject({ title: "p", type: "video" })).project;
		const job = jobWithContext(project.id, envelopeFor(project.id));
		await saveRun(job);
		expect(await runBelongsToProject(job.id, project.id)).toBe(true);
	});

	test("false for another project, so foreign memory provenance is dropped", async () => {
		const mine = (await createContentProject({ title: "mine", type: "video" })).project;
		const theirs = (await createContentProject({ title: "theirs", type: "video" })).project;
		const job = jobWithContext(theirs.id, envelopeFor(theirs.id));
		await saveRun(job);
		expect(await runBelongsToProject(job.id, mine.id)).toBe(false);
	});

	test("false for an unknown run — unverifiable provenance is not provenance", async () => {
		const project = (await createContentProject({ title: "p", type: "video" })).project;
		expect(await runBelongsToProject("job-does-not-exist", project.id)).toBe(false);
	});
});
