import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import { registerEventRoutes } from "./events.ts";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests, upsertWorkflowRun } from "@maleo/db/workflow-run-db";

/* The database path is read lazily, inside `openDb()`, so setting it before
 * the first call is enough — these imports used to be dynamic only to run before
 * the module graph evaluated. */
const tmpDir = mkdtempSync(join(tmpdir(), "events-route-"));
process.env.MALEO_DB_PATH = join(tmpDir, "test.db");

function app(): Hono {
	const instance = new Hono();
	registerEventRoutes(instance);
	return instance;
}

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
	rmSync(tmpDir, { recursive: true, force: true });
});

describe("project outcome feedback", () => {
	test("requires a valid run for accept and a scoped target for repair feedback", async () => {
		const projectId = (await createContentProject({ title: "feedback", type: "video" })).project.id;
		await upsertWorkflowRun({
			id: "run-feedback",
			project_id: projectId,
			content_type: "video",
			status: "done",
		});
		const server = app();

		expect(
			(
				await server.request(`/projects/${projectId}/feedback`, {
					method: "POST",
					body: JSON.stringify({ action: "accept", run_id: "missing" }),
					headers: { "content-type": "application/json" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await server.request(`/projects/${projectId}/feedback`, {
					method: "POST",
					body: JSON.stringify({ action: "regenerate" }),
					headers: { "content-type": "application/json" },
				})
			).status,
		).toBe(400);
		expect(
			(
				await server.request(`/projects/${projectId}/feedback`, {
					method: "POST",
					body: JSON.stringify({ action: "accept", run_id: "run-feedback" }),
					headers: { "content-type": "application/json" },
				})
			).status,
		).toBe(201);
		expect(
			(
				await server.request(`/projects/${projectId}/feedback`, {
					method: "POST",
					body: JSON.stringify({ action: "regenerate", target_ref: "scene:0:visual" }),
					headers: { "content-type": "application/json" },
				})
			).status,
		).toBe(201);

		const trace = (await (await server.request(`/projects/${projectId}/trace`)).json()) as {
			quality: { feedback: { accept: number; regenerate: number } };
		};
		expect(trace.quality.feedback).toMatchObject({ accept: 1, regenerate: 1 });
	});
});
