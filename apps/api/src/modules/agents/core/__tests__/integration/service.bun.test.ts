/* adopt-mastra-internal-agent 2.8: the AgentJob stays the product record.
 *
 * A run started on the Mastra runtime parks on a question; after a reload (the
 * process's job cache cleared, a fresh Mastra instance over the same store) the
 * conversation, the active run, its pending action and finally its result all
 * come back from the product record, not from Mastra. */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { Mastra } from "@mastra/core/mastra";
import { InMemoryStore } from "@mastra/core/storage";
import { closeMaleoDb } from "@maleo/db/connection";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { loadRun } from "../../run-repository.ts";
import { clearAgentJobsForTests, getLatestActiveJobForProject } from "../../session-store.ts";
import { savedVideoRun } from "../../runtime/__tests__/support/video-fixture.ts";
import { AGENT_WORKFLOWS, createInternalAgent } from "../../runtime/agent.ts";
import { answer, callTool, scriptedModel } from "../../runtime/__tests__/support/scripted-model.ts";
import { answerAgentRun, inProcessHost, startAgentRun } from "../../service.ts";

const videoRun = () =>
	savedVideoRun("Service", [
		{
			name: "Feed it daily",
			durationSec: 4,
			shot: "Close-up",
			move: "Static",
			transition: "fade",
			visual: "a jar",
			voiceover: "Feed it.",
			image: "/uploads/jar.png",
		},
	]);

beforeEach(() => clearWorkflowRunsForTests());
afterAll(async () => {
	await closeMaleoDb();
});

describe("a run on the Mastra runtime", () => {
	test("is restored from the product record after a reload: conversation, active run, pending action, then its result", async () => {
		const job = await videoRun();
		const model = scriptedModel([
			callTool("view_timeline", {}),
			callTool("ask_user", {
				question: "Warm or dry tone?",
				options: [
					{ label: "Warm", value: "warm" },
					{ label: "Dry", value: "dry" },
				],
			}),
			answer("Kept the warm tone."),
		]);
		const storage = new InMemoryStore();
		const boot = () =>
			inProcessHost(
				new Mastra({
					agents: { maleo: createInternalAgent(model) },
					workflows: AGENT_WORKFLOWS,
					storage,
					logger: false,
				}).getAgent("maleo"),
			);

		await startAgentRun(boot(), job, "tune the tone");

		// Reload: nothing in memory, a new runtime over the same durable state.
		clearAgentJobsForTests();
		const active = await getLatestActiveJobForProject(job.projectId);
		expect(active?.id).toBe(job.id);
		const parked = (await loadRun(job.id))!;
		expect(parked.status).toBe("awaiting_input");
		expect(parked.run?.instruction).toBe("tune the tone");
		expect(parked.pendingQuestion?.question).toBe("Warm or dry tone?");
		expect(parked.pendingActionId).toBeTruthy();
		const conversation = parked.events.filter(
			(event) =>
				event.kind === "tool_call_started" ||
				event.kind === "tool_call_completed" ||
				event.kind === "question",
		);
		expect(conversation.map((event) => event.kind)).toEqual([
			"tool_call_started",
			"tool_call_completed",
			"question",
		]);
		expect(conversation[1]?.kind === "tool_call_completed" && conversation[1].note).toContain(
			"Feed it daily",
		);

		expect(await answerAgentRun(boot(), job.id, parked.pendingActionId, "warm")).toBe("resumed");
		clearAgentJobsForTests();
		const done = (await loadRun(job.id))!;
		expect(done.status).toBe("done");
		expect(done.pendingActionId).toBeUndefined();
		expect(done.events.filter((event) => event.kind === "final").at(-1)).toEqual({
			kind: "final",
			text: "Kept the warm tone.",
		});
		expect(await getLatestActiveJobForProject(job.projectId)).toBeUndefined();
	});

	test("an answer to an action the run is not waiting on resumes nothing", async () => {
		const job = await videoRun();
		const model = scriptedModel([
			callTool("ask_user", { question: "Which scene?" }),
			answer("Done."),
		]);
		const agent = inProcessHost(
			new Mastra({
				agents: { maleo: createInternalAgent(model) },
				workflows: AGENT_WORKFLOWS,
				storage: new InMemoryStore(),
				logger: false,
			}).getAgent("maleo"),
		);
		await startAgentRun(agent, job, "edit a scene");
		const parked = (await loadRun(job.id))!;

		expect(await answerAgentRun(agent, job.id, "an-older-action", "first")).toBe("stale");
		expect((await loadRun(job.id))!.status).toBe("awaiting_input");

		expect(await answerAgentRun(agent, job.id, parked.pendingActionId, "first")).toBe("resumed");
		// The same answer delivered twice: the run is no longer waiting on that action.
		expect(await answerAgentRun(agent, job.id, parked.pendingActionId, "first")).toBe("stale");
		expect((await loadRun(job.id))!.events.filter((event) => event.kind === "final")).toHaveLength(
			1,
		);
	});
});
