/* WP3 durable run store — proves DB-first survival: a job saved via saveRun is
 * recoverable after the in-memory JOBS cache is wiped (simulating a restart /
 * different instance). Runs against a throwaway MALEO_DB_PATH with the flag on;
 * a second block asserts the flag-off path stays a pure no-op. */
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentJob } from "./model.ts";
import {
	saveRun,
	loadRun,
	loadLatestActiveRun,
	recordToolRun,
	recordStepRun,
	recordRequiredAction,
	resolveRequiredActions,
	reapIfStale,
	markRunAbandoned,
	toolIdempotencyKey,
} from "./run-repository.ts";
import {
	JOBS,
	getAgentJob,
	getLatestActiveJobForProject,
	getLatestRunningJobForProject,
	clearAgentJobsForTests,
} from "./session-store.ts";
import {
	clearWorkflowRunsForTests,
	listToolRuns,
	listStepRuns,
	listPendingRequiredActions,
	listRunArtifacts,
} from "@maleo/db/workflow-run-db";
import { closeMaleoDb, openDb } from "@maleo/db/connection";
import { storyClarificationBatchSchema } from "@maleo/shared";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "wf-run-repo-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

async function backdateRun(id: string, msAgo: number): Promise<void> {
	await openDb().run(`UPDATE workflow_run SET updated_at = ? WHERE id = ?`, [
		Date.now() - msAgo,
		id,
	]);
}

function makeJob(over: Partial<AgentJob> = {}): AgentJob {
	return {
		id: "agent-1",
		projectId: "proj-1",
		contentType: "video",
		status: "running",
		events: [],
		run: {
			instruction: "make video",
			transcript: "t",
			step: 4,
			builtSomething: true,
			finishRejected: false,
			asks: 0,
		},
		scenes: [
			{
				name: "S1",
				durationSec: 3,
				shot: "wide",
				move: "static",
				transition: "fade",
				visual: "v",
				voiceover: "vo",
			},
		],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: fixtureArtifacts("proj-1", [
			{ kind: "knowledge", payload: { title: "k", body: "b" } },
		]),
		aspect: "9:16",
		brief: "brief",
		startedAt: Date.now(),
		...over,
	};
}

beforeEach(async () => {
	clearAgentJobsForTests();
	await clearWorkflowRunsForTests();
});
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("durable run repository", () => {
	test("saveRun then loadRun round-trips the full job", async () => {
		await saveRun(makeJob());
		const got = await loadRun("agent-1");
		expect(got?.projectId).toBe("proj-1");
		expect(got?.run?.step).toBe(4);
		expect(got?.scenes[0]?.name).toBe("S1");
		expect(got?.artifacts[0]).toMatchObject({
			kind: "knowledge",
			revision: 1,
			payload: { title: "k", body: "b" },
		});
	});

	test("getAgentJob rehydrates from DB after the cache is wiped (restart)", async () => {
		await saveRun(makeJob());
		clearAgentJobsForTests(); // simulate a fresh process / different instance
		expect(JOBS.size).toBe(0);
		const got = await getAgentJob("agent-1");
		expect(got?.id).toBe("agent-1");
		expect(JOBS.get("agent-1")?.id).toBe("agent-1"); // re-seeded into cache
	});

	test("getLatestActive/Running fall back to DB and prefer newest", async () => {
		await saveRun(makeJob({ id: "old", status: "running", startedAt: 1 }));
		await new Promise((r) => setTimeout(r, 2));
		await saveRun(makeJob({ id: "new", status: "awaiting_input", startedAt: 2 }));
		clearAgentJobsForTests();
		expect((await getLatestActiveJobForProject("proj-1"))?.id).toBe("new");
		expect((await getLatestRunningJobForProject("proj-1"))?.id).toBe("old");
	});

	test("recordToolRun writes a durable row per call (success + error)", async () => {
		await saveRun(makeJob());
		await recordToolRun({
			runId: "agent-1",
			projectId: "proj-1",
			tool: "add_scene",
			args: { name: "S2" },
			startedAt: Date.now() - 10,
			result: { note: "added", thumbs: ["t1"] },
		});
		await recordToolRun({
			runId: "agent-1",
			projectId: "proj-1",
			tool: "generate_image",
			args: { prompt: "cat" },
			startedAt: Date.now() - 5,
			error: new Error("boom"),
		});
		const rows = await listToolRuns("agent-1");
		expect(rows).toHaveLength(2);
		const ok = rows.find((r) => r.tool_name === "add_scene");
		expect(ok?.status).toBe("completed");
		expect(ok?.output).toEqual({ note: "added", thumbs: ["t1"] });
		expect(ok?.artifacts).toEqual(["t1"]);
		expect(ok?.latency_ms ?? 0).toBeGreaterThanOrEqual(0);
		const bad = rows.find((r) => r.tool_name === "generate_image");
		expect(bad?.status).toBe("failed");
		expect(bad?.error).toEqual({ message: "boom" });
	});

	test("toolIdempotencyKey is stable per (run,step,tool,args) and stamped on tool_run", async () => {
		const k1 = toolIdempotencyKey("run-k", 3, "generate_slide_image", { index: 1 });
		const k2 = toolIdempotencyKey("run-k", 3, "generate_slide_image", { index: 1 });
		const k3 = toolIdempotencyKey("run-k", 4, "generate_slide_image", { index: 1 });
		expect(k1).toBe(k2); // stable
		expect(k1).not.toBe(k3); // different step → different key
		expect(k1).toMatch(/^run-k:step:3:tool:generate_slide_image:[a-z0-9]+$/);
		await saveRun(makeJob({ id: "run-k" }));
		await recordToolRun({
			runId: "run-k",
			projectId: "proj-1",
			tool: "generate_slide_image",
			args: { index: 1 },
			startedAt: Date.now(),
			stepIndex: 3,
			result: { note: "ok", thumbs: ["u"] },
		});
		expect((await listToolRuns("run-k"))[0]?.idempotency_key).toBe(k1);
	});

	test("recordToolRun persists a run_artifact per thumb, linked to the tool_run", async () => {
		await saveRun(makeJob());
		await recordToolRun({
			runId: "agent-1",
			projectId: "proj-1",
			tool: "generate_slide_image",
			args: { index: 0 },
			startedAt: Date.now() - 3,
			result: { note: "img", thumbs: ["u1", "u2"] },
		});
		const tool = (await listToolRuns("agent-1")).find(
			(t) => t.tool_name === "generate_slide_image",
		);
		const arts = await listRunArtifacts("proj-1");
		expect(arts).toHaveLength(2);
		expect(arts.every((a) => a.tool_run_id === tool?.id)).toBe(true);
		expect(arts.map((a) => a.public_url).sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual([
			"u1",
			"u2",
		]);
		expect(arts.every((a) => a.kind === "image")).toBe(true);
	});

	test("recordStepRun writes an ordered step per tool", async () => {
		await saveRun(
			makeJob({
				run: {
					instruction: "i",
					transcript: "t",
					step: 2,
					builtSomething: true,
					finishRejected: false,
					asks: 0,
				},
			}),
		);
		await recordStepRun(
			makeJob({
				run: {
					instruction: "i",
					transcript: "t",
					step: 2,
					builtSomething: true,
					finishRejected: false,
					asks: 0,
				},
			}),
			"add_scene",
			"completed",
		);
		await recordStepRun(
			makeJob({
				run: {
					instruction: "i",
					transcript: "t",
					step: 3,
					builtSomething: true,
					finishRejected: false,
					asks: 0,
				},
			}),
			"generate_image",
			"failed",
			{ error: new Error("x") },
		);
		const steps = await listStepRuns("agent-1");
		expect(steps.map((s) => [s.idx, s.tool_name, s.status])).toEqual([
			[2, "add_scene", "completed"],
			[3, "generate_image", "failed"],
		]);
		expect(steps[1]?.error_message).toBe("x");
	});

	test("required_action recorded on suspend, resolved on resume", async () => {
		const parked = makeJob({
			status: "awaiting_input",
			pendingQuestion: { question: "Approve?", options: [{ label: "Approve", value: "approve" }] },
		});
		await saveRun(parked);
		await recordRequiredAction(parked, "approve");
		const pending = await listPendingRequiredActions("agent-1");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.type).toBe("approve");
		expect(pending[0]?.payload).toEqual({
			question: "Approve?",
			options: [{ label: "Approve", value: "approve" }],
			batch: null,
		});
		await resolveRequiredActions("agent-1");
		expect(await listPendingRequiredActions("agent-1")).toHaveLength(0);
	});

	test("a pre-research clarification batch is persisted in the required_action payload", async () => {
		const batch = storyClarificationBatchSchema.parse({
			id: "batch-7",
			stage: "pre_research",
			purpose: "story_brief",
			questions: [
				{
					id: "audience",
					header: "Audience",
					question: "Who is this for?",
					options: [
						{
							id: "leaders",
							label: "Team leaders",
							value: "team leaders",
							description: "Frames tradeoffs.",
							recommended: true,
						},
						{
							id: "newcomers",
							label: "Newcomers",
							value: "newcomers",
							description: "Defines terms first.",
						},
					],
				},
			],
		});
		const parked = makeJob({
			status: "awaiting_input",
			pendingQuestion: {
				question: "A few decisions first.",
				options: [{ label: "Team leaders", value: "team leaders" }],
				batch,
			},
		});
		await saveRun(parked);
		await recordRequiredAction(parked, "ask_user");
		const pending = await listPendingRequiredActions("agent-1");
		expect(pending).toHaveLength(1);
		// The batch rehydrates from the row itself, not only from the run snapshot.
		// SAFETY: the row exists (asserted above) and `recordRequiredAction` wrote the
		// payload from `pendingQuestion`, so `batch` is the value seeded here.
		const payload = pending[0]!.payload as { batch?: unknown };
		expect(payload.batch).toEqual(batch);
		await resolveRequiredActions("agent-1");
	});

	test("reapIfStale flips an orphaned (not-live) running run to error", async () => {
		const job = makeJob({ status: "running" });
		await saveRun(job);
		await backdateRun("agent-1", 20 * 60_000); // 20 min with no progress
		expect(await reapIfStale(job, false)).toBe(true);
		expect(job.status).toBe("error");
		expect(job.error).toContain("interrupted");
		expect((await loadRun("agent-1"))?.status).toBe("error"); // persisted
	});

	test("reapIfStale never reaps a run live in this process (long tool)", async () => {
		const job = makeJob({ status: "running" });
		await saveRun(job);
		await backdateRun("agent-1", 30 * 60_000); // stale row...
		expect(await reapIfStale(job, true)).toBe(false); // ...but alive in JOBS → keep
		expect(job.status).toBe("running");
	});

	test("reapIfStale leaves a fresh running run and terminal runs alone", async () => {
		const fresh = makeJob({ status: "running" });
		await saveRun(fresh); // updated_at = now
		expect(await reapIfStale(fresh, false)).toBe(false);
		expect(fresh.status).toBe("running");

		const done = makeJob({ id: "d1", status: "done" });
		await saveRun(done);
		await backdateRun("d1", 60 * 60_000);
		expect(await reapIfStale(done, false)).toBe(false);
		expect(done.status).toBe("done");
	});

	test("markRunAbandoned flips a non-terminal run to error, spares terminal", async () => {
		await saveRun(makeJob({ id: "ab1", status: "awaiting_input" }));
		await markRunAbandoned("ab1", "timed out awaiting input");
		expect((await loadRun("ab1"))?.status).toBe("error");
		expect((await loadRun("ab1"))?.error).toContain("abandoned");

		await saveRun(makeJob({ id: "ab2", status: "done" }));
		await markRunAbandoned("ab2", "timed out");
		expect((await loadRun("ab2"))?.status).toBe("done"); // terminal untouched
	});

	test("upsert reflects a status transition running -> done", async () => {
		await saveRun(makeJob({ status: "running" }));
		await saveRun(makeJob({ status: "done" }));
		expect((await loadRun("agent-1"))?.status).toBe("done");
		expect(await loadLatestActiveRun("proj-1")).toBeUndefined(); // done is not active
	});
});
