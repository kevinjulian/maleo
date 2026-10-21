/* WP5 read API — GET /projects/:id/runs and /:runId return DB-backed run + step +
 * tool + artifact rows so the client can render a run from the DB. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerRunRoutes } from "./runs.ts";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	clearWorkflowRunsForTests,
	upsertWorkflowRun,
	insertStepRun,
	insertToolRun,
	insertRunArtifact,
} from "@maleo/db/workflow-run-db";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "runs-route-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

function app(): Hono {
	const a = new Hono();
	registerRunRoutes(a);
	return a;
}

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("GET /projects/:id/runs", () => {
	test("lists project runs newest-first, no snapshot blob", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await upsertWorkflowRun({ id: "r1", project_id: pid, content_type: "video", status: "done" });
		await new Promise((r) => setTimeout(r, 2));
		await upsertWorkflowRun({
			id: "r2",
			project_id: pid,
			content_type: "video",
			status: "running",
		});
		const res = await app().request(`/projects/${pid}/runs`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { runs: Array<{ id: string; status: string }> };
		expect(body.runs.map((r) => r.id)).toEqual(["r2", "r1"]);
		expect(body.runs[0]).not.toHaveProperty("snapshot");
	});

	test("unknown project 404", async () => {
		const res = await app().request(`/projects/nope/runs`);
		expect(res.status).toBe(404);
	});
});

describe("GET /projects/:id/runs/:runId", () => {
	test("returns run + steps + tools + linked artifacts", async () => {
		const pid = (await createContentProject({ title: "t", type: "video" })).project.id;
		await upsertWorkflowRun({
			id: "run-x",
			project_id: pid,
			content_type: "video",
			status: "running",
			cursor: 2,
		});
		await insertStepRun({
			workflow_run_id: "run-x",
			idx: 0,
			tool_name: "plan_video",
			status: "completed",
		});
		const tr = await insertToolRun({
			workflow_run_id: "run-x",
			tool_name: "generate_slide_image",
			status: "completed",
			output: { note: "ok" },
		});
		await insertRunArtifact({
			project_id: pid,
			tool_run_id: tr.id,
			kind: "image",
			public_url: "u1",
		});
		await insertRunArtifact({
			project_id: pid,
			tool_run_id: null,
			kind: "image",
			public_url: "unlinked",
		});
		const res = await app().request(`/projects/${pid}/runs/run-x`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			run: { id: string; cursor: number };
			steps: Array<{ tool: string }>;
			tools: Array<{ tool: string; output: unknown }>;
			artifacts: Array<{ publicUrl: string; toolRunId: string }>;
		};
		expect(body.run.id).toBe("run-x");
		expect(body.run.cursor).toBe(2);
		expect(body.steps.map((s) => s.tool)).toEqual(["plan_video"]);
		expect(body.tools[0]?.output).toEqual({ note: "ok" });
		// Only artifacts linked to THIS run's tool_runs, not the unlinked project one.
		expect(body.artifacts.map((a) => a.publicUrl)).toEqual(["u1"]);
		expect(body.artifacts[0]?.toolRunId).toBe(tr.id);
	});

	test("run from another project 404", async () => {
		const p1 = (await createContentProject({ title: "a", type: "video" })).project.id;
		const p2 = (await createContentProject({ title: "b", type: "video" })).project.id;
		await upsertWorkflowRun({
			id: "run-p1",
			project_id: p1,
			content_type: "video",
			status: "running",
		});
		const res = await app().request(`/projects/${p2}/runs/run-p1`);
		expect(res.status).toBe(404);
	});
});
