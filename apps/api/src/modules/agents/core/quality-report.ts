import type { ContentProjectEventRow } from "@maleo/db/events";
import type { ContentRenderRow } from "@maleo/db/renders";
import type { RunArtifactRow, ToolRunRow, WorkflowRunRow } from "@maleo/db/workflow-run-db";
import type { OutcomeEvaluation } from "./model.ts";
import {
	storyArcCoverageSignals,
	storyPlanArcCoverageInput,
	storyPlanVisualSections,
	storyVisualBeatSignals,
	type StoryArcCoverageSignals,
} from "@maleo/shared";

export interface ProjectQualityReport {
	runCount: number;
	outcomePassPct: number | null;
	briefCoveragePct: number | null;
	visualContinuityPct: number | null;
	/** Final visual beats per planned shot over this project's generated story
	 *  sections. 1.00 is the contract: one authored visual per measured beat. */
	beatsPerPlannedShot: number | null;
	/** Share of adjacent visual beat pairs whose authored visuals normalize equal.
	 *  Counted, not thresholded — two identical strings, nothing tunable. */
	visualBeatReusePct: number | null;
	/* Narrative structure, beside the visual signals, so a project's structural
	 * health is visible in the same place as its visual health. Null for a plan
	 * carrying no arc — every document planned before arcs existed reports the rest
	 * of this report unchanged rather than failing. */
	arcCoverage: StoryArcCoverageSignals | null;
	firstUsableOutputMs: number | null;
	targetedFixSuccessPct: number | null;
	renderPassPct: number | null;
	durationErrorPct: number | null;
	unsupportedClaimCount: number;
	totalToolCost: number;
	totalGenerationTimeMs: number;
	feedback: { accept: number; regenerate: number; rollback: number };
}

function average(values: Array<number | undefined>): number | null {
	const finite = values.filter(
		(value): value is number => typeof value === "number" && Number.isFinite(value),
	);
	return finite.length
		? Math.round((finite.reduce((sum, value) => sum + value, 0) / finite.length) * 10) / 10
		: null;
}

function evaluation(run: WorkflowRunRow): OutcomeEvaluation | null {
	const value = run.snapshot?.outcomeEvaluation;
	if (!value || typeof value !== "object") return null;
	// SAFETY: `schemaVersion` is the discriminant this type carries for exactly
	// this read — an evaluation written by any version of the evaluator stamps 1,
	// and a snapshot holding something else under this key fails the check rather
	// than being reported as a passing run. The write side is `runOutcomeEval`,
	// in this package.
	const evaluated = value as OutcomeEvaluation;
	return evaluated.schemaVersion === 1 ? evaluated : null;
}

export function buildProjectQualityReport(input: {
	runs: WorkflowRunRow[];
	tools: ToolRunRow[];
	artifacts: RunArtifactRow[];
	renders: ContentRenderRow[];
	events?: ContentProjectEventRow[];
	storyboard?: unknown;
}): ProjectQualityReport {
	const chronological = [...input.runs].sort((a, b) => a.created_at - b.created_at);
	const evaluations = chronological
		.map(evaluation)
		.filter((value): value is OutcomeEvaluation => Boolean(value));
	const failedIndexes = evaluations
		.map((value, index) => ({ value, index }))
		.filter(({ value }) => value.status === "failed");
	const repaired = failedIndexes.filter(({ index }) =>
		evaluations.slice(index + 1).some((value) => value.status === "passed"),
	).length;
	const firstRunAt = chronological[0]?.created_at;
	const firstArtifactAt = input.artifacts
		.filter((artifact) => artifact.status === "ready")
		.sort((a, b) => a.created_at - b.created_at)[0]?.created_at;
	const successfulRenders = input.renders.filter((render) => render.status === "done").length;
	const feedback = { accept: 0, regenerate: 0, rollback: 0 };
	for (const event of input.events ?? []) {
		if (event.kind !== "agent.feedback") continue;
		const action = event.payload_json?.action;
		if (action === "accept" || action === "regenerate" || action === "rollback") feedback[action]++;
	}
	/* Counted over the project's own generated story sections rather than averaged
	 * out of stored evaluations — the two figures it replaces were recorded on zero
	 * runs, so an average of them was always null. A project with no generated story
	 * sections reports both as absent, which is not the same as passing. */
	const beatSignals = storyVisualBeatSignals(storyPlanVisualSections(input.storyboard));
	/* Reported, never enforced. Nothing reads this to fail a section or gate
	 * submission — a midpoint at 0.62 of runtime is a pacing opinion, not a defect
	 * that would waste a provider call. */
	const arcInput = storyPlanArcCoverageInput(input.storyboard);
	const arcCoverage = arcInput ? storyArcCoverageSignals(arcInput) : null;
	return {
		runCount: chronological.length,
		outcomePassPct: evaluations.length
			? Math.round(
					(evaluations.filter((value) => value.status === "passed").length / evaluations.length) *
						1000,
				) / 10
			: null,
		briefCoveragePct: average(evaluations.map((value) => value.metrics.briefKeywordCoverage)),
		visualContinuityPct: average(evaluations.map((value) => value.metrics.visualContinuityPct)),
		beatsPerPlannedShot: beatSignals.beatsPerPlannedShot,
		visualBeatReusePct: beatSignals.visualBeatReusePct,
		arcCoverage,
		firstUsableOutputMs:
			firstRunAt != null && firstArtifactAt != null
				? Math.max(0, firstArtifactAt - firstRunAt)
				: null,
		targetedFixSuccessPct: failedIndexes.length
			? Math.round((repaired / failedIndexes.length) * 1000) / 10
			: null,
		renderPassPct: input.renders.length
			? Math.round((successfulRenders / input.renders.length) * 1000) / 10
			: null,
		durationErrorPct: average(evaluations.map((value) => value.metrics.durationErrorPct)),
		unsupportedClaimCount: evaluations.reduce(
			(sum, value) =>
				sum + value.findings.filter((finding) => finding.id === "evidence-unsupported").length,
			0,
		),
		totalToolCost:
			Math.round(input.tools.reduce((sum, tool) => sum + (tool.cost ?? 0), 0) * 10000) / 10000,
		totalGenerationTimeMs: input.tools.reduce((sum, tool) => sum + (tool.latency_ms ?? 0), 0),
		feedback,
	};
}
