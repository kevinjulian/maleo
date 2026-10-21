/* Run a workflow inside one agent tool call, with its flow record on the run.
 *
 * The record lives at `job.run.flows[<toolCallId>]`; the tool-call id is stable
 * across durable retries, so a retried or resumed call finds the record it left.
 * Each save writes the record and the run together (`persist`). */
import { persist } from "../persistence.ts";
import { loadRun } from "../run-repository.ts";
import type { AgentJob } from "../model.ts";
import { executionId, runState } from "../runtime/run-state.ts";
import { runFlow, startRecord, type EngineHost, type EngineResult } from "./engine.ts";
import type { FlowRecord } from "./flow-record.ts";
import type { EngineRegistry } from "./registry.ts";

export interface ToolFlowRequest {
	registry: EngineRegistry;
	job: AgentJob;
	toolCallId: string;
	workflow: string;
	input: unknown;
	answer?: string;
	contract?: EngineHost["contract"];
}

export function flowRecordFor(job: AgentJob, toolCallId: string): FlowRecord | undefined {
	return job.run?.flows?.[toolCallId];
}

async function saveFlow(job: AgentJob, toolCallId: string, record: FlowRecord): Promise<void> {
	const state = runState(job);
	state.flows = { ...state.flows, [toolCallId]: record };
	await persist(job);
}

/** A run the user stopped, or the system ended, executes no further node. */
async function stopped(job: AgentJob): Promise<boolean> {
	if (job.status !== "running") return true;
	const stored = await loadRun(job.id);
	return Boolean(stored && stored.status !== "running");
}

export async function runToolFlow(request: ToolFlowRequest): Promise<EngineResult> {
	const { registry, job, toolCallId } = request;
	const record =
		flowRecordFor(job, toolCallId) ?? startRecord(registry, request.workflow, request.input);
	if (!flowRecordFor(job, toolCallId)) await saveFlow(job, toolCallId, record);
	return await runFlow(
		{
			registry,
			job,
			toolCallId,
			executionId: executionId(job),
			answer: request.answer,
			contract: request.contract,
			save: (next) => saveFlow(job, toolCallId, next),
			cancelled: () => stopped(job),
		},
		record,
	);
}
