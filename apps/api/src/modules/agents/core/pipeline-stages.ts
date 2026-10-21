/* Stage bodies, defined once.
 *
 * Each stage here used to exist twice: a gate half in `loop.ts` that produced a
 * draft and parked the run, and a commit half in `approval.ts` that ran after the
 * operator approved. The two halves could not be joined while `commit` returned
 * `void`, because the commit half's note was read by its caller after the pipeline
 * returned, so the split was load-bearing rather than accidental.
 *
 * Joined, each stage is one object: `produce` gates, `commit` does the work. The
 * runner already sequences them — a parked run carries its approved draft, so
 * `produce` is skipped on resume and only `commit` runs. That is why the commit
 * half's own `produce` was dead code.
 */
import { stageFailure } from "./stage-failure.ts";
import { storyInputsFrom } from "./story-inputs.ts";
import { APPLY_CONTRACT, EDIT_TARGET_KIND, STORY_SCAFFOLD_CONTRACT } from "./stage-contracts.ts";
import type { AgentJob } from "./model.ts";
import type { Draft, Stage, StageCommitResult, StageObserver } from "./pipeline.ts";
import { emitToolCall } from "./trace.ts";
import { runValidatedTool } from "./tool-executor.ts";
import { getStoryPlan } from "./plan-state.ts";
import { approveCurrentStoryPlan } from "./services/storyboard-command-service.ts";
import { refreshStoryDirectionForApproval } from "./services/planning.ts";
import { refreshTimelineTemplateForGeneration } from "./services/story-assets.ts";
import { recordApproval } from "../../../lib/agent-trace.ts";

/* The run's workflow plan, which the call site owns and several stages update.
 *
 * Passed as a handle rather than threaded through return values because the plan is
 * a display concern shared by every stage in the run: the call site builds it, the
 * stages mark their own rows, and the order they do so in is the run's order. */
export interface WorkflowHandle {
	set(
		id: string,
		status: "running" | "done" | "failed" | "skipped",
		opts?: { reason?: string },
	): void;
}

/* Report each stage's declared context into the run transcript, beside the tool
 * lines already written there. A declaration that does not match what the stage
 * did is then visible in the same place the run is read. */
export function traceDeclaredContext(job: AgentJob): StageObserver {
	return ({ stage, consumes }) => {
		if (!job.run) return;
		const declared = consumes.length ? consumes.join(", ") : "nothing";
		job.run.transcript += `\nPipeline stage ${stage} reads: ${declared}`;
	};
}

/** For a run with no progress plan of its own. */
export const NO_WORKFLOW: WorkflowHandle = { set: () => {} };

export interface StoryScaffoldContext {
	/** Gate copy shown to the operator before anything costs assets. */
	summary: string;
	workflow: WorkflowHandle;
}

/* Narrated video: approve the exact plan revision, then generate its assets.
 *
 * `approve_all` is read from the run's mode rather than passed in. Applying that
 * choice is what sets the mode to `auto` (`applyApprovalChoice`), so the run
 * already records the decision by the time this commits, and taking it from there
 * keeps the stage constructible at the gate site, where no choice has been made. */
export function storyScaffoldStage(ctx: StoryScaffoldContext): Stage<AgentJob> {
	return {
		id: "scaffold",
		...STORY_SCAFFOLD_CONTRACT,
		costsAssets: true,
		consumes: [
			"approvedPlan",
			"materials.visual",
			"materials.voice",
			"materials.references",
			"materials.rules",
			"styleLock",
			"timelineTemplate",
		],
		// Generation begins against the template selected now, and holds it.
		begin: refreshTimelineTemplateForGeneration,
		produce: async () => ({
			operation: "create",
			targetsExisting: false,
			summary: ctx.summary,
			payload: { kind: "gate" },
		}),
		commit: async (job, _draft, inputs): Promise<StageCommitResult> => {
			// "Approve all" arrives as the pipeline's auto mode, or the agent runtime's run-wide approval.
			const autoApprove = job.run?.pipeline?.mode === "auto" || job.run?.approveAll === true;
			// The plan (and a grounded plan's research) as the runner resolved them.
			await refreshStoryDirectionForApproval(job, storyInputsFrom(inputs));
			const plan = getStoryPlan(job);
			const approved = await approveCurrentStoryPlan(
				job,
				"explicit",
				autoApprove ? "auto_approve_additions" : "review_additions",
			);
			if (!approved.ok) {
				// The refusal carries its own cause now; the plan is no longer rewritten
				// to say why, so this is the only place that still knows.
				const note = approved.message;
				ctx.workflow.set("generate", "failed", { reason: note });
				return { status: "failed", error: stageFailure("approval_refused", note) };
			}
			await recordApproval(job, "story_plan", {
				sections: plan?.sections.length ?? 0,
				target_sec: plan?.targetSec ?? null,
				mode: autoApprove ? "approve_all" : "approve",
			});
			const { note, ok } = await emitToolCall(job, "generate_story_assets", {}, (tcid) =>
				runValidatedTool(job, "generate_story_assets", {}, tcid),
			);
			ctx.workflow.set("generate", ok ? "done" : "failed", { reason: note });
			return ok
				? { status: "completed", note }
				: { status: "failed", error: stageFailure("generation_failed", note) };
		},
	};
}

export interface ApplyEditContext {
	tool: string;
	args: Record<string, unknown>;
	/** The gate label the approval was recorded under. */
	label: string;
	/** The draft the operator already reviewed; replayed rather than redrafted. */
	draft: Draft;
	workflow: WorkflowHandle;
}

/* Apply an approved edit to existing work.
 *
 * This is the edit flow's own stage. It used to have none: the edit profile was
 * written as `["scaffold", "finalize"]` purely so the runner would gate it, and the
 * stage registered itself under whatever cursor the parked run carried. Editing a
 * section is not scaffolding, and a stage that cannot name itself until the run has
 * parked cannot be reasoned about before it runs. */
export function applyEditStage(ctx: ApplyEditContext): Stage<AgentJob> {
	return {
		id: "apply",
		...APPLY_CONTRACT,
		costsAssets: false,
		/* The edit tools — `update_section`, `update_scene`, `update_slide` and their
		 * remove counterparts — rewrite fields of existing work from their arguments
		 * (`services/planning.ts:543`, `tool-executor.ts:148`). None reads a material
		 * channel, the style lock, or the timeline template. */
		consumes: ["generatedAssets"],
		produce: async () => ctx.draft,
		commit: async (job, _draft, inputs): Promise<StageCommitResult> => {
			/* What this edit changes comes from the runner. Approved work that is gone
			 * by the time the edit is applied is reported, not edited blindly. */
			const target = EDIT_TARGET_KIND[ctx.tool];
			if (target && !inputs.get(target)) {
				const note = `Nothing to edit: the ${target.replace(/_/g, " ")} this edit was approved against is no longer in the project.`;
				ctx.workflow.set("apply", "failed", { reason: note });
				return { status: "failed", error: stageFailure("missing_input", note) };
			}
			const autoApprove = job.run?.pipeline?.mode === "auto";
			await recordApproval(job, ctx.label, {
				tool: ctx.tool,
				mode: autoApprove ? "approve_all" : "approve",
			});
			const { note, ok } = await emitToolCall(job, ctx.tool, ctx.args, (tcid) =>
				runValidatedTool(job, ctx.tool, ctx.args, tcid),
			);
			ctx.workflow.set("apply", ok ? "done" : "failed", { reason: note });
			return ok
				? { status: "completed", note }
				: { status: "failed", error: stageFailure("edit_failed", note) };
		},
	};
}
