/* The durable record of one workflow run inside an agent tool call.
 *
 * Saved on the run (`job.run.flows[<toolCallId>]`) after every node, in the same
 * write as the node's effects on the run record, so the cursor and the work it
 * describes can never disagree. A called workflow nests under its call node. The
 * record carries the definition it started on: resume executes that snapshot. */
import type { WorkflowDefinition } from "@maleo/shared";
import type { FlowState, FlowValue } from "./types.ts";

export type FlowStatus = "running" | "suspended" | "completed" | "failed" | "cancelled";
export type BranchTaken = "then" | "else" | "none";
export type TraceOutcome = "completed" | "skipped" | "suspended" | "failed" | "continued";

export interface FlowOutcome {
	ok: boolean;
	note: string;
	/** Ended through an `end` that declares it produced nothing. */
	unchanged?: true;
	/** Media the run produced, for the chat card. */
	thumbs?: string[];
}

export interface FlowTraceEntry {
	runId: string;
	workflow: string;
	node: string;
	revision: string;
	startedAt: number;
	endedAt: number;
	outcome: TraceOutcome;
	branch?: BranchTaken;
	prompts: string[];
	tools: string[];
	pendingActionId?: string;
	/** Why a node failed or continued after failing; never credentials. */
	error?: string;
}

export interface FlowRecord {
	workflow: string;
	revision: string;
	definition: WorkflowDefinition;
	input: FlowValue;
	status: FlowStatus;
	/** The suspend or call node the run is waiting at. */
	cursor?: string;
	state: FlowState;
	/** Nodes that finished; a resumed run never runs them again. */
	done: string[];
	/** The branch each entered branch node took, so a resume follows the same path. */
	branches: Record<string, BranchTaken>;
	/** Called workflows, by call node id. */
	calls: Record<string, FlowRecord>;
	trace: FlowTraceEntry[];
	outcome?: FlowOutcome;
}

/** JSON-round-trip a value into flow state: what is saved is exactly what a resume reads. */
export function toFlowValue(value: unknown): FlowValue {
	if (value === undefined) return null;
	const json = JSON.stringify(value);
	return json === undefined ? null : JSON.parse(json);
}
