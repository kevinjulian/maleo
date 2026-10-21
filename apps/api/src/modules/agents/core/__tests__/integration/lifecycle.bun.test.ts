/* adopt-mastra-internal-agent 2.9: a run's lifecycle across restarts.
 *
 * The in-process host over shared durable state: a "restart" is a fresh Mastra
 * instance over the same store with nothing in memory. Approve, deny, stale and
 * duplicate answers, cancel, the input timeout, one run per project, and a crash
 * on either side of a stage's save. (The real Inngest host is
 * exercised by runtime/__tests__/integration/durable.live.bun.test.ts.) */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { putJobArtifact, currentProducer } from "../../artifact-store.ts";
import type { Stage, StageCommitResult } from "../../pipeline.ts";
import { buildAgentJob, startAgentJob } from "../../run-bracket.ts";
import { loadRun, saveRun } from "../../run-repository.ts";
import { clearAgentJobsForTests, JOBS } from "../../session-store.ts";
import { setSceneFrameGeneratorForTests } from "../../visual-gen.ts";
import { getStoryPlan } from "../../plan-state.ts";
import { runState } from "../../runtime/run-state.ts";
import {
	draftShortPlan,
	installStoryProviders,
	providerCalls,
	removeStoryProviders,
} from "../../runtime/__tests__/support/story-fixture.ts";
import type { AgentJob } from "../../model.ts";
import { AGENT_WORKFLOWS, createInternalAgent } from "../../runtime/agent.ts";
import { runStage } from "../../runtime/workflows/stage-step.ts";
import {
	answer,
	callTool,
	scriptedModel,
	type turn,
} from "../../runtime/__tests__/support/scripted-model.ts";
import {
	abandonStaleWaits,
	answerAgentRun,
	cancelAgentRun,
	inProcessHost,
	startAgentRun,
	type RunHost,
} from "../../service.ts";

/* Story asset generation is the run whose gate this suite exercises: it parks
 * for plan approval before anything is spent, and generation is offline through
 * the story fixture's provider seams. */
async function videoRun(prepare?: (job: AgentJob) => void): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "Lifecycle", type: "video" })).project.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "make a story",
		brief: "a lighthouse keeper's last night",
		contentType: "video",
	});
	runState(job).instruction = "make a story";
	prepare?.(job);
	await saveRun(job);
	return job;
}

/** A video run holding two scenes, for tools that act on existing scenes. */
async function twoSceneRun(): Promise<AgentJob> {
	const projectId = (await createContentProject({ title: "Lifecycle", type: "video" })).project.id;
	const scene = (name: string) => ({
		name,
		durationSec: 3,
		shot: "wide",
		move: "static",
		transition: "cut",
		visual: `${name} visual`,
		voiceover: `${name} voiceover`,
	});
	const job = await buildAgentJob({
		projectId,
		instruction: "",
		brief: "a lighthouse keeper's last night",
		contentType: "video",
		scenes: [scene("s1"), scene("s2")],
	});
	await saveRun(job);
	return job;
}

/** A process: a fresh runtime over the durable store; `restart` boots another with nothing in memory. */
function processes(turns: Array<ReturnType<typeof turn>>) {
	const model = scriptedModel(turns);
	const storage = new InMemoryStore();
	const boot = (): RunHost =>
		inProcessHost(
			new Mastra({
				agents: { maleo: createInternalAgent(model) },
				workflows: AGENT_WORKFLOWS,
				storage,
				logger: false,
			}).getAgent("maleo"),
		);
	return {
		host: boot(),
		restart: () => {
			clearAgentJobsForTests();
			return boot();
		},
	};
}

/** Frame generation blocks until released, so a run can be held mid-flight. */
function holdFrames(): () => void {
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	setSceneFrameGeneratorForTests(async () => {
		await gate;
		return `/uploads/frame-${++providerCalls.frames}.png`;
	});
	return release;
}

/** Until the run's first tool call has started. */
async function untilToolStarted(job: AgentJob): Promise<void> {
	while (!JOBS.get(job.id)?.events.some((event) => event.kind === "tool_call_started"))
		await Bun.sleep(5);
}

const generate = callTool("workflow-generate_story_assets", { inputData: {} });
const run = async (job: AgentJob) => (await loadRun(job.id))!;
/** Paid provider work so far: speech and frames. */
const spent = () => providerCalls.speech + providerCalls.frames;

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	installStoryProviders();
});
afterEach(() => removeStoryProviders());
afterAll(async () => {
	await closeMaleoDb();
});

describe("answering across a restart", () => {
	test("approve: the parked generation resumes in a new process and renders", async () => {
		const job = await videoRun(draftShortPlan);
		const { host, restart } = processes([generate, answer("Generated.")]);
		await startAgentRun(host, job, "make a story");
		const action = (await run(job)).pendingActionId;
		expect(action).toBeTruthy();
		expect(spent()).toBe(0);

		expect(await answerAgentRun(restart(), job.id, action, "approve")).toBe("resumed");
		const current = await run(job);
		expect(current.status).toBe("done");
		expect(current.scenes.length).toBeGreaterThan(0);
		expect(current.scenes.every((scene) => Boolean(scene.image))).toBe(true);
		expect(providerCalls.frames).toBeGreaterThan(0);
	});

	test("reject: the plan stays, it waits for a revision, and nothing is generated", async () => {
		const job = await videoRun(draftShortPlan);
		const { host, restart } = processes([generate, answer("Kept the plan.")]);
		await startAgentRun(host, job, "make a story");
		const action = (await run(job)).pendingActionId;
		expect(await answerAgentRun(restart(), job.id, action, "reject")).toBe("resumed");
		const current = await run(job);
		expect(current.status).toBe("awaiting_input");
		expect(current.run?.awaitingRevision).toBe(true);
		expect(current.pendingActionId).not.toBe(action);
		expect(getStoryPlan(current)?.sections.map((section) => section.title)).toEqual(["Last watch"]);
		expect(current.scenes.every((scene) => !scene.image)).toBe(true);
		expect(spent()).toBe(0);
	});

	test("a stale answer and a duplicate answer resume nothing, and the work runs once", async () => {
		const job = await videoRun(draftShortPlan);
		const { host, restart } = processes([generate, answer("Generated.")]);
		await startAgentRun(host, job, "make a story");
		const action = (await run(job)).pendingActionId;

		expect(await answerAgentRun(restart(), job.id, "an-earlier-action", "approve")).toBe("stale");
		expect((await run(job)).status).toBe("awaiting_input");
		expect(spent()).toBe(0);

		const second = restart();
		expect(await answerAgentRun(second, job.id, action, "approve")).toBe("resumed");
		const afterResume = spent();
		expect(afterResume).toBeGreaterThan(0);
		expect(await answerAgentRun(second, job.id, action, "approve")).toBe("stale");
		expect(spent()).toBe(afterResume);
		expect((await run(job)).events.filter((event) => event.kind === "final")).toHaveLength(1);
	});
});

describe("stopping a run", () => {
	test("a parked run ends at once, and a later answer resumes nothing", async () => {
		const job = await videoRun(draftShortPlan);
		const { host, restart } = processes([generate, answer("Generated.")]);
		await startAgentRun(host, job, "make a story");
		const action = (await run(job)).pendingActionId;

		expect(await cancelAgentRun(job.id)).toBe("error");
		const stopped = await run(job);
		expect(stopped.error).toBe("Run stopped by user.");
		expect(stopped.pendingActionId).toBeUndefined();
		expect(stopped.events.at(-1)).toEqual({ kind: "final", text: "Stopped." });

		expect(await answerAgentRun(restart(), job.id, action, "approve")).toBe("stale");
		expect(spent()).toBe(0);
	});

	test("a run stopped mid-flight makes no further change, and its end is not overwritten", async () => {
		const job = await twoSceneRun();
		const { host } = processes([
			callTool("generate_frame", { index: 0 }),
			callTool("add_scene", { name: "s3", visual: "v3", voiceover: "vo3" }),
			answer("Done."),
		]);
		const release = holdFrames();
		const started = startAgentRun(host, job, "illustrate it");
		await untilToolStarted(job);
		expect(await cancelAgentRun(job.id)).toBe("error");
		release();
		await started;

		const current = await run(job);
		expect(current.status).toBe("error");
		expect(current.error).toBe("Run stopped by user.");
		expect(current.scenes.map((scene) => scene.name)).toEqual(["s1", "s2"]);
		expect(
			current.events
				.filter((event) => event.kind === "final")
				.map((event) => event.kind === "final" && event.text),
		).toEqual(["Stopped."]);
	});
});

describe("the input timeout", () => {
	test("a run waiting past it is abandoned without an answer, and a late answer resumes nothing", async () => {
		const job = await videoRun(draftShortPlan);
		const { host, restart } = processes([generate, answer("Generated.")]);
		await startAgentRun(host, job, "make a story");
		const action = (await run(job)).pendingActionId;

		expect(await abandonStaleWaits(Date.now() + 60_000)).toEqual([]);
		expect(await abandonStaleWaits(Date.now() + 25 * 60 * 60 * 1000)).toEqual([job.id]);
		const abandoned = await run(job);
		expect(abandoned.status).toBe("error");
		expect(abandoned.error).toContain("timed out awaiting input");
		expect(abandoned.scenes.every((scene) => !scene.image)).toBe(true);

		expect(await answerAgentRun(restart(), job.id, action, "approve")).toBe("stale");
		expect(spent()).toBe(0);
	});
});

describe("one active run per project", () => {
	test("a second run for a project with one in flight is that same run", async () => {
		const job = await twoSceneRun();
		const { host } = processes([callTool("generate_frame", { index: 0 }), answer("Done.")]);
		const release = holdFrames();
		const started = startAgentRun(host, job, "illustrate it");
		await untilToolStarted(job);
		const second = await startAgentJob({
			projectId: job.projectId,
			instruction: "make another",
			contentType: "video",
		});
		release();
		await started;
		expect(second.id).toBe(job.id);
	});
});

describe("a crash inside a workflow step", () => {
	/** A plan stage that drafts a plan, dying on its first attempt where `die` says. */
	function scaffoldStage(die: "in-stage" | "none") {
		const counter = { attempts: 0 };
		const stage: Stage<AgentJob> = {
			id: "plan",
			costsAssets: false,
			consumes: [],
			requires: [],
			produces: [{ kind: "story_plan" }],
			produce: async () => ({
				operation: "create",
				targetsExisting: false,
				summary: "s",
				payload: { kind: "gate" },
			}),
			commit: async (current): Promise<StageCommitResult> => {
				counter.attempts += 1;
				putJobArtifact(
					current,
					"story_plan",
					{
						targetSec: 8,
						sections: [
							{ id: "s1", title: "c1", narration: "n", visualPrompt: "v", estimatedDurationSec: 8 },
						],
					},
					currentProducer(current),
				);
				if (die === "in-stage" && counter.attempts === 1) throw new Error("process died");
				return { status: "completed" };
			},
		};
		return { stage, counter };
	}
	/** The saved plans: each one's status and its section titles. A new run starts with none. */
	const decks = async (job: AgentJob) =>
		(await run(job)).artifacts
			.filter((artifact) => artifact.kind === "story_plan")
			.map((artifact) => [
				artifact.status,
				(getStoryPlan({ ...job, artifacts: [artifact] })?.sections ?? []).map(
					(section) => section.title,
				),
			]);

	test("before the stage's outputs are saved: the retried step runs the stage again, once complete", async () => {
		const job = await videoRun();
		const { stage, counter } = scaffoldStage("in-stage");
		await expect(runStage(job, "storyPlan", stage, "wf-1:plan")).rejects.toThrow("process died");
		expect(await decks(job)).toEqual([]);

		// The durable host retries the step on a fresh process.
		clearAgentJobsForTests();
		expect((await runStage(await run(job), "storyPlan", stage, "wf-1:plan")).ok).toBe(true);
		expect(await decks(job)).toEqual([["complete", ["c1"]]]);
		expect(counter.attempts).toBe(2);
	});

	test("after the outputs are saved, before the workflow records the step: the retry returns the saved outcome without running the stage", async () => {
		const job = await videoRun();
		const { stage, counter } = scaffoldStage("none");
		const first = await runStage(job, "storyPlan", stage, "wf-1:plan");
		// The process dies here: the workflow never snapshots the step's result.

		clearAgentJobsForTests();
		expect(await runStage(await run(job), "storyPlan", stage, "wf-1:plan")).toEqual(first);
		expect(await decks(job)).toEqual([["complete", ["c1"]]]);
		expect(counter.attempts).toBe(1);

		// The same stage in another workflow run is new work.
		await runStage(await run(job), "storyPlan", stage, "wf-2:plan");
		expect(counter.attempts).toBe(2);
	});
});
