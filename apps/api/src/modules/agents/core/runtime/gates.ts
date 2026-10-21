/* One approval gate, wherever the runtime asks: a tool's precondition or a
 * workflow step before work that costs assets. The same question card, the same
 * answers — Approve, Approve all, Reject — and "Approve all" carries through the
 * rest of the run, as the pipeline's `auto` mode did. */
import { parsePipelineApprovalChoice, suspendForToolApproval } from "../approval.ts";
import type { AgentJob } from "../model.ts";
import { runState } from "./run-state.ts";

export type GateDecision = "suspend" | "approve" | "approve_all" | "reject";

/** Decide a gate from the user's answer, or record the question and ask for one. */
export async function decideGate(
	job: AgentJob,
	summary: string,
	label: string,
	answer: string | undefined,
): Promise<GateDecision> {
	const state = runState(job);
	if (state.approveAll) return "approve_all";
	if (answer === undefined) {
		await suspendForToolApproval(job, summary, label);
		return "suspend";
	}
	const choice = parsePipelineApprovalChoice(answer);
	if (choice === "approve_all") state.approveAll = true;
	return choice === "approve" || choice === "approve_all" ? choice : "reject";
}
