/* adopt-mastra-internal-agent 2.2: the loop's guardrails under Mastra.
 *
 * Each case is the oracle's outcome (loop-finalize.test.ts and the finish /
 * ask branches of loop.ts), produced by the real internal agent driven by a
 * scripted model over a real project. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { RequestContext } from "@mastra/core/request-context";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import type { AgentJob } from "../../../model.ts";
import { createInternalAgent } from "../../agent.ts";
import { ASK_LIMIT, MAX_STEPS, settleRun } from "../../guardrails.ts";
import { runState } from "../../run-state.ts";
import type { AgentRunContext } from "../../tools/registry-tools.ts";
import { answer, callTool, scriptedModel, type turn } from "../support/scripted-model.ts";
import { savedVideoProject } from "../support/video-fixture.ts";

/** A run on a video project: empty, or holding a saved one-scene timeline. */
async function runOn(existing: "empty" | "saved"): Promise<AgentJob> {
	const projectId =
		existing === "saved"
			? await savedVideoProject("Guardrails")
			: (await createContentProject({ title: "Guardrails", type: "video" })).project.id;
	const job = await buildAgentJob({ projectId, instruction: "go", contentType: "video" });
	runState(job).instruction = "go";
	await saveRun(job);
	return job;
}

async function drive(job: AgentJob, turns: Array<ReturnType<typeof turn>>, maxSteps?: number) {
	const model = scriptedModel(turns);
	const context = new RequestContext<AgentRunContext>([
		["runId", job.id],
		["projectId", job.projectId],
		["contentType", job.contentType],
	]);
	const result = await createInternalAgent(model).generate("go", {
		requestContext: context,
		...(maxSteps ? { maxSteps } : {}),
	});
	const settled = (await loadRun(job.id))!;
	await settleRun(settled, result);
	return { model, result, run: (await loadRun(job.id))! };
}

const prompts = (model: ReturnType<typeof scriptedModel>) =>
	[...model.doGenerateCalls, ...model.doStreamCalls].map((call) => JSON.stringify(call.prompt));
const finalText = (job: AgentJob) => job.events.filter((event) => event.kind === "final").at(-1);

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
});

describe("finishing", () => {
	test("a run that built nothing finishes with the model's answer as its final event", async () => {
		const job = await runOn("saved");
		const { run } = await drive(job, [
			callTool("view_timeline", {}),
			answer("The timeline has one scene."),
		]);
		expect(run.status).toBe("done");
		expect(finalText(run)).toEqual({ kind: "final", text: "The timeline has one scene." });
		expect(run.run?.builtSomething).toBe(false);
	});

	test("a build run's answer is rejected while blocking findings remain, and the findings reach the model", async () => {
		const job = await runOn("empty");
		// A scene with no frame: the build's visual assets are missing, which blocks.
		const { model, run } = await drive(
			job,
			[
				callTool("add_scene", { name: "Opening", visual: "a lighthouse at dusk", durationSec: 4 }),
				answer("Done."),
				answer("Done again."),
			],
			3,
		);
		expect(run.run?.builtSomething).toBe(true);
		expect(run.run?.finishRejected).toBe(true);
		const afterAnswer = prompts(model)[2] ?? "";
		expect(afterAnswer).toContain("Finish rejected by the outcome gate");
		expect(afterAnswer).toContain("Apply the smallest scoped fixes");
		// The oracle: a build that ends with blocking findings parks for attention, never "done".
		expect(run.status).toBe("needs_attention");
		expect(finalText(run)?.text).toContain("Outcome needs attention");
	});
});

describe("the step limit", () => {
	test("a run that uses every step is finalized with its outcome evaluated", async () => {
		const job = await runOn("saved");
		const turns = Array.from({ length: MAX_STEPS }, (_, i) =>
			callTool("view_timeline", {}, `call-${i}`),
		);
		const { result, run } = await drive(job, turns);
		expect(result.steps.length).toBe(MAX_STEPS);
		expect(run.outcomeEvaluation).toBeDefined();
		// Built nothing, so it pauses rather than parking for attention.
		expect(run.status).toBe("done");
		expect(finalText(run)?.text).toContain("Paused after a long run");
	});
});

describe("asking the user", () => {
	test("ask_user suspends the run with a pending action and spends one ask", async () => {
		const job = await runOn("saved");
		const { result, run } = await drive(job, [
			callTool("ask_user", {
				question: "Which tone?",
				options: [
					{ label: "Warm", value: "warm" },
					{ label: "Dry", value: "dry" },
				],
			}),
		]);
		expect(result.finishReason).toBe("suspended");
		expect(run.status).toBe("awaiting_input");
		expect(run.pendingActionId).toBeTruthy();
		expect(run.run?.asks).toBe(1);
		expect(
			run.events.some((event) => event.kind === "question" && event.question === "Which tone?"),
		).toBe(true);
	});

	test("past the ask budget the question is skipped and the run continues on a default", async () => {
		const job = await runOn("saved");
		runState(job).asks = ASK_LIMIT;
		await saveRun(job);
		const { model, run } = await drive(job, [
			callTool("ask_user", { question: "Which tone?" }),
			answer("Kept the current tone."),
		]);
		expect(run.status).toBe("done");
		expect(run.pendingActionId).toBeUndefined();
		expect(prompts(model)[1]).toContain("pick the best default and proceed");
	});

	test("the story-brief checkpoint is exempt from the budget, once", async () => {
		const job = await runOn("empty");
		runState(job).asks = ASK_LIMIT;
		await saveRun(job);
		const first = await drive(job, [
			callTool("ask_user", { question: "Who is it for?", purpose: "story_brief" }),
		]);
		expect(first.run.status).toBe("awaiting_input");
		expect(first.run.run?.asks).toBe(ASK_LIMIT);

		// A second claim no longer qualifies, so it pays like any other question.
		first.run.status = "running";
		first.run.pendingActionId = undefined;
		await saveRun(first.run);
		const second = await drive(first.run, [
			callTool("ask_user", { question: "Again?", purpose: "story_brief" }),
			answer("Proceeding."),
		]);
		expect(second.run.status).toBe("done");
	});
});
