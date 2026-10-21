import { expect, test } from "bun:test";
import { z } from "zod";
import type { WorkflowDefinition } from "@maleo/shared";
import { createEngineRegistry, workflowRevision, type EngineRegistryInput } from "./registry.ts";
import { defineOperation } from "./types.ts";

const frame = defineOperation({
	id: "op.frame",
	description: "Frame.",
	input: z.object({}),
	output: z.object({}),
	prompts: ["prompt:content:storyFramePrompt"],
	tools: [],
	capabilities: ["llm:text"],
	run: async () => ({}),
});
const base = (
	definitions: WorkflowDefinition[],
	over: Partial<EngineRegistryInput> = {},
): EngineRegistryInput => ({
	definitions,
	operations: [frame],
	facts: [{ id: "run.approveAll", description: "", read: () => false }],
	rules: [{ id: "plan.approvedExists", description: "", test: () => false }],
	contracts: ["plan"],
	...over,
});
const workflow = (root: WorkflowDefinition["root"], id = "w"): WorkflowDefinition => ({ id, root });

test("a valid registry returns definitions with a content revision", () => {
	const definition = workflow({
		type: "step",
		id: "frame",
		op: "op.frame",
		prompts: ["prompt:content:storyFramePrompt"],
	});
	const registry = createEngineRegistry(base([definition]));
	expect(registry.get("w")?.revision).toBe(workflowRevision(definition));
	expect(
		workflowRevision(
			workflow({
				type: "step",
				id: "frame2",
				op: "op.frame",
				prompts: ["prompt:content:storyFramePrompt"],
			}),
		),
	).not.toBe(registry.get("w")?.revision);
});

test.each([
	[
		"operation",
		{ type: "step", id: "a", op: "op.missing" },
		'node "a": unknown operation "op.missing"',
	],
	[
		"rule",
		{
			type: "branch",
			id: "a",
			if: { rule: "nope" },
			then: { type: "end", id: "b", outcome: { ok: true, note: "" } },
		},
		'unknown rule "nope"',
	],
	[
		"fact",
		{
			type: "branch",
			id: "a",
			if: { fact: "nope" },
			then: { type: "end", id: "b", outcome: { ok: true, note: "" } },
		},
		'unknown fact "nope"',
	],
	[
		"prompt",
		{ type: "step", id: "a", op: "op.frame", prompts: ["prompt:other"] },
		'prompts ["prompt:other"] do not match operation "op.frame"',
	],
	[
		"tool",
		{
			type: "step",
			id: "a",
			op: "op.frame",
			prompts: ["prompt:content:storyFramePrompt"],
			tools: ["research_topic"],
		},
		'tools ["research_topic"] do not match operation "op.frame"',
	],
	["workflow", { type: "call", id: "a", workflow: "ghost", in: {} }, 'unknown workflow "ghost"'],
	[
		"contract",
		{ type: "call", id: "a", workflow: "w", in: {}, contract: "nope" },
		'unknown contract "nope"',
	],
] as const)("loading fails on an unknown %s", (_kind, root, message) => {
	expect(() => createEngineRegistry(base([workflow(root as WorkflowDefinition["root"])]))).toThrow(
		message,
	);
});

test("duplicate registrations fail", () => {
	expect(() => createEngineRegistry(base([], { operations: [frame, frame] }))).toThrow(
		'operation "op.frame" is registered twice',
	);
});
