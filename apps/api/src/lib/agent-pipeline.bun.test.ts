import { describe, expect, it } from "bun:test";
import type { PipelineArtifact } from "@maleo/shared";
import {
	applyApprovalChoice,
	createStageRegistry,
	needsGate,
	runPipeline,
	StageRegistrationError,
	type Draft,
	type PipelineRun,
	type Stage,
	type StageId,
} from "../modules/agents/core/pipeline.ts";
import {
	assertRegistryCoversPipeline,
	PIPELINE_NAMES,
	pipelineProfile,
	pipelineStages,
} from "../modules/agents/core/pipeline-definitions.ts";

describe("agent pipeline gate policy", () => {
	it("gates asset-costing creates in manual mode", () => {
		expect(
			needsGate(
				{ costsAssets: true },
				{ operation: "create", targetsExisting: false },
				{ mode: "manual" },
			),
		).toBe(true);
	});

	it("auto mode skips additive create gates but still gates edits of existing work", () => {
		expect(
			needsGate(
				{ costsAssets: true },
				{ operation: "create", targetsExisting: false },
				{ mode: "auto" },
			),
		).toBe(false);
		expect(
			needsGate(
				{ costsAssets: false },
				{ operation: "update", targetsExisting: true },
				{ mode: "auto" },
			),
		).toBe(true);
		expect(
			needsGate(
				{ costsAssets: true },
				{ operation: "delete", targetsExisting: true },
				{ mode: "auto" },
			),
		).toBe(true);
	});
});

describe("agent pipeline runner", () => {
	function makeRun(mode: "manual" | "auto" = "manual"): PipelineRun {
		return {
			profile: pipelineProfile("storyPlan", { targetSec: 60 }),
			cursor: "plan",
			mode,
			status: "running",
		};
	}

	it("parks on the first gated stage and persists the reviewed draft", async () => {
		const calls: string[] = [];
		const draft: Draft = {
			operation: "create",
			targetsExisting: false,
			summary: "Generate visuals",
			payload: { kind: "gate" as const },
		};
		const stages: Stage<{ artifacts: PipelineArtifact[] }>[] = [
			{
				id: "plan",
				costsAssets: false,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Plan",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("plan.commit");
					return { status: "completed" as const };
				},
			},
			{
				id: "visuals",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => draft,
				commit: async () => {
					calls.push("visuals.commit");
					return { status: "completed" as const };
				},
			},
		];

		const result = await runPipeline({ artifacts: [] }, createStageRegistry(stages), {
			...makeRun(),
			profile: { ...pipelineProfile("storyPlan", { targetSec: 60 }), stages: ["plan", "visuals"] },
		});

		expect(result.status).toBe("awaiting_approval");
		expect(result.status === "awaiting_approval" && result.stage).toBe("visuals");
		expect(result.status === "awaiting_approval" && result.draft).toEqual(draft);
		expect(calls).toEqual(["plan.commit"]);
	});

	it("the research stage runs without suspending, then hands over to the gated stage", async () => {
		const calls: string[] = [];
		const stages: Stage<{ artifacts: PipelineArtifact[] }>[] = [
			{
				id: "research",
				costsAssets: false,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Retrieve sources",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("research.commit");
					return { status: "completed" as const };
				},
			},
			{
				id: "scaffold",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Generate assets",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("scaffold.commit");
					return { status: "completed" as const };
				},
			},
		];
		const run: PipelineRun = {
			profile: {
				...pipelineProfile("storyPlan", { targetSec: 60 }),
				stages: ["research", "scaffold"],
			},
			cursor: "research",
			mode: "manual",
			status: "running",
		};

		const result = await runPipeline({ artifacts: [] }, createStageRegistry(stages), run);

		// Research costs no assets, so it commits without an approval round-trip; the
		// first thing that costs money is still the thing that parks the run.
		expect(calls).toEqual(["research.commit"]);
		expect(result.status).toBe("awaiting_approval");
		expect(result.status === "awaiting_approval" && result.stage).toBe("scaffold");
	});

	it("approve_all flips mode to auto so downstream additive stages commit", async () => {
		const calls: string[] = [];
		const stages: Stage<{ artifacts: PipelineArtifact[] }>[] = [
			{
				id: "visuals",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Visuals",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("visuals.commit");
					return { status: "completed" as const };
				},
			},
			{
				id: "motion",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Motion",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("motion.commit");
					return { status: "completed" as const };
				},
			},
		];
		const parked: PipelineRun = {
			profile: {
				...pipelineProfile("storyPlan", { targetSec: 60 }),
				stages: ["visuals", "motion"],
			},
			cursor: "visuals",
			mode: "manual",
			status: "awaiting_approval",
			currentDraft: {
				operation: "create",
				targetsExisting: false,
				summary: "Visuals",
				payload: { kind: "gate" as const },
			},
		};
		const approved = applyApprovalChoice(parked, "approve_all");

		const result = await runPipeline({ artifacts: [] }, createStageRegistry(stages), approved);

		expect(result.status).toBe("done");
		expect(calls).toEqual(["visuals.commit", "motion.commit"]);
	});

	it("approve commits the parked draft, then gates the next manual asset stage", async () => {
		const calls: string[] = [];
		const stages: Stage<{ artifacts: PipelineArtifact[] }>[] = [
			{
				id: "visuals",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Visuals should not be reproduced",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("visuals.commit");
					return { status: "completed" as const };
				},
			},
			{
				id: "motion",
				costsAssets: true,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => ({
					operation: "create",
					targetsExisting: false,
					summary: "Motion",
					payload: { kind: "gate" as const },
				}),
				commit: async () => {
					calls.push("motion.commit");
					return { status: "completed" as const };
				},
			},
		];
		const parked: PipelineRun = {
			profile: {
				...pipelineProfile("storyPlan", { targetSec: 60 }),
				stages: ["visuals", "motion"],
			},
			cursor: "visuals",
			mode: "manual",
			status: "awaiting_approval",
			currentDraft: {
				operation: "create",
				targetsExisting: false,
				summary: "Reviewed visuals",
				payload: { kind: "gate" as const },
			},
		};
		const approved = applyApprovalChoice(parked, "approve");

		const result = await runPipeline({ artifacts: [] }, createStageRegistry(stages), approved);

		expect(result.status).toBe("awaiting_approval");
		expect(result.status === "awaiting_approval" && result.stage).toBe("motion");
		expect(calls).toEqual(["visuals.commit"]);
	});

	/* The unimplemented stage is now caught resolving the order, before the first
	 * stage produces anything — so a profile wired to a stage nothing implements
	 * cannot commit earlier stages or spend credits on its way to the mistake. */
	it("rejects a profiled stage that has no implementation, before running any stage", async () => {
		const calls: string[] = [];
		const registry = createStageRegistry<{ artifacts: PipelineArtifact[] }>([
			{
				id: "plan",
				costsAssets: false,
				consumes: [],
				requires: [],
				produces: [],
				produce: async () => {
					calls.push("plan.produce");
					return {
						operation: "create",
						targetsExisting: false,
						summary: "Plan",
						payload: { kind: "gate" as const },
					};
				},
				commit: async () => {
					calls.push("plan.commit");
					return { status: "completed" as const };
				},
			},
		]);
		const run: PipelineRun = {
			...makeRun(),
			profile: { ...pipelineProfile("storyPlan", { targetSec: 60 }), stages: ["plan", "motion"] },
		};

		await expect(runPipeline({ artifacts: [] }, registry, run)).rejects.toThrow(
			"pipeline stage motion not registered",
		);
		expect(calls).toEqual([]);
	});
});

describe("stage registry", () => {
	function stage(id: StageId): Stage<{ artifacts: PipelineArtifact[] }> {
		return {
			id,
			costsAssets: false,
			consumes: [],
			requires: [],
			produces: [],
			produce: async () => ({
				operation: "create",
				targetsExisting: false,
				summary: id,
				payload: { kind: "gate" as const },
			}),
			commit: async () => ({ status: "completed" as const }),
		};
	}

	it("registers one implementation per id", () => {
		const registry = createStageRegistry([stage("plan"), stage("scaffold")]);
		expect(registry.ids).toEqual(["plan", "scaffold"]);
		expect(registry.get("plan")?.id).toBe("plan");
		expect(registry.get("motion")).toBeUndefined();
	});

	it("refuses a duplicate registration, naming the id", () => {
		expect(() => createStageRegistry([stage("plan"), stage("plan")])).toThrow(
			"pipeline stage plan registered more than once",
		);
	});

	it("resolves a stage order to registered implementations", () => {
		const registry = createStageRegistry([stage("plan"), stage("scaffold"), stage("finalize")]);
		expect(registry.resolve(["plan", "finalize"]).map((s) => s.id)).toEqual(["plan", "finalize"]);
	});

	/* The point of the registry: a profile naming a stage nothing implements fails
	 * when the pipeline is assembled, not part-way through a run that has already
	 * committed earlier stages and possibly spent credits. */
	it("fails on an unregistered id before any stage runs", () => {
		const registry = createStageRegistry([stage("plan")]);
		expect(() => registry.resolve(["plan", "motion"])).toThrow(StageRegistrationError);
		expect(() => registry.resolve(["plan", "motion"])).toThrow(
			"pipeline stage motion not registered",
		);
	});

	it("reports the first unregistered id when several are missing", () => {
		const registry = createStageRegistry([stage("plan")]);
		expect(() => registry.resolve(["motion", "audio"])).toThrow(
			"pipeline stage motion not registered",
		);
	});
});

describe("declared pipeline profiles", () => {
	it("declares video profiles only", () => {
		expect([...PIPELINE_NAMES]).toEqual(["storyPlan", "storyGenerate", "edit"]);
		expect(pipelineProfile("storyPlan", { narrated: true })).toMatchObject({
			contentType: "video",
			granularity: "section",
			narrationFirst: true,
			stages: ["plan", "scaffold"],
		});
	});

	it("plans a non-narrated video in beats and a narrated one in sections", () => {
		expect(pipelineProfile("storyPlan", { narrated: false }).granularity).toBe("beat");
		expect(pipelineProfile("storyPlan", { narrated: true }).granularity).toBe("section");
	});

	it("takes an edit run's granularity from the project's content type", () => {
		expect(pipelineProfile("edit", { contentType: "image" }).granularity).toBe("slide");
		expect(pipelineProfile("edit", { contentType: "text" }).granularity).toBe("post");
		expect(pipelineProfile("edit", { contentType: "text" }).narrationFirst).toBe(false);
	});

	/* The phantom-stage guard. `motion` and `audio` were listed by the old
	 * `videoProfile` default and implemented by nothing; the default was never read,
	 * so nothing ever failed. A declared profile naming an unimplemented stage is now
	 * a test failure rather than a latent one. */
	it("declares no stage outside the implemented set", () => {
		const implemented = new Set<StageId>(["plan", "scaffold", "visuals", "apply", "finalize"]);
		for (const name of PIPELINE_NAMES) {
			for (const id of pipelineStages(name)) {
				expect({ profile: name, stage: id, implemented: implemented.has(id) }).toEqual({
					profile: name,
					stage: id,
					implemented: true,
				});
			}
		}
	});
});

describe("profile coverage", () => {
	function stage(id: StageId): Stage<{ artifacts: PipelineArtifact[] }> {
		return {
			id,
			costsAssets: false,
			consumes: [],
			requires: [],
			produces: [],
			produce: async () => ({
				operation: "create",
				targetsExisting: false,
				summary: id,
				payload: { kind: "gate" as const },
			}),
			commit: async () => ({ status: "completed" as const }),
		};
	}

	it("accepts a registry implementing every declared stage", () => {
		const registry = createStageRegistry(pipelineStages("storyPlan").map(stage));
		expect(() => assertRegistryCoversPipeline(registry, "storyPlan")).not.toThrow();
	});

	/* A fresh run must not park at its gate and only discover a missing later stage
	 * once the operator has approved and paid for the work in front of it. */
	it("names the unimplemented stages a profile declares", () => {
		const registry = createStageRegistry([stage("plan"), stage("scaffold")]);
		expect(() => assertRegistryCoversPipeline(registry, "edit")).toThrow(
			"declares stage(s) apply, finalize that nothing implements",
		);
	});
});
