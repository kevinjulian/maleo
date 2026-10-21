import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fixtureArtifacts } from "../../modules/agents/core/artifact-fixtures.ts";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Hono } from "hono";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject, getContentProject } from "@maleo/db/project-detail";
import { addContentStoryboard } from "@maleo/db/storyboards";
import {
	listPendingRequiredActions,
	listWorkflowRunsForProject,
	upsertWorkflowRun,
} from "@maleo/db/workflow-run-db";
import { readStoryboardDocument } from "@maleo/shared";
import { registerBlockerRoutes } from "./blockers.ts";

const dbPath = join(tmpdir(), "maleo-blockers.test.db");
const priorDbPath = process.env.MALEO_DB_PATH;
const json = { "content-type": "application/json" };

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
	if (priorDbPath === undefined) process.env.MALEO_DB_PATH = "";
	else process.env.MALEO_DB_PATH = priorDbPath;
});

function app(): Hono {
	const instance = new Hono();
	registerBlockerRoutes(instance);
	return instance;
}

async function seed(plan: Record<string, unknown> = {}): Promise<string> {
	const id = (
		await createContentProject({ title: "Blockers", type: "video", target_duration_sec: 60 })
	).project.id;
	await addContentStoryboard({
		project_id: id,
		status: "storyboard",
		storyboard_json: {
			schemaVersion: 2,
			clips: [],
			markers: [],
			artifacts: fixtureArtifacts(id, [
				{
					kind: "story_plan",
					payload: {
						targetSec: 60,
						sections: [
							{
								id: "beat-a",
								sectionId: "section-a",
								semanticBeatId: "beat-a",
								title: "Opening",
								narration: "One",
								visualPrompt: "Wide",
							},
						],
						...plan,
					},
				},
			]),
		},
	});
	return id;
}

/** A finished run carrying a delivery check — the state a blocker normally
 *  arrives in, on a run that is over. */
async function seedEvaluation(projectId: string, findings: unknown[]): Promise<void> {
	await upsertWorkflowRun({
		id: `run-${projectId}`,
		project_id: projectId,
		content_type: "video",
		status: "done",
		cursor: 0,
		instruction: "make a video",
		created_at: Date.now(),
		snapshot: {
			id: `run-${projectId}`,
			projectId,
			outcomeEvaluation: {
				schemaVersion: 1,
				contractSchemaVersion: 1,
				status: "failed",
				score: 40,
				evaluatedAt: Date.now(),
				findings,
				metrics: { blockerCount: findings.length, warningCount: 0, findingCount: findings.length },
			},
		},
	});
}

const durationFinding = {
	id: "f1",
	requirementId: "duration_within_tolerance",
	severity: "blocker",
	message: "Runtime is 22s over the target.",
	fix: { command: "Trim section 3." },
};

describe("blocker routes", () => {
	test("a project with nothing unresolved reports no blockers", async () => {
		const id = await seed();
		const res = await app().request(`/projects/${id}/blockers`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ blockers: [], acknowledged: [], batch: null });
	});

	test("an unknown project is not found", async () => {
		expect((await app().request("/projects/nope/blockers")).status).toBe(404);
	});

	test("plan and delivery-check blockers are reported together", async () => {
		const id = await seed({
			needsDirection: true,
			directionErrors: ["repeated_treatment: beat-a/beat-b: adjacent presentation repeats"],
		});
		await seedEvaluation(id, [durationFinding]);
		const body = await (await app().request(`/projects/${id}/blockers`)).json();
		expect(body.blockers).toHaveLength(2);
		expect(body.blockers.map((blocker: { source: string }) => blocker.source)).toEqual([
			"story_direction",
			"outcome_finding",
		]);
		expect(body.blockers[1].remedy).toMatchObject({ kind: "command", command: "Trim section 3." });
	});

	test("blockers survive the run that reported them being over", async () => {
		// No active run at all — the check's run is completed, and the blockers are
		// still readable, which is the point of deriving them from state.
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const body = await (await app().request(`/projects/${id}/blockers`)).json();
		expect(body.blockers).toHaveLength(1);
	});

	test("acknowledging one blocker leaves the others open", async () => {
		const id = await seed({
			needsDirection: true,
			directionErrors: ["repeated_treatment: beat-a/beat-b: adjacent presentation repeats"],
		});
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		const res = await app().request(`/projects/${id}/blockers/acknowledge`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ ids: [open[1].id] }),
		});
		expect(res.status).toBe(200);
		const remaining = (await res.json()).blockers;
		expect(remaining).toHaveLength(1);
		expect(remaining[0].source).toBe("story_direction");
	});

	test("an acknowledgement is persisted on the document and reopens when the condition changes", async () => {
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		await app().request(`/projects/${id}/blockers/acknowledge`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ ids: [open[0].id] }),
		});
		const artifacts = readStoryboardDocument(
			(await getContentProject(id))!.storyboards[0]!.storyboard_json,
		).doc.artifacts;
		expect(
			artifacts.some(
				(artifact) =>
					artifact &&
					typeof artifact === "object" &&
					"kind" in artifact &&
					artifact.kind === "blocker_acknowledgements",
			),
		).toBe(true);
		expect((await (await app().request(`/projects/${id}/blockers`)).json()).blockers).toEqual([]);

		// The same requirement, a different overrun: a new condition, so a new id,
		// and the acknowledgement does not cover it.
		await seedEvaluation(id, [{ ...durationFinding, message: "Runtime is 41s over the target." }]);
		expect((await (await app().request(`/projects/${id}/blockers`)).json()).blockers).toHaveLength(
			1,
		);
	});

	test("a partial answer is refused before anything is applied", async () => {
		const id = await seed({
			needsDirection: true,
			directionErrors: ["repeated_treatment: beat-a/beat-b: adjacent presentation repeats"],
		});
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		const res = await app().request(`/projects/${id}/blockers/resolve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ answers: [{ id: open[0].id, choice: "leave" }] }),
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "incomplete", missing: [open[1].id] });
		// Nothing was acknowledged, so both are still open.
		expect((await (await app().request(`/projects/${id}/blockers`)).json()).blockers).toHaveLength(
			2,
		);
	});

	test("a fix remedy comes back as an instruction for the run to carry out", async () => {
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		const res = await app().request(`/projects/${id}/blockers/resolve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ answers: [{ id: open[0].id, choice: "remedy" }] }),
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.instructions).toEqual(["Trim section 3."]);
		// Still open: the fix has not run yet, so the blocker has not cleared.
		expect(body.blockers).toHaveLength(1);
	});

	test("an operator-only blocker is returned to navigate to, not applied", async () => {
		const id = await seed({
			needsDirection: true,
			directionBlocked: true,
			directionErrors: ["beat-a: shot 1 requires a product with no roster entity"],
		});
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		const body = await (
			await app().request(`/projects/${id}/blockers/resolve`, {
				method: "POST",
				headers: json,
				body: JSON.stringify({ answers: [{ id: open[0].id, choice: "remedy" }] }),
			})
		).json();
		expect(body.navigate).toHaveLength(1);
		expect(body.instructions).toEqual([]);
		expect(body.blockers).toHaveLength(1);
	});

	test("answers are applied independently: one left, one instructed, one own words", async () => {
		const id = await seed({
			needsDirection: true,
			directionErrors: ["repeated_treatment: beat-a/beat-b: adjacent presentation repeats"],
		});
		await seedEvaluation(id, [
			durationFinding,
			{ ...durationFinding, id: "f2", message: "Section 2 cites no source.", fix: undefined },
		]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		expect(open).toHaveLength(3);
		const byMessage = (text: string) =>
			open.find((blocker: { message: string }) => blocker.message.includes(text))!;
		const body = await (
			await app().request(`/projects/${id}/blockers/resolve`, {
				method: "POST",
				headers: json,
				body: JSON.stringify({
					answers: [
						{ id: byMessage("22s over").id, choice: "remedy" },
						{ id: byMessage("cites no source").id, choice: "leave" },
						{
							id: byMessage("repeated_treatment").id,
							otherText: "Rewrite beat B with a different treatment.",
						},
					],
				}),
			})
		).json();
		// Presentation order: the plan blocker is listed first, so its answer is
		// applied first.
		expect(body.instructions).toEqual([
			"Rewrite beat B with a different treatment.",
			"Trim section 3.",
		]);
		// The acknowledged one is gone; the two awaiting a run are still open.
		expect(body.blockers.map((blocker: { message: string }) => blocker.message)).not.toContain(
			"Section 2 cites no source.",
		);
		expect(body.blockers).toHaveLength(2);
	});

	test("resolving parks no run and records no required action", async () => {
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		await app().request(`/projects/${id}/blockers/resolve`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ answers: [{ id: open[0].id, choice: "leave" }] }),
		});
		const run = (await listWorkflowRunsForProject(id))[0]!;
		expect(run.status).toBe("done");
		expect(await listPendingRequiredActions(run.id)).toEqual([]);
	});

	test("the read carries a batch the card can render", async () => {
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const body = await (await app().request(`/projects/${id}/blockers`)).json();
		expect(body.batch).toMatchObject({ purpose: "blocker", stage: "pre_generation" });
		expect(body.batch.questions).toHaveLength(1);
	});

	test("an acknowledged blocker is reported as acknowledged, not forgotten", async () => {
		// The delivery check still counts it, so the read has to be able to explain
		// why the batch shows fewer blockers than the score does.
		const id = await seed();
		await seedEvaluation(id, [durationFinding]);
		const open = (await (await app().request(`/projects/${id}/blockers`)).json()).blockers;
		await app().request(`/projects/${id}/blockers/acknowledge`, {
			method: "POST",
			headers: json,
			body: JSON.stringify({ ids: [open[0].id] }),
		});
		const after = await (await app().request(`/projects/${id}/blockers`)).json();
		expect(after.blockers).toEqual([]);
		expect(after.acknowledged).toHaveLength(1);
		expect(after.acknowledged[0].message).toBe("Runtime is 22s over the target.");
	});

	test("acknowledge rejects an empty body", async () => {
		const id = await seed();
		const res = await app().request(`/projects/${id}/blockers/acknowledge`, {
			method: "POST",
			headers: json,
			body: "{}",
		});
		expect(res.status).toBe(400);
	});
});
