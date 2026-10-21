/* The runner's side of the artifact contract (standardize-pipeline-artifact-
 * contracts 5.1a, 4.3): a stage gets what it requires as resolved inputs, sees and
 * writes only its contract's kinds, and its result is built from what it wrote. */
import { describe, expect, test } from "bun:test";
import { pipelineArtifactKinds, writeArtifact, type PipelineArtifact } from "@maleo/shared";
import {
	createStageRegistry,
	runPipeline,
	type PipelineRun,
	type Stage,
	type StageCommitResult,
	type StageInputs,
} from "./pipeline.ts";
import {
	ArtifactScopeError,
	currentProducer,
	jobArtifactsOfKind,
	putJobArtifact,
} from "./artifact-store.ts";
import { knowledgeArtifact, researchBundleArtifact } from "@maleo/shared";
import type { StageContract } from "./stage-contracts.ts";

interface Run {
	id: string;
	projectId: string;
	artifacts: PipelineArtifact[];
	run?: undefined;
}

const plan = {
	targetSec: 30,
	sections: [{ id: "s1", title: "One", narration: "n", visualPrompt: "v" }],
};
const research = { topic: "t", sources: [], claimCount: 0 };

function run(
	...entries: Array<{ kind: string; payload: unknown; status?: "in_progress" | "complete" }>
): Run {
	const artifacts = entries.reduce<PipelineArtifact[]>(
		(list, entry) =>
			writeArtifact(pipelineArtifactKinds, list, {
				...entry,
				producer: { type: "editor" },
				projectId: "p",
			}).artifacts,
		[],
	);
	return { id: "run-1", projectId: "p", artifacts };
}

function stage(
	contract: StageContract,
	commit: (ctx: Run, inputs: StageInputs) => Promise<StageCommitResult>,
): Stage<Run> {
	return {
		id: "scaffold",
		costsAssets: false,
		consumes: [],
		...contract,
		produce: async () => ({
			operation: "create",
			targetsExisting: false,
			summary: "s",
			payload: { kind: "gate" as const },
		}),
		commit: (ctx, _draft, inputs) => commit(ctx, inputs),
	};
}

const pipelineRun = (): PipelineRun => ({
	profile: {
		contentType: "video",
		granularity: "section",
		narrationFirst: true,
		researchFirst: false,
		stages: ["scaffold"],
	},
	cursor: "scaffold",
	mode: "auto",
	status: "running",
});

const needsPlan: StageContract = {
	requires: [{ kind: "story_plan", schemaVersion: 1 }],
	produces: [{ kind: "knowledge" }],
};

describe("a stage sees and writes only its contract", () => {
	test("reading a kind outside the contract throws inside the stage", async () => {
		const ctx = run(
			{ kind: "story_plan", payload: plan },
			{ kind: "research_bundle", payload: research },
		);
		const result = runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					jobArtifactsOfKind(job, researchBundleArtifact);
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		await expect(result).rejects.toThrow(ArtifactScopeError);
	});

	test("writing a kind outside the contract throws inside the stage", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		const result = runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					putJobArtifact(job, "research_bundle", research, currentProducer(job));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		await expect(result).rejects.toThrow(ArtifactScopeError);
	});

	test("outside a stage the run reads everything again", async () => {
		const ctx = run(
			{ kind: "story_plan", payload: plan },
			{ kind: "research_bundle", payload: research },
		);
		await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					putJobArtifact(job, "knowledge", { title: "k", body: "b" }, currentProducer(job));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(jobArtifactsOfKind(ctx, researchBundleArtifact)).toHaveLength(1);
	});

	test("a reader outside the stage — a request polling the run — is not scoped while it commits", async () => {
		const ctx = run(
			{ kind: "story_plan", payload: plan },
			{ kind: "research_bundle", payload: research },
		);
		let release!: () => void;
		let entered!: () => void;
		const committing = new Promise<void>((resolve) => {
			entered = resolve;
		});
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		const result = runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					entered();
					await held;
					putJobArtifact(job, "knowledge", { title: "k", body: "b" }, currentProducer(job));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		await committing;
		expect(jobArtifactsOfKind(ctx, researchBundleArtifact)).toHaveLength(1);
		expect(currentProducer(ctx)).toMatchObject({ type: "tool" });
		release();
		expect((await result).status).toBe("done");
	});
});

describe("inputs are resolved before the stage runs", () => {
	test("the stage receives its required artifact", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		let seen: PipelineArtifact | undefined;
		await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job, inputs) => {
					seen = inputs.get("story_plan");
					putJobArtifact(job, "knowledge", { title: "k", body: "b" }, currentProducer(job));
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(seen?.kind).toBe("story_plan");
	});

	test("a missing required input fails the stage without running it, with the operator's next step", async () => {
		let ran = false;
		const contract: StageContract = {
			requires: [{ kind: "story_plan", schemaVersion: 1, whenMissing: "Plan first." }],
			produces: [],
		};
		const result = await runPipeline(
			run(),
			createStageRegistry([
				stage(contract, async () => {
					ran = true;
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(ran).toBe(false);
		expect(result).toMatchObject({
			status: "failed",
			stage: "scaffold",
			error: { code: "missing_input", message: "Plan first." },
		});
	});

	test("an unready required input fails the stage without running it", async () => {
		let ran = false;
		const ctx = run({ kind: "story_plan", payload: plan, status: "in_progress" });
		const result = await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async () => {
					ran = true;
					return { status: "completed" };
				}),
			]),
			pipelineRun(),
		);
		expect(ran).toBe(false);
		expect(result).toMatchObject({ status: "failed", error: { code: "input_not_ready" } });
	});
});

describe("the result is what the stage wrote", () => {
	test("a completed result's outputs are the artifacts written, attributed to the stage", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		const result = await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					putJobArtifact(job, "knowledge", { title: "k", body: "b" }, currentProducer(job));
					return { status: "completed", note: "done" };
				}),
			]),
			pipelineRun(),
		);
		expect(result.status).toBe("done");
		const outputs =
			result.status === "done" && result.results[0]!.status === "completed"
				? result.results[0]!.outputs
				: [];
		expect(outputs.map((artifact) => artifact.kind)).toEqual(["knowledge"]);
		expect(jobArtifactsOfKind(ctx, knowledgeArtifact)[0]!.producer).toEqual({
			type: "stage",
			stage: "scaffold",
			runId: "run-1",
		});
	});

	test("completing without a declared output fails the stage (4.3)", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		const result = await runPipeline(
			ctx,
			createStageRegistry([stage(needsPlan, async () => ({ status: "completed" }))]),
			pipelineRun(),
		);
		expect(result).toMatchObject({ status: "failed", error: { code: "missing_output" } });
	});

	test("a failed commit is the stage's failure, structured", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		const result = await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async () => ({
					status: "failed",
					error: { code: "generation_failed", message: "down", retryable: true },
				})),
			]),
			pipelineRun(),
		);
		expect(result).toMatchObject({
			status: "failed",
			error: { code: "generation_failed", retryable: true },
			notes: ["down"],
		});
	});

	test("a stage that parks for the user keeps its outputs in progress and the run at that stage", async () => {
		const ctx = run({ kind: "story_plan", payload: plan });
		const result = await runPipeline(
			ctx,
			createStageRegistry([
				stage(needsPlan, async (job) => {
					putJobArtifact(
						job,
						"knowledge",
						{ title: "half", body: "drafted before the question" },
						currentProducer(job),
					);
					return { status: "suspended", note: "waiting on the user" };
				}),
			]),
			pipelineRun(),
		);
		expect(result).toMatchObject({
			status: "suspended",
			stage: "scaffold",
			note: "waiting on the user",
			run: { cursor: "scaffold" },
		});
		// Not complete: nothing downstream may consume it, and the re-entered stage reuses it.
		expect(jobArtifactsOfKind(ctx, knowledgeArtifact)[0]!.status).toBe("in_progress");
	});
});
