import { expect, test } from "vite-plus/test";
import {
	validateWorkflow,
	workflowNodes,
	type WorkflowDefinition,
	type WorkflowKnown,
} from "./workflow-definition.ts";

const operations: Record<string, { prompts: string[]; tools: string[] }> = {
	"op.frame": { prompts: ["prompt:frame"], tools: [] },
	"op.research": { prompts: [], tools: ["research_topic"] },
	"op.ask": { prompts: [], tools: [] },
	"op.answer": { prompts: [], tools: [] },
};
function known(workflows: WorkflowDefinition[] = []): WorkflowKnown {
	return {
		operation: (id) => operations[id],
		rules: new Set(["plan.approvedExists"]),
		facts: new Set(["run.approveAll"]),
		contracts: new Set(["plan"]),
		workflows: new Map(workflows.map((workflow) => [workflow.id, workflow])),
	};
}
const valid: WorkflowDefinition = {
	id: "plan",
	root: {
		type: "sequence",
		id: "root",
		steps: [
			{
				type: "step",
				id: "frame",
				op: "op.frame",
				in: { brief: "input.brief", n: { value: 3 } },
				out: "state.frame",
				prompts: ["prompt:frame"],
			},
			{
				type: "branch",
				id: "needs-research",
				if: { and: [{ eq: ["state.frame.grounding", true] }, { empty: "state.research" }] },
				then: {
					type: "step",
					id: "research",
					op: "op.research",
					out: "state.research",
					tools: ["research_topic"],
					onError: "continue",
				},
			},
			{
				type: "suspend",
				id: "ask",
				kind: "approval",
				ask: "op.ask",
				onAnswer: "op.answer",
				skipIf: { fact: "run.approveAll" },
			},
			{
				type: "branch",
				id: "approved",
				if: { rule: "plan.approvedExists" },
				then: { type: "end", id: "kept", outcome: { ok: false, note: "Kept." } },
			},
			{ type: "end", id: "done", outcome: { ok: true, note: "$state.note" } },
		],
	},
};

test("a valid definition has no errors and lists its nodes in order", () => {
	expect(validateWorkflow(valid, known())).toEqual([]);
	expect(workflowNodes(valid.root).map((node) => node.id)).toEqual([
		"root",
		"frame",
		"needs-research",
		"research",
		"ask",
		"approved",
		"kept",
		"done",
	]);
});

test("unknown references name the definition and node", () => {
	const bad: WorkflowDefinition = {
		id: "bad",
		root: {
			type: "sequence",
			id: "root",
			steps: [
				{ type: "step", id: "a", op: "op.missing" },
				{
					type: "branch",
					id: "b",
					if: { rule: "nope" },
					then: { type: "end", id: "c", outcome: { ok: true, note: "" } },
				},
				{
					type: "branch",
					id: "d",
					if: { eq: ["fact:nope", 1] },
					then: { type: "end", id: "e", outcome: { ok: true, note: "" } },
				},
				{ type: "step", id: "f", op: "op.frame", in: { x: "run.raw" }, prompts: ["prompt:frame"] },
				{ type: "call", id: "g", workflow: "ghost", in: {}, contract: "nope" },
				{ type: "suspend", id: "h", kind: "questions", ask: "op.ask", onAnswer: "op.gone" },
			],
		},
	};
	expect(validateWorkflow(bad, known())).toEqual([
		'workflow "bad" node "a": unknown operation "op.missing"',
		'workflow "bad" node "b" if: unknown rule "nope"',
		'workflow "bad" node "d" if: unknown fact "nope"',
		'workflow "bad" node "f" in.x: "run.raw" is not an input., state. or fact: path',
		'workflow "bad" node "g": unknown workflow "ghost"',
		'workflow "bad" node "g": unknown contract "nope"',
		'workflow "bad" node "h": unknown operation "op.gone"',
	]);
});

test("declared prompts and tools must equal the operation's", () => {
	const drift: WorkflowDefinition = {
		id: "drift",
		root: { type: "step", id: "frame", op: "op.frame", prompts: [], tools: ["research_topic"] },
	};
	expect(validateWorkflow(drift, known())).toEqual([
		'workflow "drift" node "frame": prompts [] do not match operation "op.frame" ["prompt:frame"]',
		'workflow "drift" node "frame": tools ["research_topic"] do not match operation "op.frame" []',
	]);
});

test("duplicate ids, reserved forEach and bad shapes are rejected", () => {
	const errors = validateWorkflow(
		{
			id: "dup",
			root: {
				type: "sequence",
				id: "x",
				steps: [
					{ type: "end", id: "x", outcome: { ok: true, note: "" } },
					{ type: "forEach", id: "loop" },
					{
						type: "branch",
						id: "b",
						if: { eq: ["state.a"] } as never,
						then: { type: "end", id: "y", outcome: { ok: true, note: "" } },
					},
				],
			},
		},
		known(),
	);
	expect(errors).toContain('workflow "dup": node id "x" is used twice');
	expect(errors).toContain('workflow "dup" node "loop": node type "forEach" is not yet supported');
	expect(errors).toContain('workflow "dup" node "b" if: eq takes [path, literal]');
});

test("direct and indirect call cycles are rejected", () => {
	const a: WorkflowDefinition = {
		id: "a",
		root: { type: "call", id: "to-b", workflow: "b", in: {} },
	};
	const b: WorkflowDefinition = {
		id: "b",
		root: { type: "call", id: "to-a", workflow: "a", in: {} },
	};
	const self: WorkflowDefinition = {
		id: "self",
		root: { type: "call", id: "me", workflow: "self", in: {} },
	};
	expect(validateWorkflow(a, known([a, b]))).toEqual([
		'workflow "a": calls itself directly or indirectly',
	]);
	expect(validateWorkflow(self, known([self]))).toEqual([
		'workflow "self": calls itself directly or indirectly',
	]);
	expect(
		validateWorkflow(
			{
				id: "c",
				root: { type: "call", id: "to-plan", workflow: "plan", in: { brief: "input.brief" } },
			},
			known([valid]),
		),
	).toEqual([]);
});
