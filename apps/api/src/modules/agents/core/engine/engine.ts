/* The workflow engine: runs a definition node by node inside one agent tool call.
 *
 * Every node yields a new flow record; nothing is mutated in place. After each
 * node the host saves the record together with the run, so a process that dies
 * resumes at the first node not recorded as done — completed nodes never run
 * again. A node interrupted before its save may run again; its generations are
 * keyed by run, tool call and node path, so the retry reuses the earlier attempt
 * and is charged once (generation-scope.ts).
 *
 * Conditions read only the workflow input, the flow state and registered facts
 * and rules. Cancellation is checked before every node. */
import {
	evaluateExpression,
	expressionReferences,
	readPath,
	workflowNodes,
	type Expression,
	type WorkflowBindings,
	type WorkflowNode,
	textOf,
} from "@maleo/shared";
import { withGenerationScope } from "../../../../lib/generation/generation-scope.ts";
import type { AgentJob } from "../model.ts";
import {
	toFlowValue,
	type BranchTaken,
	type FlowOutcome,
	type FlowRecord,
	type FlowTraceEntry,
	type TraceOutcome,
} from "./flow-record.ts";
import type { EngineRegistry } from "./registry.ts";
import { runInOperationScope } from "../../../../lib/capability-scope.ts";
import type { FlowState, FlowValue, Operation } from "./types.ts";

export interface SuspendQuestion {
	question: string;
	actionId?: string;
	/** What the paused work reports, when it says more than the question. */
	note?: string;
}

export interface EngineHost {
	registry: EngineRegistry;
	job: AgentJob;
	toolCallId: string;
	/** The durable execution the tool call runs in; generation keys start with it. */
	executionId: string;
	/** Save the record with the run, in one write. */
	save(record: FlowRecord): Promise<void>;
	/** Whether the run was stopped; checked before every node. */
	cancelled(): Promise<boolean>;
	/** The answer the tool call resumed with, consumed by the suspend node it was asked at. */
	answer?: string;
	/** Wrap a called workflow that declares a stage contract (stage scope, settlement, outputs). */
	contract?(
		name: string,
		node: string,
		input: unknown,
		run: () => Promise<EngineResult>,
	): Promise<EngineResult>;
	now?(): number;
}

export type EngineResult =
	| { status: "completed"; outcome: FlowOutcome }
	| { status: "suspended"; question: SuspendQuestion }
	| { status: "cancelled" };

/** How a node hands control back to its parent. */
type Signal =
	| { kind: "next" }
	| { kind: "end"; outcome: FlowOutcome }
	| { kind: "suspend"; question: SuspendQuestion }
	| { kind: "cancelled" };
const NEXT: Signal = { kind: "next" };

interface Scope {
	get(): FlowRecord;
	set(next: FlowRecord): Promise<void>;
	/** The node path prefix inside the tool call, for generation keys. */
	path: string;
}

export class WorkflowNodeError extends Error {
	constructor(
		readonly workflow: string,
		readonly node: string,
		readonly cause: unknown,
	) {
		super(
			`workflow "${workflow}" node "${node}" failed: ${cause instanceof Error ? cause.message : String(cause)}`,
		);
	}
}

/** A fresh record for a workflow, pinned to the definition the registry returns now. */
export function startRecord(
	registry: EngineRegistry,
	workflow: string,
	input: unknown,
): FlowRecord {
	const entry = registry.get(workflow);
	if (!entry) throw new Error(`unknown workflow "${workflow}"`);
	return {
		workflow,
		revision: entry.revision,
		definition: entry.definition,
		input: toFlowValue(input),
		status: "running",
		state: {},
		done: [],
		branches: {},
		calls: {},
		trace: [],
	};
}

/** Run, or resume, a record to completion, suspension or cancellation. */
export async function runFlow(host: EngineHost, record: FlowRecord): Promise<EngineResult> {
	let root = record;
	const scope: Scope = {
		get: () => root,
		set: async (next) => {
			root = next;
			await host.save(root);
		},
		path: "",
	};
	return await runRecord(host, scope, { answer: host.answer });
}

interface Pending {
	/** The resume answer, until a suspend node consumes it. */
	answer?: string;
}

async function runRecord(host: EngineHost, scope: Scope, pending: Pending): Promise<EngineResult> {
	const record = scope.get();
	if (record.status === "completed" && record.outcome)
		return { status: "completed", outcome: record.outcome };
	if (record.status !== "running") await scope.set({ ...scope.get(), status: "running" });
	const signal = await execNode(host, scope, record.definition.root, pending);
	if (signal.kind === "suspend") return { status: "suspended", question: signal.question };
	if (signal.kind === "cancelled") {
		await scope.set({ ...scope.get(), status: "cancelled" });
		return { status: "cancelled" };
	}
	const outcome = signal.kind === "end" ? signal.outcome : { ok: true, note: "" };
	await scope.set({ ...scope.get(), status: "completed", cursor: undefined, outcome });
	return { status: "completed", outcome };
}

/* ── reading ── */

function reader(host: EngineHost, record: FlowRecord) {
	return (path: string): unknown => {
		if (path.startsWith("fact:")) {
			const fact = host.registry.fact(path.slice("fact:".length));
			if (!fact) throw new Error(`unknown fact "${path}"`);
			return fact.read({ job: host.job });
		}
		if (path === "input") return record.input;
		if (path.startsWith("input.")) return readPath(record.input, path.slice("input.".length));
		if (path.startsWith("state.")) return readPath(record.state, path.slice("state.".length));
		throw new Error(`unreadable path "${path}"`);
	};
}

function bound(
	host: EngineHost,
	record: FlowRecord,
	bindings: WorkflowBindings | undefined,
): Record<string, unknown> {
	const read = reader(host, record);
	return Object.fromEntries(
		Object.entries(bindings ?? {}).map(([name, binding]) => [
			name,
			typeof binding === "string" ? read(binding) : binding.value,
		]),
	);
}

async function evaluate(
	host: EngineHost,
	record: FlowRecord,
	expression: Expression,
): Promise<boolean> {
	// Rules are code and may be async; resolve the ones named before the pure evaluation.
	const rules = new Map<string, boolean>();
	for (const id of expressionReferences(expression).rules) {
		const rule = host.registry.rule(id);
		if (!rule) throw new Error(`unknown rule "${id}"`);
		rules.set(id, await rule.test({ job: host.job }));
	}
	const read = reader(host, record);
	return evaluateExpression(expression, {
		read,
		rule: (id) => rules.get(id) ?? false,
		fact: (id) => read(`fact:${id}`),
	});
}

/* ── writing ── */

function withValue(state: FlowState, path: string, value: FlowValue): FlowState {
	const [head, ...rest] = path.slice("state.".length).split(".");
	if (!rest.length) return { ...state, [head!]: value };
	const inner = state[head!];
	// SAFETY: a non-null, non-array flow value is the object member of FlowValue, whose values are flow values.
	const child: FlowState =
		inner && typeof inner === "object" && !Array.isArray(inner) ? (inner as FlowState) : {};
	return { ...state, [head!]: withValue(child, `state.${rest.join(".")}`, value) };
}

function traced(
	host: EngineHost,
	record: FlowRecord,
	node: WorkflowNode,
	startedAt: number,
	outcome: TraceOutcome,
	extra: Partial<FlowTraceEntry> = {},
): FlowTraceEntry[] {
	const operation = node.type === "step" ? host.registry.operation(node.op) : undefined;
	return [
		...record.trace,
		{
			runId: host.job.id,
			workflow: record.workflow,
			node: node.id,
			revision: record.revision,
			startedAt,
			endedAt: (host.now ?? Date.now)(),
			outcome,
			prompts: [...(operation?.prompts ?? [])],
			tools: [...(operation?.tools ?? [])],
			...extra,
		},
	];
}

async function finish(
	host: EngineHost,
	scope: Scope,
	node: WorkflowNode,
	startedAt: number,
	outcome: TraceOutcome,
	change: Partial<FlowRecord> = {},
	extra: Partial<FlowTraceEntry> = {},
): Promise<void> {
	const record = scope.get();
	await scope.set({
		...record,
		...change,
		done: [...record.done, node.id],
		trace: traced(host, record, node, startedAt, outcome, extra),
	});
}

/* ── operations ── */

async function runOperation(
	host: EngineHost,
	scope: Scope,
	node: WorkflowNode,
	operation: Operation,
	input: Record<string, unknown>,
	answer?: string,
): Promise<FlowValue> {
	const record = scope.get();
	const parsed = operation.input.parse(input);
	const key = `${host.executionId}:${host.toolCallId}:${scope.path}${node.id}`;
	const call = () =>
		operation.run(parsed, {
			job: host.job,
			state: record.state,
			answer,
			toolCallId: host.toolCallId,
		});
	const output = await withGenerationScope(key, () =>
		operation.unscoped ? call() : runInOperationScope(operation, call),
	);
	// Validated before anything reaches flow state; a failing output fails the node.
	return toFlowValue(operation.output.parse(output));
}

function operationFor(host: EngineHost, id: string): Operation {
	const operation = host.registry.operation(id);
	if (!operation) throw new Error(`unknown operation "${id}"`);
	return operation;
}

/* ── nodes ── */

async function execNode(
	host: EngineHost,
	scope: Scope,
	node: WorkflowNode,
	pending: Pending,
): Promise<Signal> {
	const record = scope.get();
	if (record.done.includes(node.id)) return NEXT;
	if (await host.cancelled()) return { kind: "cancelled" };
	const startedAt = (host.now ?? Date.now)();
	switch (node.type) {
		case "sequence": {
			for (const child of node.steps) {
				const signal = await execNode(host, scope, child, pending);
				if (signal.kind !== "next") return signal;
			}
			await finish(host, scope, node, startedAt, "completed");
			return NEXT;
		}
		case "branch": {
			let taken: BranchTaken | undefined = scope.get().branches[node.id];
			if (!taken) {
				taken = (await evaluate(host, scope.get(), node.if)) ? "then" : node.else ? "else" : "none";
				await scope.set({
					...scope.get(),
					branches: { ...scope.get().branches, [node.id]: taken },
				});
			}
			const child = taken === "then" ? node.then : taken === "else" ? node.else : undefined;
			const signal = child ? await execNode(host, scope, child, pending) : NEXT;
			if (signal.kind !== "next") return signal;
			await finish(host, scope, node, startedAt, "completed", {}, { branch: taken });
			return NEXT;
		}
		case "step": {
			const operation = operationFor(host, node.op);
			let output: FlowValue;
			try {
				output = await runOperation(
					host,
					scope,
					node,
					operation,
					bound(host, scope.get(), node.in),
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				if (node.onError === "continue") {
					await finish(host, scope, node, startedAt, "continued", {}, { error: message });
					return NEXT;
				}
				const failed = scope.get();
				await scope.set({
					...failed,
					status: "failed",
					trace: traced(host, failed, node, startedAt, "failed", { error: message }),
				});
				throw new WorkflowNodeError(failed.workflow, node.id, error);
			}
			const current = scope.get();
			await finish(
				host,
				scope,
				node,
				startedAt,
				"completed",
				node.out ? { state: withValue(current.state, node.out, output) } : {},
			);
			return NEXT;
		}
		case "suspend": {
			const current = scope.get();
			if (current.cursor === node.id && pending.answer !== undefined) {
				const answer = pending.answer;
				pending.answer = undefined;
				const output = await runOperation(
					host,
					scope,
					node,
					operationFor(host, node.onAnswer),
					bound(host, current, node.in),
					answer,
				);
				await finish(host, scope, node, startedAt, "completed", {
					cursor: undefined,
					status: "running",
					...(node.out ? { state: withValue(scope.get().state, node.out, output) } : {}),
				});
				return NEXT;
			}
			if (node.skipIf && (await evaluate(host, current, node.skipIf))) {
				await finish(host, scope, node, startedAt, "skipped");
				return NEXT;
			}
			/* The cursor is saved before the question exists: the ask records the pending
			 * action and persists the run, so whatever an answer finds already points
			 * here. A crash before the ask leaves no question; the retry asks again. */
			await scope.set({ ...scope.get(), status: "suspended", cursor: node.id });
			const asked = await runOperation(
				host,
				scope,
				node,
				operationFor(host, node.ask),
				bound(host, current, node.in),
			);
			const question = suspendQuestion(asked, host.job.pendingActionId);
			const waiting = scope.get();
			await scope.set({
				...waiting,
				trace: traced(host, waiting, node, startedAt, "suspended", {
					pendingActionId: question.actionId,
				}),
			});
			return { kind: "suspend", question };
		}
		case "call": {
			const current = scope.get();
			const nested =
				current.calls[node.id] ??
				startRecord(host.registry, node.workflow, bound(host, current, node.in));
			if (!current.calls[node.id])
				await scope.set({ ...current, calls: { ...current.calls, [node.id]: nested } });
			const child: Scope = {
				get: () => scope.get().calls[node.id]!,
				set: (next) =>
					scope.set({ ...scope.get(), calls: { ...scope.get().calls, [node.id]: next } }),
				path: `${scope.path}${node.id}/`,
			};
			const run = () => runRecord(host, child, pending);
			const result =
				node.contract && host.contract
					? await host.contract(node.contract, node.id, scope.get().calls[node.id]!.input, run)
					: await run();
			if (result.status === "suspended") {
				await scope.set({ ...scope.get(), status: "suspended", cursor: node.id });
				return { kind: "suspend", question: result.question };
			}
			if (result.status === "cancelled") return { kind: "cancelled" };
			const after = scope.get();
			await finish(host, scope, node, startedAt, "completed", {
				cursor: undefined,
				...(node.out
					? { state: withValue(after.state, node.out, toFlowValue(result.outcome)) }
					: {}),
			});
			return NEXT;
		}
		case "end": {
			const current = scope.get();
			const outcome = endOutcome(host, current, node);
			await finish(host, scope, node, startedAt, "completed");
			return { kind: "end", outcome };
		}
		case "forEach":
			throw new Error(`workflow "${record.workflow}" node "${node.id}": forEach is not supported`);
	}
}

function endOutcome(
	host: EngineHost,
	record: FlowRecord,
	node: Extract<WorkflowNode, { type: "end" }>,
): FlowOutcome {
	if (node.from) {
		const value = reader(host, record)(node.from);
		const ok = value && typeof value === "object" && "ok" in value ? Boolean(value.ok) : false;
		const note = value && typeof value === "object" && "note" in value ? textOf(value.note) : "";
		const unchanged =
			value && typeof value === "object" && "unchanged" in value && value.unchanged === true;
		const thumbs = readPath(value, "thumbs");
		return {
			ok,
			note,
			...(unchanged || node.unchanged ? { unchanged: true as const } : {}),
			...(Array.isArray(thumbs) && thumbs.every((thumb) => typeof thumb === "string")
				? { thumbs }
				: {}),
		};
	}
	const stated = node.outcome!;
	const note = stated.note.startsWith("$")
		? textOf(reader(host, record)(stated.note.slice(1)))
		: stated.note;
	return { ok: stated.ok, note, ...(node.unchanged ? { unchanged: true as const } : {}) };
}

function suspendQuestion(value: FlowValue, fallbackActionId: string | undefined): SuspendQuestion {
	const question = readPath(value, "question");
	const actionId = readPath(value, "actionId");
	const note = readPath(value, "note");
	const action = typeof actionId === "string" ? actionId : fallbackActionId;
	return {
		question: typeof question === "string" ? question : "",
		...(action ? { actionId: action } : {}),
		...(typeof note === "string" ? { note } : {}),
	};
}

/** Node ids of a definition, for structure snapshots and the catalog. */
export function definitionNodeIds(record: Pick<FlowRecord, "definition">): string[] {
	return workflowNodes(record.definition.root).map((node) => node.id);
}
