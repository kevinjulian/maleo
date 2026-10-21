/* WP3 durable run store — repository round-trip tests. Points MALEO_DB_PATH at a
 * throwaway file so the shared maleo.db is never touched. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	upsertWorkflowRun,
	getWorkflowRun,
	getLatestActiveWorkflowRun,
	getLatestRunningWorkflowRun,
	listWorkflowRunsForProject,
	insertStepRun,
	listStepRuns,
	insertToolRun,
	getToolRunByIdempotencyKey,
	listToolRuns,
	insertRunArtifact,
	listRunArtifacts,
	insertRequiredAction,
	listPendingRequiredActions,
	resolveRequiredAction,
	clearWorkflowRunsForTests,
} from "./workflow-run-db.ts";
import { closeMaleoDb } from "./connection.ts";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "wf-run-db-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("workflow_run", () => {
	test("insert then read back round-trips snapshot + fields", async () => {
		const saved = await upsertWorkflowRun({
			id: "run-1",
			project_id: "proj-1",
			content_type: "video",
			status: "running",
			cursor: 3,
			instruction: "make a video",
			snapshot: { events: [{ kind: "final", text: "hi" }], nested: { a: 1 } },
		});
		expect(saved.id).toBe("run-1");
		const got = await getWorkflowRun("run-1");
		expect(got?.status).toBe("running");
		expect(got?.cursor).toBe(3);
		expect(got?.snapshot).toEqual({ events: [{ kind: "final", text: "hi" }], nested: { a: 1 } });
	});

	test("upsert preserves created_at and overwrites mutable fields", async () => {
		const first = await upsertWorkflowRun({
			id: "run-2",
			project_id: "p",
			content_type: "text",
			status: "running",
		});
		await new Promise((r) => setTimeout(r, 2));
		const second = await upsertWorkflowRun({
			id: "run-2",
			project_id: "p",
			content_type: "text",
			status: "done",
			cursor: 9,
		});
		expect(second.created_at).toBe(first.created_at);
		expect(second.updated_at).toBeGreaterThanOrEqual(first.updated_at);
		expect((await getWorkflowRun("run-2"))?.status).toBe("done");
		expect((await getWorkflowRun("run-2"))?.cursor).toBe(9);
	});

	test("getLatestActive returns newest running/awaiting, ignores done", async () => {
		await upsertWorkflowRun({ id: "a", project_id: "p", content_type: "video", status: "done" });
		await new Promise((r) => setTimeout(r, 2));
		await upsertWorkflowRun({ id: "b", project_id: "p", content_type: "video", status: "running" });
		await new Promise((r) => setTimeout(r, 2));
		await upsertWorkflowRun({
			id: "c",
			project_id: "p",
			content_type: "video",
			status: "awaiting_input",
		});
		expect((await getLatestActiveWorkflowRun("p"))?.id).toBe("c");
		expect((await getLatestRunningWorkflowRun("p"))?.id).toBe("b");
		expect(await getLatestActiveWorkflowRun("other")).toBeNull();
	});

	test("listWorkflowRunsForProject scopes + orders by updated_at desc", async () => {
		await upsertWorkflowRun({ id: "x", project_id: "p", content_type: "video", status: "running" });
		await new Promise((r) => setTimeout(r, 2));
		await upsertWorkflowRun({ id: "y", project_id: "p", content_type: "video", status: "running" });
		await upsertWorkflowRun({ id: "z", project_id: "q", content_type: "video", status: "running" });
		const rows = await listWorkflowRunsForProject("p");
		expect(rows.map((r) => r.id)).toEqual(["y", "x"]);
	});
});

describe("step_run", () => {
	test("insert + list ordered by idx", async () => {
		await upsertWorkflowRun({
			id: "run-s",
			project_id: "p",
			content_type: "video",
			status: "running",
		});
		await insertStepRun({
			workflow_run_id: "run-s",
			idx: 1,
			tool_name: "b",
			status: "completed",
			output: { ok: 1 },
		});
		await insertStepRun({
			workflow_run_id: "run-s",
			idx: 0,
			tool_name: "a",
			status: "running",
			input: { q: "x" },
		});
		const steps = await listStepRuns("run-s");
		expect(steps.map((s) => s.tool_name)).toEqual(["a", "b"]);
		expect(steps[0]?.input).toEqual({ q: "x" });
		expect(steps[1]?.output).toEqual({ ok: 1 });
	});
});

describe("tool_run", () => {
	test("insert, list, and idempotency lookup", async () => {
		await upsertWorkflowRun({
			id: "run-t",
			project_id: "p",
			content_type: "image",
			status: "running",
		});
		await insertToolRun({
			workflow_run_id: "run-t",
			tool_name: "generate_image",
			status: "completed",
			input: { prompt: "cat" },
			output: { url: "http://x/1.png" },
			cost: 0.04,
			idempotency_key: "key-abc",
			artifacts: [{ url: "http://x/1.png" }],
			latency_ms: 1200,
		});
		expect(await listToolRuns("run-t")).toHaveLength(1);
		const hit = await getToolRunByIdempotencyKey("key-abc");
		expect(hit?.output).toEqual({ url: "http://x/1.png" });
		expect(hit?.cost).toBe(0.04);
		expect(hit?.artifacts).toEqual([{ url: "http://x/1.png" }]);
		expect(await getToolRunByIdempotencyKey("missing")).toBeNull();
	});

	test("null idempotency keys do not collide", async () => {
		await upsertWorkflowRun({
			id: "run-n",
			project_id: "p",
			content_type: "image",
			status: "running",
		});
		await insertToolRun({ workflow_run_id: "run-n", tool_name: "read_a", status: "completed" });
		await insertToolRun({ workflow_run_id: "run-n", tool_name: "read_b", status: "completed" });
		expect(await listToolRuns("run-n")).toHaveLength(2);
	});
});

describe("run_artifact", () => {
	test("insert + list newest first", async () => {
		await insertRunArtifact({
			project_id: "p",
			kind: "image",
			public_url: "u1",
			metadata: { w: 100 },
		});
		await new Promise((r) => setTimeout(r, 2));
		await insertRunArtifact({ project_id: "p", kind: "voiceover", public_url: "u2" });
		const rows = await listRunArtifacts("p");
		expect(rows.map((r) => r.kind)).toEqual(["voiceover", "image"]);
		expect(rows[1]?.metadata).toEqual({ w: 100 });
	});
});

describe("required_action", () => {
	test("pending list drops resolved", async () => {
		await upsertWorkflowRun({
			id: "run-r",
			project_id: "p",
			content_type: "video",
			status: "awaiting_input",
		});
		const a = await insertRequiredAction({
			workflow_run_id: "run-r",
			type: "approve",
			step: 2,
			payload: { q: "ok?" },
		});
		await insertRequiredAction({ workflow_run_id: "run-r", type: "edit_prompt", step: 3 });
		expect(await listPendingRequiredActions("run-r")).toHaveLength(2);
		await resolveRequiredAction(a.id);
		const pending = await listPendingRequiredActions("run-r");
		expect(pending).toHaveLength(1);
		expect(pending[0]?.type).toBe("edit_prompt");
	});
});
