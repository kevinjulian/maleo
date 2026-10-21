import { describe, expect, test } from "bun:test";
import { fixtureArtifacts } from "./artifact-fixtures.ts";
import type { StoryPlanPayload, StorySection, StoryVisualSegment } from "./model.ts";
import type { OutcomeEvaluation } from "./model.ts";
import { buildProjectQualityReport } from "./quality-report.ts";

function evaluation(
	status: OutcomeEvaluation["status"],
	over: Partial<OutcomeEvaluation["metrics"]> = {},
): OutcomeEvaluation {
	return {
		schemaVersion: 1,
		contractSchemaVersion: 1,
		status,
		score: status === "passed" ? 100 : 60,
		evaluatedAt: 1,
		findings:
			status === "failed"
				? [
						{
							id: "evidence-unsupported",
							requirementId: "evidence",
							severity: "blocker",
							message: "unsupported",
						},
					]
				: [],
		metrics: {
			blockerCount: status === "failed" ? 1 : 0,
			warningCount: 0,
			findingCount: status === "failed" ? 1 : 0,
			...over,
		},
	};
}

function section(index: number, fields: Partial<StorySection> = {}): StorySection {
	return {
		id: `s${index}`,
		title: `S${index}`,
		narration: "n",
		visualPrompt: "v",
		estimatedDurationSec: 20,
		...fields,
	};
}

function beat(visualPrompt: string): StoryVisualSegment {
	return { text: "t", visualPrompt, durationSec: 1, voiceSegmentIndex: 0 };
}

function storyboardWithPlan(plan: Omit<StoryPlanPayload, "targetSec">) {
	return {
		artifacts: fixtureArtifacts("p", [
			{ kind: "story_plan", payload: { targetSec: 120, ...plan } },
		]),
	};
}

describe("project quality report", () => {
	test("measures golden outcome, repair, render, time, and cost signals", () => {
		const runs = [
			{
				id: "r1",
				project_id: "p",
				workspace_id: null,
				content_type: "video",
				status: "needs_attention",
				cursor: 1,
				instruction: "build",
				snapshot: {
					outcomeEvaluation: evaluation("failed", {
						briefKeywordCoverage: 20,
						visualContinuityPct: 70,
						durationErrorPct: 25,
					}),
				},
				created_at: 1000,
				updated_at: 1200,
			},
			{
				id: "r2",
				project_id: "p",
				workspace_id: null,
				content_type: "video",
				status: "done",
				cursor: 2,
				instruction: "fix",
				snapshot: {
					outcomeEvaluation: evaluation("passed", {
						briefKeywordCoverage: 80,
						visualContinuityPct: 100,
						durationErrorPct: 5,
					}),
				},
				created_at: 2000,
				updated_at: 2500,
			},
		];
		const report = buildProjectQualityReport({
			runs,
			tools: [
				{ cost: 0.04, latency_ms: 500 },
				{ cost: 0, latency_ms: 200 },
			] as never,
			artifacts: [{ status: "ready", created_at: 1600 }] as never,
			renders: [{ status: "done" }, { status: "failed" }] as never,
			events: [
				{ kind: "agent.feedback", payload_json: { action: "regenerate" } },
				{ kind: "agent.feedback", payload_json: { action: "accept" } },
			] as never,
		});
		expect(report).toMatchObject({
			runCount: 2,
			outcomePassPct: 50,
			briefCoveragePct: 50,
			visualContinuityPct: 85,
			firstUsableOutputMs: 600,
			targetedFixSuccessPct: 100,
			renderPassPct: 50,
			durationErrorPct: 15,
			unsupportedClaimCount: 1,
			totalToolCost: 0.04,
			totalGenerationTimeMs: 700,
			feedback: { accept: 1, regenerate: 1, rollback: 0 },
		});
	});
	test("counts the story visual-beat signals from the persisted plan", () => {
		const storyboard = storyboardWithPlan({
			sections: [
				section(1, {
					visualPrompts: ["planned one", "planned two"],
					visualSegments: [
						beat("authored one"),
						beat("authored two"),
						beat("authored three"),
						beat("authored four"),
					],
				}),
			],
		});
		const report = buildProjectQualityReport({
			runs: [],
			tools: [],
			artifacts: [],
			renders: [],
			storyboard,
		});
		expect(report.beatsPerPlannedShot).toBe(2);
		expect(report.visualBeatReusePct).toBe(0);
	});

	test("records both beat signals as absent when nothing has been generated", () => {
		const report = buildProjectQualityReport({ runs: [], tools: [], artifacts: [], renders: [] });
		// Absent, never a passing value: an ungenerated project has not passed.
		expect(report.beatsPerPlannedShot).toBeNull();
		expect(report.visualBeatReusePct).toBeNull();
	});

	test("records narrative arc coverage beside the visual beat signals", () => {
		const storyboard = storyboardWithPlan({
			arc: "three_act",
			engagement: { turn: "The rescue was the trap." },
			sections: [
				section(1, {
					chapterFunction: "setup",
					emotion: "curiosity",
					narration: "one",
					estimatedDurationSec: 20,
				}),
				section(2, {
					chapterFunction: "inciting_incident",
					emotion: "suspense",
					narration: "two",
					estimatedDurationSec: 20,
				}),
				section(3, {
					chapterFunction: "rising_action",
					emotion: "tension",
					narration: "three",
					estimatedDurationSec: 20,
				}),
				section(4, {
					chapterFunction: "midpoint_turn",
					emotion: "shock",
					narration: "four",
					estimatedDurationSec: 20,
				}),
				section(5, {
					chapterFunction: "climax",
					emotion: "tension",
					narration: "five",
					estimatedDurationSec: 20,
				}),
				section(6, {
					chapterFunction: "resolution",
					emotion: "relief",
					narration: "six",
					estimatedDurationSec: 20,
				}),
			],
		});
		const report = buildProjectQualityReport({
			runs: [],
			tools: [],
			artifacts: [],
			renders: [],
			storyboard,
		});
		expect(report.arcCoverage).toMatchObject({
			arc: "three_act",
			sections: 6,
			missingFunctions: [],
			functionsOrdered: true,
			turnFulfilled: true,
			distinctEmotions: 5,
		});
		expect(report.arcCoverage!.midpointPosition).toBeCloseTo(0.58, 2);
	});

	test("a plan carrying no arc reports no arc signals and still produces a report", () => {
		// A plan with no arc and no chapter functions.
		const storyboard = storyboardWithPlan({
			sections: [section(1, { visualPrompts: ["planned"], visualSegments: [beat("authored")] })],
		});
		const report = buildProjectQualityReport({
			runs: [],
			tools: [],
			artifacts: [],
			renders: [],
			storyboard,
		});
		expect(report.arcCoverage).toBeNull();
		expect(report.beatsPerPlannedShot).toBe(1);
		expect(report.runCount).toBe(0);
	});

	test("derives no relevance figure from objective/prompt token overlap", () => {
		const report = buildProjectQualityReport({ runs: [], tools: [], artifacts: [], renders: [] });
		expect(report).not.toHaveProperty("visualRelevancePct");
	});
});
