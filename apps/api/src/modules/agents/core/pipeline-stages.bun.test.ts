import { describe, expect, test } from "bun:test";
import {
	applyApprovalChoice,
	createStageRegistry,
	runPipeline,
	type PipelineRun,
	type Stage,
	type StageId,
} from "./pipeline.ts";
import { pipelineProfile } from "./pipeline-definitions.ts";
import type { AgentJob } from "./model.ts";
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import { ENGINE_CONTRACTS } from "./engine/contracts.ts";
import {
	applyEditStage,
	storyScaffoldStage,
	traceDeclaredContext,
	type WorkflowHandle,
} from "./pipeline-stages.ts";

const noWorkflow: WorkflowHandle = { set: () => {} };

/* The property these stages exist to have: the object that gates a run is the same
 * object that commits it. Before this, the gate lived in `loop.ts` with an empty
 * commit and the real commit lived in `approval.ts` under a dynamic id, so nothing
 * could state that the thing approved was the thing that ran. */
describe("story scaffold stage", () => {
	test("declares a fixed id rather than deriving one from run state", () => {
		expect(storyScaffoldStage({ summary: "s", workflow: noWorkflow }).id).toBe("scaffold");
	});

	test("gates on assets, so a manual run parks before generating", () => {
		expect(storyScaffoldStage({ summary: "s", workflow: noWorkflow }).costsAssets).toBe(true);
	});

	test("produces the gate copy the operator approves", async () => {
		const stage = storyScaffoldStage({
			summary: "Approve to generate sections",
			workflow: noWorkflow,
		});
		const draft = await stage.produce({} as never);
		expect(draft.summary).toBe("Approve to generate sections");
		// A plain gate: what it approves is the plan, not a hint in the draft.
		expect(draft.payload).toEqual({ kind: "gate" });
	});

	test("declares the approved plan and the template it freezes", () => {
		const { consumes } = storyScaffoldStage({ summary: "s", workflow: noWorkflow });
		expect(consumes).toContain("approvedPlan");
		expect(consumes).toContain("timelineTemplate");
		expect(consumes).toContain("materials.rules");
	});
});

/* `consumes` is documentation that can rot. These cases pin each declaration to the
 * code that justifies it, so a stage that starts reading a new channel — or stops —
 * fails here rather than quietly describing itself wrongly.
 *
 * Every entry was re-derived from the implementation during task 4.1, and four of
 * the original declarations were wrong. */
describe("declared context matches what each stage reads", () => {
	test("story planning locks the visual style, so the plan contract declares styleLock", () => {
		// The planning core generates and saves a style bible when no reference image
		// was chosen — inside the plan stage, not at generation.
		expect(ENGINE_CONTRACTS.plan!.consumes).toEqual([
			"brief",
			"materials.story",
			"materials.voice",
			"materials.rules",
			"styleLock",
		]);
	});

	test("story generation declares the approved revision and the frozen template", () => {
		expect(storyScaffoldStage({ summary: "s", workflow: noWorkflow }).consumes).toEqual([
			"approvedPlan",
			"materials.visual",
			"materials.voice",
			"materials.references",
			"materials.rules",
			"styleLock",
			"timelineTemplate",
		]);
	});

	test("applying an approved edit reads existing work, not materials", () => {
		// The edit tools rewrite fields from their arguments; none reads a channel.
		const { consumes } = applyEditStage({
			tool: "update_section",
			args: {},
			label: "l",
			draft: {
				operation: "update",
				targetsExisting: true,
				summary: "s",
				payload: { kind: "gate" as const },
			},
			workflow: noWorkflow,
		});
		expect(consumes).toEqual(["generatedAssets"]);
	});

	test("no stage declares the style bible as a channel of its own", () => {
		for (const consumes of [
			ENGINE_CONTRACTS.plan!.consumes,
			storyScaffoldStage({ summary: "s", workflow: noWorkflow }).consumes,
		]) {
			expect(consumes).not.toContain("materials.styleBible" as never);
		}
	});
});

/** A stage that declares no context, standing in for the end of a pipeline. */
function readsNothing(): Stage<AgentJob> {
	return {
		id: "finalize",
		requires: [],
		produces: [],
		costsAssets: false,
		consumes: [],
		produce: async () => ({
			operation: "create",
			targetsExisting: false,
			summary: "f",
			payload: { kind: "gate" as const },
		}),
		commit: async () => ({ status: "completed", note: "" }),
	};
}

describe("declared context is reported per run", () => {
	function bareJob(): AgentJob {
		return {
			id: "j",
			projectId: "p",
			contentType: "video",
			status: "running",
			events: [],
			scenes: [],
			textOverlays: [],
			videoOverlays: [],
			audioOverlays: [],
			characters: [],
			artifacts: [],
			aspect: "9:16",
			brief: "b",
			startedAt: Date.now(),
			run: {
				instruction: "",
				transcript: "",
				step: 0,
				builtSomething: false,
				finishRejected: false,
				asks: 0,
			},
		} as unknown as AgentJob;
	}

	test("a stage that reads nothing says so, rather than saying nothing", async () => {
		const job = bareJob();
		const registry = createStageRegistry([readsNothing()]);
		const profile = { ...pipelineProfile("storyPlan"), stages: ["finalize"] as StageId[] };
		await runPipeline(
			job,
			registry,
			{ profile, cursor: "finalize", mode: "auto", status: "running" },
			traceDeclaredContext(job),
		);

		expect(job.run!.transcript).toContain("Pipeline stage finalize reads: nothing");
	});

	test("a stage with declared context lists its channels", () => {
		const job = bareJob();
		const observe = traceDeclaredContext(job);
		observe({ stage: "plan", consumes: ENGINE_CONTRACTS.plan!.consumes });

		expect(job.run!.transcript).toContain(
			"Pipeline stage plan reads: brief, materials.story, materials.voice, materials.rules, styleLock",
		);
	});
});

/* An approval choice reaches the stage that commits it through the run's mode.
 * `applyApprovalChoice` returns a new run rather than mutating the parked one, so
 * the call site must publish it onto the job before the pipeline runs — otherwise
 * a stage reads `manual` while the operator has said approve all, and story
 * approval records `review_additions` instead of `auto_approve_additions`,
 * silently dropping auto-extension authority. */
describe("approve_all reaches the committing stage", () => {
	const parked: PipelineRun = {
		profile: pipelineProfile("storyGenerate", { narrated: true }),
		cursor: "scaffold",
		mode: "manual",
		status: "awaiting_approval",
		currentDraft: {
			operation: "create",
			targetsExisting: false,
			summary: "s",
			payload: { kind: "gate" as const },
		},
	};

	test("applying approve_all produces a run whose mode a stage can read", () => {
		expect(applyApprovalChoice(parked, "approve_all").mode).toBe("auto");
		expect(applyApprovalChoice(parked, "approve").mode).toBe("manual");
	});

	/* The regression this guards: the applied choice lives on the returned run, not
	 * on the parked one the job still points at. A call site that runs the pipeline
	 * without publishing it leaves every stage reading the pre-approval mode. */
	test("the parked run still reports the pre-approval mode", () => {
		const approved = applyApprovalChoice(parked, "approve_all");
		expect(approved.mode).toBe("auto");
		expect(parked.mode).toBe("manual");
		expect(approved).not.toBe(parked);
	});
});

/* 5.1d: an edit applies to what the runner resolved for it — the plan it was
 * approved against — and to nothing that is gone. */
describe("the edit stage reads its target through its inputs", () => {
	function planJob(withPlan: boolean): AgentJob {
		return {
			id: "edit-run",
			projectId: "p",
			contentType: "video",
			status: "running",
			events: [],
			scenes: [],
			textOverlays: [],
			videoOverlays: [],
			audioOverlays: [],
			characters: [],
			artifacts: withPlan
				? fixtureArtifacts("p", [
						{
							kind: "story_plan",
							payload: {
								targetSec: 60,
								sections: [
									{
										id: "s1",
										title: "old",
										narration: "n",
										visualPrompt: "v",
										estimatedDurationSec: 60,
									},
								],
							},
						},
					])
				: [],
			aspect: "9:16",
			brief: "b",
			startedAt: Date.now(),
			run: {
				instruction: "",
				transcript: "",
				step: 0,
				builtSomething: false,
				finishRejected: false,
				asks: 0,
			},
		};
	}
	// Resumed after approval: the reviewed draft is on the run, so the gate is passed.
	const editRun = (): PipelineRun => ({
		profile: { ...pipelineProfile("edit"), stages: ["apply"] as StageId[] },
		cursor: "apply",
		mode: "manual",
		status: "running",
		currentDraft: {
			operation: "update",
			targetsExisting: true,
			summary: "Update section 1",
			payload: { kind: "gate" as const },
		},
	});
	const updateSection = () =>
		applyEditStage({
			tool: "update_section",
			args: { sectionId: "s1", title: "new" },
			label: "section",
			draft: {
				operation: "update",
				targetsExisting: true,
				summary: "Update section 1",
				payload: { kind: "gate" as const },
			},
			workflow: noWorkflow,
		});

	test("an approved section edit runs its tool against the plan the runner resolved", async () => {
		const job = planJob(true);
		const result = await runPipeline(job, createStageRegistry([updateSection()]), editRun());
		expect(result.status).toBe("done");
		expect(job.events.some((event) => event.kind === "tool_call_started")).toBe(true);
	});

	test("an edit whose target is gone fails before the tool runs", async () => {
		const job = planJob(false);
		const result = await runPipeline(job, createStageRegistry([updateSection()]), editRun());
		expect(result).toMatchObject({
			status: "failed",
			stage: "apply",
			error: { code: "missing_input" },
		});
		expect(job.events.some((event) => event.kind === "tool_call_started")).toBe(false);
	});
});
