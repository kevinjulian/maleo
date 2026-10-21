/* A workflow definition run as an agent tool, over a real Mastra instance: it
 * suspends at its question node, the process restarts, the user answers, and the
 * run continues at the next node without repeating the nodes before it. */
import { afterAll, beforeEach, expect, test } from "bun:test";
import { z } from "zod";
import { Agent } from "@mastra/core/agent";
import { Mastra } from "@mastra/core/mastra";
import { RequestContext } from "@mastra/core/request-context";
import { InMemoryStore } from "@mastra/core/storage";
import { closeMaleoDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import { clearWorkflowRunsForTests } from "@maleo/db/workflow-run-db";
import { buildAgentJob } from "../../../run-bracket.ts";
import { loadRun, saveRun } from "../../../run-repository.ts";
import { clearAgentJobsForTests } from "../../../session-store.ts";
import { createEngineRegistry } from "../../../engine/registry.ts";
import { defineOperation } from "../../../engine/types.ts";
import { workflowTool } from "../../tools/workflow-tools.ts";
import type { AgentRunContext } from "../../tools/registry-tools.ts";
import { answer, callTool, scriptedModel } from "../support/scripted-model.ts";

const ran: string[] = [];
const operation = (id: string, run: (answer?: string) => unknown = () => ({ id })) =>
	defineOperation({
		id,
		description: id,
		input: z.object({}).passthrough(),
		output: z.unknown(),
		prompts: [],
		tools: [],
		capabilities: [],
		run: async (_input, context) => {
			ran.push(id);
			return run(context.answer);
		},
	});

const registry = createEngineRegistry({
	definitions: [
		{
			id: "probe",
			root: {
				type: "sequence",
				id: "root",
				steps: [
					{ type: "step", id: "frame", op: "op.frame", out: "state.frame" },
					{
						type: "suspend",
						id: "questions",
						kind: "questions",
						ask: "op.ask",
						onAnswer: "op.answer",
						out: "state.answer",
					},
					{ type: "step", id: "draft", op: "op.draft", out: "state.draft" },
					{ type: "end", id: "done", outcome: { ok: true, note: "$state.answer.text" } },
				],
			},
		},
	],
	operations: [
		operation("op.frame"),
		operation("op.ask", () => ({ question: "Which audience?" })),
		operation("op.answer", (text) => ({ text })),
		operation("op.draft"),
	],
	facts: [],
	rules: [],
	contracts: [],
});
const probe = workflowTool({
	id: "workflow-probe",
	description: "Probe workflow.",
	inputSchema: z.object({}),
	workflow: "probe",
	registry: () => registry,
});

beforeEach(() => clearWorkflowRunsForTests());
afterAll(closeMaleoDb);

test("a suspended definition survives a restart and resumes at the next node", async () => {
	const projectId = (await createContentProject({ title: "Engine suspension", type: "video" }))
		.project.id;
	const job = await buildAgentJob({
		projectId,
		instruction: "probe",
		brief: "probe",
		contentType: "video",
	});
	await saveRun(job);
	const model = scriptedModel([callTool("workflow-probe", {}), answer("Done.")]);
	const storage = new InMemoryStore();
	const boot = () =>
		new Mastra({
			agents: {
				probe: new Agent({
					id: "probe",
					name: "probe",
					instructions: "Call the tool.",
					model,
					tools: { "workflow-probe": probe },
				}),
			},
			storage,
			logger: false,
		}).getAgent("probe");
	const requestContext = new RequestContext<AgentRunContext>([
		["runId", job.id],
		["projectId", job.projectId],
		["contentType", job.contentType],
	]);

	const first = await boot().generate("go", { requestContext });
	expect(first.finishReason).toBe("suspended");
	expect(ran).toEqual(["op.frame", "op.ask"]);
	const parked = (await loadRun(job.id))!.run!.flows!["call-workflow-probe"]!;
	expect(parked).toMatchObject({
		workflow: "probe",
		status: "suspended",
		cursor: "questions",
		revision: registry.get("probe")!.revision,
	});
	expect(parked.done).toEqual(["frame"]);

	// A fresh process: no job in memory, a new agent over the same durable store.
	clearAgentJobsForTests();
	const resumed = await boot().resumeGenerate(
		{ answer: "Beginners" },
		{ runId: first.runId!, requestContext },
	);
	expect(resumed.finishReason).not.toBe("suspended");
	expect(ran).toEqual(["op.frame", "op.ask", "op.answer", "op.draft"]);
	const record = (await loadRun(job.id))!.run!.flows!["call-workflow-probe"]!;
	expect(record.status).toBe("completed");
	expect(record.outcome).toEqual({ ok: true, note: "Beginners" });
	expect(record.trace.map((entry) => [entry.node, entry.outcome])).toEqual([
		["frame", "completed"],
		["questions", "suspended"],
		["questions", "completed"],
		["draft", "completed"],
		["done", "completed"],
	]);
});
