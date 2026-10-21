import { expect, test } from "bun:test";
import { z } from "zod";
import type { WorkflowDefinition } from "@maleo/shared";
import { putJobArtifact } from "../artifact-store.ts";
import type { AgentJob } from "../model.ts";
import { setResearch } from "../research-state.ts";
import { ENGINE_CONTRACT_NAMES, stageContracts } from "./contracts.ts";
import { runFlow, startRecord } from "./engine.ts";
import { createEngineRegistry } from "./registry.ts";
import { defineOperation } from "./types.ts";

const research = {
	topic: "seeds",
	queries: ["seeds"],
	sources: [
		{
			title: "Seed study",
			url: "https://example.test/seed",
			excerpt: "A seed absorbs water before it sprouts.",
			retrievedAt: "2026-10-14T00:00:00.000Z",
		},
	],
	claims: [],
};
const operations = [
	defineOperation({
		id: "op.research",
		description: "",
		input: z.object({}),
		output: z.unknown(),
		prompts: [],
		tools: [],
		capabilities: [],
		run: async (_input, context) => {
			setResearch(context.job, research);
			return {};
		},
	}),
	defineOperation({
		id: "op.outOfContract",
		description: "",
		input: z.object({}),
		output: z.unknown(),
		prompts: [],
		tools: [],
		capabilities: [],
		run: async (_input, context) => {
			putJobArtifact(
				context.job,
				"timeline",
				{},
				{ type: "tool", tool: "probe", runId: context.job.id },
			);
			return {};
		},
	}),
];

function run(core: WorkflowDefinition["root"]) {
	const definitions: WorkflowDefinition[] = [
		{ id: "core", root: core },
		{
			id: "outer",
			root: {
				type: "sequence",
				id: "root",
				steps: [
					{
						type: "call",
						id: "plan",
						workflow: "core",
						in: {},
						out: "state.plan",
						contract: "plan",
					},
					{ type: "end", id: "done", from: "state.plan" },
				],
			},
		},
	];
	const registry = createEngineRegistry({
		definitions,
		operations,
		facts: [],
		rules: [],
		contracts: ENGINE_CONTRACT_NAMES,
	});
	// SAFETY: these operations and the contract wrapper read only id, projectId, artifacts and direction-free context fields.
	const job = {
		id: "run-contract",
		projectId: "project-1",
		artifacts: [],
		events: [],
		brief: "seeds",
	} as unknown as AgentJob;
	return {
		job,
		result: runFlow(
			{
				registry,
				job,
				toolCallId: "call",
				executionId: "exec",
				save: async () => {},
				cancelled: async () => false,
				contract: stageContracts(job),
			},
			startRecord(registry, "outer", {}),
		),
	};
}

test("a write outside the contract fails the node and the stage reports the failure", async () => {
	const { job, result } = run({ type: "step", id: "write", op: "op.outOfContract" });
	const outcome = await result;
	expect(outcome.status === "completed" && outcome.outcome.ok).toBe(false);
	expect(outcome.status === "completed" && outcome.outcome.note).toContain(
		"may not write timeline: it is not in the stage's contract",
	);
	expect(job.events.map((event) => event.kind)).toEqual([
		"tool_call_started",
		"tool_call_completed",
	]);
});

test("a missing required output fails the call's outcome and its writes are settled", async () => {
	const { job, result } = run({
		type: "sequence",
		id: "core-root",
		steps: [
			{ type: "step", id: "research", op: "op.research" },
			{ type: "end", id: "done", outcome: { ok: true, note: "planned" } },
		],
	});
	expect(await result).toEqual({
		status: "completed",
		outcome: {
			ok: false,
			note: "stage plan completed without producing story_plan, storyboard_table",
		},
	});
	const bundle = job.artifacts.find((artifact) => artifact.kind === "research_bundle");
	expect(bundle?.status).toBe("complete");
	expect(bundle?.producer).toMatchObject({ type: "stage", stage: "plan" });
	expect(
		job.events
			.filter((event) => event.kind === "tool_call_started")
			.map((event) => event.kind === "tool_call_started" && event.tool),
	).toEqual(["plan_story"]);
});

test("an end that declares it produced nothing owes no outputs", async () => {
	const { result } = run({
		type: "end",
		id: "preserve",
		outcome: { ok: true, note: "not re-planning" },
		unchanged: true,
	});
	expect(await result).toEqual({
		status: "completed",
		outcome: { ok: true, note: "not re-planning", unchanged: true },
	});
});
