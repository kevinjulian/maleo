/* Artifacts persist in the run snapshot, and completing a stage is atomic
 * (standardize-pipeline-artifact-contracts 6.1, 6.2). A stage's writes are in
 * progress while it commits; the runner marks them complete together with the
 * cursor advance, so a crash mid-commit leaves the run at the same stage with only
 * in-progress outputs — which no other stage consumes and the re-entered stage
 * completes. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { closeMaleoDb } from "@maleo/db/connection";
import { artifactRefOf, resolveArtifactRef } from "@maleo/shared";
import {
	createStageRegistry,
	runPipeline,
	type PipelineRun,
	type Stage,
	type StageCommitResult,
	type StageInputs,
} from "./pipeline.ts";
import { currentProducer, jobArtifactById, putJobArtifact } from "./artifact-store.ts";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { loadRun, markRunAbandoned, saveRun } from "./run-repository.ts";
import type { AgentJob } from "./model.ts";
import type { StageContract } from "./stage-contracts.ts";

const plan = {
	targetSec: 30,
	sections: [{ id: "s1", title: "One", narration: "n", visualPrompt: "v" }],
};

function job(): AgentJob {
	return {
		id: `run-${crypto.randomUUID()}`,
		projectId: "p",
		contentType: "video",
		status: "running",
		events: [],
		scenes: [],
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: "b",
		startedAt: 0,
		run: {
			instruction: "",
			transcript: "",
			step: 0,
			builtSomething: false,
			finishRejected: false,
			asks: 0,
		},
	};
}

const drafts: StageContract = { requires: [], produces: [{ kind: "story_plan" }] };
const consumes: StageContract = {
	requires: [{ kind: "story_plan", schemaVersion: 1 }],
	produces: [{ kind: "knowledge" }],
};

function stage(
	id: Stage["id"],
	contract: StageContract,
	commit: (ctx: AgentJob, inputs: StageInputs) => Promise<StageCommitResult>,
): Stage<AgentJob> {
	return {
		id,
		costsAssets: false,
		consumes: [],
		...contract,
		produce: async () => ({
			operation: "create",
			targetsExisting: false,
			summary: id,
			payload: { kind: "gate" },
		}),
		commit: (ctx, _draft, inputs) => commit(ctx, inputs),
	};
}

const pipelineRun = (
	cursor: "plan" | "scaffold" = "plan",
	stages: Array<"plan" | "scaffold"> = ["plan", "scaffold"],
): PipelineRun => ({
	profile: {
		contentType: "video",
		granularity: "section",
		narrationFirst: true,
		researchFirst: false,
		stages,
	},
	cursor,
	mode: "auto",
	status: "running",
});
const planOnly = () => pipelineRun("plan", ["plan"]);
const scaffoldOnly = () => pipelineRun("scaffold", ["scaffold"]);

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
});

describe("artifacts persist in the run (6.1)", () => {
	test("a completed run's artifacts are readable by id, by exact content, after reload", async () => {
		const current = job();
		const result = await runPipeline(
			current,
			createStageRegistry([
				stage("plan", drafts, async (ctx) => {
					putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
					return { status: "completed" };
				}),
				stage("scaffold", consumes, async (ctx) => {
					putJobArtifact(ctx, "knowledge", { title: "k", body: "b" }, currentProducer(ctx));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(result.status).toBe("done");
		current.run!.pipeline = result.run;
		await saveRun(current);

		const reloaded = (await loadRun(current.id))!;
		for (const artifact of current.artifacts) {
			expect(jobArtifactById(reloaded, artifact.id)).toEqual(artifact);
			expect(
				resolveArtifactRef(artifactRefOf(artifact), (id) => jobArtifactById(reloaded, id)).ok,
			).toBe(true);
		}
		expect(reloaded.artifacts.map((artifact) => artifact.status)).toEqual(["complete", "complete"]);
	});
});

describe("completing a stage is atomic (6.2)", () => {
	test("a crash mid-commit leaves only in-progress output and the cursor where it was", async () => {
		const current = job();
		const crashing = stage("plan", drafts, async (ctx) => {
			putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
			throw new Error("process died");
		});
		const before = planOnly();
		await expect(runPipeline(current, createStageRegistry([crashing]), before)).rejects.toThrow(
			"process died",
		);
		// What a snapshot taken now would hold: the output in progress, the cursor unadvanced.
		current.run!.pipeline = before;
		await saveRun(current);
		const reloaded = (await loadRun(current.id))!;
		expect(reloaded.artifacts.map((artifact) => [artifact.kind, artifact.status])).toEqual([
			["story_plan", "in_progress"],
		]);
		expect(reloaded.run?.pipeline?.cursor).toBe("plan");
	});

	test("no other stage consumes a crashed stage's in-progress output", async () => {
		const current = job();
		await expect(
			runPipeline(
				current,
				createStageRegistry([
					stage("plan", drafts, async (ctx) => {
						putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
						throw new Error("process died");
					}),
				]),
				planOnly(),
			),
		).rejects.toThrow();
		let consumed = false;
		const result = await runPipeline(
			current,
			createStageRegistry([
				stage("scaffold", consumes, async () => {
					consumed = true;
					return { status: "completed" };
				}),
			]),
			scaffoldOnly(),
		);
		expect(consumed).toBe(false);
		expect(result).toMatchObject({ status: "failed", error: { code: "input_not_ready" } });
	});

	test("the re-entered stage reuses its progress and completes output and cursor together", async () => {
		const current = job();
		await expect(
			runPipeline(
				current,
				createStageRegistry([
					stage("plan", drafts, async (ctx) => {
						putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
						throw new Error("process died");
					}),
				]),
				planOnly(),
			),
		).rejects.toThrow();
		const progressId = current.artifacts[0]!.id;
		// The durable host re-enters the stage; it finds its own progress and finishes.
		const result = await runPipeline(
			current,
			createStageRegistry([
				stage("plan", drafts, async (ctx) => {
					putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
					return { status: "completed" };
				}),
				stage("scaffold", consumes, async (ctx, inputs) => {
					expect(inputs.get("story_plan")?.status).toBe("complete");
					putJobArtifact(ctx, "knowledge", { title: "k", body: "b" }, currentProducer(ctx));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(result.status).toBe("done");
		expect(current.artifacts.find((artifact) => artifact.kind === "story_plan")).toMatchObject({
			id: progressId,
			status: "complete",
			revision: 2,
		});
	});

	test("a stage re-entered after a crash may require its own in-progress output", async () => {
		const current = job();
		const selfRequiring: StageContract = {
			requires: [{ kind: "story_plan", schemaVersion: 1 }],
			produces: [{ kind: "story_plan" }],
		};
		putJobArtifact(current, "story_plan", plan, { type: "editor" });
		await expect(
			runPipeline(
				current,
				createStageRegistry([
					stage("scaffold", selfRequiring, async (ctx) => {
						putJobArtifact(ctx, "story_plan", { ...plan, targetSec: 40 }, currentProducer(ctx));
						throw new Error("process died");
					}),
				]),
				scaffoldOnly(),
			),
		).rejects.toThrow();
		const result = await runPipeline(
			current,
			createStageRegistry([
				stage("scaffold", selfRequiring, async (ctx, inputs) => {
					putJobArtifact(
						ctx,
						"story_plan",
						inputs.get("story_plan")!.payload,
						currentProducer(ctx),
					);
					return { status: "completed" };
				}),
			]),
			scaffoldOnly(),
		);
		expect(result.status).toBe("done");
	});

	test("an abandoned run's leftover progress is settled", async () => {
		const current = job();
		await expect(
			runPipeline(
				current,
				createStageRegistry([
					stage("plan", drafts, async (ctx) => {
						putJobArtifact(ctx, "story_plan", plan, currentProducer(ctx));
						throw new Error("process died");
					}),
				]),
				planOnly(),
			),
		).rejects.toThrow();
		current.status = "awaiting_input";
		await saveRun(current);
		await markRunAbandoned(current.id, "timed out");
		expect((await loadRun(current.id))!.artifacts.map((artifact) => artifact.status)).toEqual([
			"complete",
		]);
	});
});
