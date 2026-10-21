/* Mandatory stage declarations and topology validation
 * (standardize-pipeline-artifact-contracts 4.1, 4.2). Every failure here happens
 * at registration or when the definitions load — before any stage runs. */
import { describe, expect, test } from "bun:test";
import { pipelineArtifactKinds } from "@maleo/shared";
import { createStageRegistry, StageRegistrationError, type Stage } from "./pipeline.ts";
import { PIPELINE_NAMES, pipelineContracts } from "./pipeline-definitions.ts";
import {
	PLAN_CONTRACT,
	STORY_SCAFFOLD_CONTRACT,
	StageTopologyError,
	validateTopology,
	type StageContract,
} from "./stage-contracts.ts";

const versionOf = (kind: string) => pipelineArtifactKinds.get(kind)?.schemaVersion;

function stage(id: Stage["id"], contract?: StageContract): Stage {
	return {
		id,
		costsAssets: false,
		consumes: [],
		...contract,
		produce: async () => ({
			operation: "create",
			targetsExisting: false,
			summary: id,
			payload: { kind: "gate" as const },
		}),
		commit: async () => ({ status: "completed" as const }),
	} as Stage;
}

describe("declarations are mandatory (4.1)", () => {
	test("registering a stage without requires and produces fails", () => {
		expect(() => createStageRegistry([stage("plan")])).toThrow(StageRegistrationError);
	});

	test("a declared stage registers", () => {
		expect(createStageRegistry([stage("plan", PLAN_CONTRACT)]).ids).toEqual(["plan"]);
	});
});

describe("topology is validated before anything runs (4.2)", () => {
	test("every declared pipeline is valid", () => {
		for (const name of PIPELINE_NAMES) expect(() => pipelineContracts(name)).not.toThrow();
	});

	test("an unsatisfied requirement fails, naming the stage and the kind", () => {
		expect(() =>
			validateTopology(
				"generate-from-nothing",
				[{ id: "scaffold", contract: STORY_SCAFFOLD_CONTRACT }],
				[],
				versionOf,
			),
		).toThrow("stage scaffold requires story_plan");
	});

	test("an initial input satisfies a requirement", () => {
		expect(() =>
			validateTopology(
				"generate",
				[{ id: "scaffold", contract: STORY_SCAFFOLD_CONTRACT }],
				["story_plan"],
				versionOf,
			),
		).not.toThrow();
	});

	test("a producer ordered after its consumer fails", () => {
		expect(() =>
			validateTopology(
				"backwards",
				[
					{ id: "scaffold", contract: STORY_SCAFFOLD_CONTRACT },
					{ id: "plan", contract: PLAN_CONTRACT },
				],
				[],
				versionOf,
			),
		).toThrow(StageTopologyError);
	});

	test("a requirement on a schema version the kind is no longer at fails", () => {
		const stale: StageContract = {
			requires: [{ kind: "story_plan", schemaVersion: 2 }],
			produces: [],
		};
		expect(() =>
			validateTopology(
				"stale",
				[
					{ id: "plan", contract: PLAN_CONTRACT },
					{ id: "scaffold", contract: stale },
				],
				[],
				versionOf,
			),
		).toThrow("requires story_plan@2, but the kind is at 1");
	});
});
