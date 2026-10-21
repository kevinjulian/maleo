/* The existing-edit gate, enforced where the effect happens (design decision 7):
 * a tool that edits or removes existing work — a scene, section, slide or post
 * that exists — waits for the user's approval. A wrong tool choice gets an
 * approval question the agent can recover from, never a silent change.
 *
 * The other invariants the prelude routed around live in their workflows:
 * generating needs an approved plan (workflows/story-assets.ts), and replacing
 * an approved plan is asked first (the plan_story definition, engine/planning/). */
import { recordApproval } from "../../../../../lib/agent-trace.ts";
import type { ApprovalChoice } from "../../pipeline.ts";
import { editGateLabel, existingEditDraft } from "../../tool-executor.ts";
import type { AgentJob } from "../../model.ts";
import type { ToolArgs } from "../../types.ts";

export const NO_PLAN_NOTE = "No story plan yet — run plan_story first.";

export type Precondition =
	| { kind: "refuse"; note: string }
	| {
			kind: "approve";
			summary: string;
			label: string;
			/** Applied once the user approves. Returns why the approval could not be applied, or null. */
			onApprove(job: AgentJob, choice: ApprovalChoice): Promise<string | null>;
	  };

export function preconditionFor(job: AgentJob, tool: string, args: ToolArgs): Precondition | null {
	const draft = existingEditDraft(job, tool, args);
	if (!draft) return null;
	const label = editGateLabel(job, tool);
	return {
		kind: "approve",
		summary: draft.summary,
		label,
		onApprove: async (current, choice) => {
			await recordApproval(current, label, { tool, mode: choice });
			return null;
		},
	};
}
