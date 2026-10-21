/* expose-direct-mcp-tools 1.1–1.2: a single-tool run.
 *
 * The real agent on the in-process host, with a model that must never be asked:
 * the run is driven by its direct call alone. It appears as the project's run,
 * reports its tool in the chat, settles with the tool's result, and an edit of
 * existing work waits for approval like any run's. */
import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { closeMaleoDb } from "@maleo/db/connection";
import { getContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { loadRun } from "../../run-repository.ts";
import { clearAgentJobsForTests, getLatestActiveJobForProject } from "../../session-store.ts";
import { setSceneFrameGeneratorForTests } from "../../visual-gen.ts";
import { savedVideoRun } from "../../runtime/__tests__/support/video-fixture.ts";
import type { AgentJob } from "../../model.ts";
import { AGENT_WORKFLOWS, createInternalAgent } from "../../runtime/agent.ts";
import { scriptedModel } from "../../runtime/__tests__/support/scripted-model.ts";
import { answerAgentRun, inProcessHost, startDirectRun, type RunHost } from "../../service.ts";

/** A host whose own model has no turns: any call to it throws. */
function host(): RunHost {
	return inProcessHost(
		new Mastra({
			agents: { maleo: createInternalAgent(scriptedModel([])) },
			workflows: AGENT_WORKFLOWS,
			storage: new InMemoryStore(),
			logger: false,
		}).getAgent("maleo"),
	);
}

const video = () => savedVideoRun("Direct");

const run = async (job: AgentJob) => (await loadRun(job.id))!;
const finals = (job: AgentJob) =>
	job.events.flatMap((event) => (event.kind === "final" ? [event.text] : []));

beforeEach(async () => {
	await clearWorkflowRunsForTests();
	clearAgentJobsForTests();
});
afterEach(() => setSceneFrameGeneratorForTests(null));
afterAll(async () => {
	await closeMaleoDb();
});

describe("a single-tool run", () => {
	test("makes exactly the asked call in the project chat and settles with its result", async () => {
		const job = await video();
		const args = { name: "Rest it between feeds", visual: "a calendar", voiceover: "Let it rest." };
		await startDirectRun(host(), job, { tool: "add_scene", args, callId: "direct-1" });

		const done = await run(job);
		expect(done.status).toBe("done");
		expect(done.scenes.map((scene) => scene.name)).toEqual([
			"Feed it daily",
			"Rest it between feeds",
		]);
		expect(
			done.events
				.filter((event) => event.kind === "tool_call_started")
				.map((event) => event.kind === "tool_call_started" && event.tool),
		).toEqual(["add_scene"]);
		expect(finals(done)).toEqual(["Added scene 2: Rest it between feeds"]);
		expect(done.run?.instruction).toBe(`add_scene ${JSON.stringify(args)}`);
		// Settled into the editor: the project's saved timeline has the scene.
		expect(
			JSON.stringify((await getContentProject(job.projectId))?.storyboards[0]?.storyboard_json),
		).toContain("Rest it between feeds");
		expect(await getLatestActiveJobForProject(job.projectId)).toBeUndefined();
	});

	test("is the project's active run while it works", async () => {
		const job = await video();
		let release!: () => void;
		const held = new Promise<void>((resolve) => {
			release = resolve;
		});
		setSceneFrameGeneratorForTests(async (scene) => {
			await held;
			return `/uploads/${scene.visual}.png`;
		});
		await startDirectRun(
			host(),
			job,
			{ tool: "generate_frame", args: { index: 0 }, callId: "direct-2" },
			{ background: true },
		);

		expect((await getLatestActiveJobForProject(job.projectId))?.id).toBe(job.id);
		release();
		for (let i = 0; i < 200 && (await run(job)).status === "running"; i++) await Bun.sleep(10);
		const done = await run(job);
		expect(done.status).toBe("done");
		expect(done.scenes[0]?.image).toBe("/uploads/a jar.png");
	});
});

describe("a single-tool run that changes existing work", () => {
	async function parked() {
		const job = await video();
		const h = host();
		await startDirectRun(h, job, {
			tool: "update_scene",
			args: { index: 0, name: "Feed it twice a day" },
			callId: "direct-3",
		});
		return { job, h, current: await run(job) };
	}

	test("waits for approval before anything changes", async () => {
		const { current } = await parked();
		expect(current.status).toBe("awaiting_input");
		expect(current.pendingActionId).toBeTruthy();
		expect(current.pendingQuestion?.question).toContain("Update scene 1");
		expect(current.scenes[0]?.name).toBe("Feed it daily");
	});

	test("approved, the change is applied once and the run settles", async () => {
		const { job, h, current } = await parked();
		expect(await answerAgentRun(h, job.id, current.pendingActionId, "approve")).toBe("resumed");
		const done = await run(job);
		expect(done.status).toBe("done");
		expect(done.scenes[0]?.name).toBe("Feed it twice a day");
		expect(done.events.filter((event) => event.kind === "tool_call_started")).toHaveLength(1);
		expect(await answerAgentRun(h, job.id, current.pendingActionId, "approve")).toBe("stale");
	});

	test("rejected, nothing changes and the run settles saying so", async () => {
		const { job, h, current } = await parked();
		expect(await answerAgentRun(h, job.id, current.pendingActionId, "reject")).toBe("resumed");
		const done = await run(job);
		expect(done.status).toBe("done");
		expect(done.scenes[0]?.name).toBe("Feed it daily");
		expect(finals(done).at(-1)).toContain("Not changed — not approved");
	});

	test("a stale action id resumes nothing", async () => {
		const { job, h } = await parked();
		expect(await answerAgentRun(h, job.id, "an-older-action", "approve")).toBe("stale");
		expect((await run(job)).status).toBe("awaiting_input");
	});
});
