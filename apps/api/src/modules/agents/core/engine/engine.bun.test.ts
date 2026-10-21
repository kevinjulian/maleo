import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { WorkflowDefinition } from "@maleo/shared";
import type { AgentJob } from "../model.ts";
import { runFlow, startRecord, WorkflowNodeError, type EngineHost } from "./engine.ts";
import type { FlowRecord } from "./flow-record.ts";
import { createEngineRegistry } from "./registry.ts";
import { defineOperation, type Operation } from "./types.ts";

const calls: string[] = [];
const handlers = new Map<string, Operation["run"]>();
const op = (
	id: string,
	run: Operation["run"] = async () => ({ value: id }),
	output: z.ZodTypeAny = z.unknown(),
): Operation => {
	handlers.set(id, run);
	return defineOperation({
		id,
		description: id,
		input: z.object({ text: z.string().optional() }).passthrough(),
		output,
		prompts: [],
		tools: [],
		capabilities: [],
		run: async (input, context) => {
			calls.push(id);
			return handlers.get(id)!(input, context);
		},
	});
};

const operations = [
	op("op.a"),
	op("op.b", async (input) => ({ echoed: input.text ?? "" })),
	op("op.fail", async () => {
		throw new Error("synthetic failure");
	}),
	op("op.ask", async () => ({ question: "Approve?", actionId: "action-1" })),
	op("op.answer", async (_input, context) => ({ answer: context.answer })),
	op("op.badOutput", async () => ({ n: "not a number" }), z.object({ n: z.number() })),
];

function registry(definitions: WorkflowDefinition[], facts: Record<string, string | boolean> = {}) {
	return createEngineRegistry({
		definitions,
		operations,
		facts: Object.entries(facts).map(([id, value]) => ({ id, description: id, read: () => value })),
		rules: [{ id: "rule.yes", description: "", test: async () => true }],
		contracts: ["plan"],
	});
}

function host(
	definitions: WorkflowDefinition[],
	over: Partial<EngineHost> = {},
	facts?: Record<string, string | boolean>,
) {
	const saved: FlowRecord[] = [];
	const value: EngineHost & { saved: FlowRecord[] } = {
		registry: registry(definitions, facts),
		// SAFETY: the engine reads only id and pendingActionId of the job; these operations ignore it.
		job: { id: "run-1", pendingActionId: "action-1" } as AgentJob,
		toolCallId: "call-1",
		executionId: "exec-1",
		save: async (record) => {
			saved.push(record);
		},
		cancelled: async () => false,
		saved,
		...over,
	};
	return value;
}

type Node = WorkflowDefinition["root"];
const seq = (id: string, ...steps: Node[]): Node => ({ type: "sequence", id, steps });
const step = (
	id: string,
	opId: string,
	extra: Partial<Extract<Node, { type: "step" }>> = {},
): Node => ({ type: "step", id, op: opId, ...extra });

describe("engine", () => {
	test("steps run in order, write outputs immutably and save after every node", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq(
				"root",
				step("a", "op.a", { out: "state.a" }),
				step("b", "op.b", { in: { text: "state.a.value" }, out: "state.b" }),
				{ type: "end", id: "end", outcome: { ok: true, note: "$state.b.echoed" } },
			),
		};
		const h = host([definition]);
		const start = startRecord(h.registry, "w", {});
		const result = await runFlow(h, start);
		expect(result).toEqual({ status: "completed", outcome: { ok: true, note: "op.a" } });
		expect(calls).toEqual(["op.a", "op.b"]);
		expect(start.state).toEqual({});
		const last = h.saved.at(-1)!;
		expect(last.state).toEqual({ a: { value: "op.a" }, b: { echoed: "op.a" } });
		expect(last.done).toEqual(["a", "b", "end"]);
		expect(h.saved[0]!.done).toEqual(["a"]);
		expect(last.trace.map((entry) => [entry.node, entry.outcome])).toEqual([
			["a", "completed"],
			["b", "completed"],
			["end", "completed"],
		]);
		expect(last.trace[0]).toMatchObject({
			runId: "run-1",
			workflow: "w",
			revision: start.revision,
		});
	});

	test("branches take the matching path; the skipped side leaves no trace", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq(
				"root",
				{
					type: "branch",
					id: "if-fact",
					if: { eq: ["fact:mode", "x"] },
					then: step("then", "op.a"),
					else: step("else", "op.b"),
				},
				{
					type: "branch",
					id: "if-rule",
					if: { rule: "rule.yes" },
					then: step("rule-then", "op.a"),
				},
				{
					type: "branch",
					id: "if-none",
					if: { exists: "state.missing" },
					then: step("never", "op.b"),
				},
			),
		};
		const h = host([definition], {}, { mode: "y" });
		await runFlow(h, startRecord(h.registry, "w", {}));
		const last = h.saved.at(-1)!;
		expect(calls).toEqual(["op.b", "op.a"]);
		expect(last.branches).toEqual({ "if-fact": "else", "if-rule": "then", "if-none": "none" });
		expect(last.trace.find((entry) => entry.node === "if-none")?.branch).toBe("none");
		expect(last.trace.some((entry) => entry.node === "never" || entry.node === "then")).toBe(false);
	});

	test("an end inside a called workflow ends only that workflow", async () => {
		calls.length = 0;
		const core: WorkflowDefinition = {
			id: "core",
			root: seq(
				"core-root",
				{
					type: "end",
					id: "early",
					outcome: { ok: true, note: "not re-planning" },
					unchanged: true,
				},
				step("after-end", "op.b"),
			),
		};
		const outer: WorkflowDefinition = {
			id: "outer",
			root: seq(
				"root",
				{
					type: "call",
					id: "call-core",
					workflow: "core",
					in: { brief: "input.brief" },
					out: "state.core",
				},
				step("after-call", "op.a"),
				{ type: "end", id: "done", from: "state.core" },
			),
		};
		const h = host([core, outer]);
		const result = await runFlow(h, startRecord(h.registry, "outer", { brief: "b" }));
		expect(calls).toEqual(["op.a"]);
		expect(result).toEqual({
			status: "completed",
			outcome: { ok: true, note: "not re-planning", unchanged: true },
		});
		const last = h.saved.at(-1)!;
		expect(last.calls["call-core"]?.input).toEqual({ brief: "b" });
		expect(last.calls["call-core"]?.status).toBe("completed");
	});

	test("a best-effort step records its failure and continues with no output", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq(
				"root",
				step("style", "op.fail", { out: "state.style", onError: "continue" }),
				step("after", "op.a"),
			),
		};
		const h = host([definition]);
		expect((await runFlow(h, startRecord(h.registry, "w", {}))).status).toBe("completed");
		const last = h.saved.at(-1)!;
		expect(last.state.style).toBeUndefined();
		expect(last.trace[0]).toMatchObject({
			node: "style",
			outcome: "continued",
			error: "synthetic failure",
		});
		expect(calls).toEqual(["op.fail", "op.a"]);
	});

	test("a failing step without continue fails the workflow; a bad output never reaches state", async () => {
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq("root", step("bad", "op.badOutput", { out: "state.n" }), step("after", "op.a")),
		};
		const h = host([definition]);
		await expect(runFlow(h, startRecord(h.registry, "w", {}))).rejects.toBeInstanceOf(
			WorkflowNodeError,
		);
		const last = h.saved.at(-1)!;
		expect(last.status).toBe("failed");
		expect(last.state.n).toBeUndefined();
		expect(last.trace.at(-1)).toMatchObject({ node: "bad", outcome: "failed" });
	});

	test("suspend asks, saves the cursor, and resumes at the same node with the answer", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq(
				"root",
				step("before", "op.a"),
				{
					type: "suspend",
					id: "gate",
					kind: "approval",
					ask: "op.ask",
					onAnswer: "op.answer",
					out: "state.answer",
				},
				{ type: "end", id: "done", outcome: { ok: true, note: "$state.answer.answer" } },
			),
		};
		const h = host([definition]);
		const first = await runFlow(h, startRecord(h.registry, "w", {}));
		expect(first).toEqual({
			status: "suspended",
			question: { question: "Approve?", actionId: "action-1" },
		});
		const parked = h.saved.at(-1)!;
		expect(parked).toMatchObject({ status: "suspended", cursor: "gate" });
		expect(parked.trace.at(-1)).toMatchObject({
			node: "gate",
			outcome: "suspended",
			pendingActionId: "action-1",
		});
		calls.length = 0;
		const resumed = await runFlow({ ...h, answer: "Approve" }, parked);
		expect(resumed).toEqual({ status: "completed", outcome: { ok: true, note: "Approve" } });
		expect(calls).toEqual(["op.answer"]);
	});

	test("a suspend whose skip condition holds asks nothing", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq(
				"root",
				{
					type: "suspend",
					id: "gate",
					kind: "approval",
					ask: "op.ask",
					onAnswer: "op.answer",
					skipIf: { fact: "run.approveAll" },
				},
				step("after", "op.a"),
			),
		};
		const h = host([definition], {}, { "run.approveAll": true });
		expect((await runFlow(h, startRecord(h.registry, "w", {}))).status).toBe("completed");
		expect(calls).toEqual(["op.a"]);
		expect(h.saved.at(-1)!.trace[0]).toMatchObject({ node: "gate", outcome: "skipped" });
	});

	test("cancellation is checked before every node", async () => {
		calls.length = 0;
		let stop = false;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq("root", step("a", "op.a"), step("b", "op.b")),
		};
		const h = host([definition], { cancelled: async () => stop });
		handlers.set("op.a", async () => {
			stop = true;
			return { value: "op.a" };
		});
		try {
			expect(await runFlow(h, startRecord(h.registry, "w", {}))).toEqual({ status: "cancelled" });
		} finally {
			handlers.set("op.a", async () => ({ value: "op.a" }));
		}
		expect(calls).toEqual(["op.a"]);
		expect(h.saved.at(-1)!.status).toBe("cancelled");
	});

	test("a resumed record skips completed nodes", async () => {
		calls.length = 0;
		const definition: WorkflowDefinition = {
			id: "w",
			root: seq("root", step("a", "op.a"), step("b", "op.b")),
		};
		const h = host([definition]);
		await runFlow(h, { ...startRecord(h.registry, "w", {}), done: ["a"] });
		expect(calls).toEqual(["op.b"]);
	});
});
