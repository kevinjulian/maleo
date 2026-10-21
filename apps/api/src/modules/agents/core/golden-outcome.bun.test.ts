import { describe, expect, test } from "bun:test";
import type { AgentJob } from "./model.ts";
import { createOutcomeContract, evaluateOutcome } from "./outcome.ts";

function video(
	instruction: string,
	scenes: AgentJob["scenes"],
	targetDurationSec: number,
): AgentJob {
	return {
		id: instruction,
		projectId: "golden",
		contentType: "video",
		status: "running",
		events: [],
		scenes,
		textOverlays: [],
		infographicOverlays: [],
		videoOverlays: [],
		audioOverlays: [],
		characters: [],
		artifacts: [],
		aspect: "9:16",
		brief: instruction,
		startedAt: 1,
		targetDurationSec,
		outcomeContract: {
			...createOutcomeContract({
				instruction,
				contentType: "video",
				format: "9:16",
				targetDurationSec,
			}),
			intent: "build_short",
		},
	};
}

describe("golden outcome briefs", () => {
	test("complete tutorial is usable on first delivery", () => {
		const result = evaluateOutcome(
			video(
				"Explain focus method",
				[
					{
						name: "Focus method",
						durationSec: 6,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "focus method timer",
						voiceover: "Explain a focus method",
						image: "/files/focus.png",
					},
				],
				6,
			),
		);
		expect(result.status).toBe("passed");
		expect(result.metrics).toMatchObject({ durationErrorPct: 0, visualContinuityPct: 70 });
	});

	test("factual claim without evidence never ships", () => {
		const result = evaluateOutcome(
			video(
				"Explain attention science",
				[
					{
						name: "Claim",
						durationSec: 10,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "attention science chart",
						voiceover: "Attention drops after eight seconds",
						claim: "Attention drops after eight seconds",
						image: "/files/chart.png",
					},
				],
				10,
			),
		);
		expect(result.status).toBe("failed");
		expect(result.findings).toEqual(
			expect.arrayContaining([expect.objectContaining({ id: "evidence-unsupported" })]),
		);
	});

	test("missing visual proposes an exact existing tool repair", () => {
		const result = evaluateOutcome(
			video(
				"Show a launch hook",
				[
					{
						name: "Hook",
						durationSec: 5,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "launch hook",
						voiceover: "Launch now",
					},
				],
				5,
			),
		);
		expect(result.findings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					fix: {
						command: expect.any(String),
						scope: "scene:0",
						tool: "generate_frame",
						args: { index: 0 },
					},
				}),
			]),
		);
	});
	test("no relevance figure is derived from objective/prompt token overlap, and none blocks", () => {
		/* The objective is Indonesian and the image prompt is English — the exact
		 * shape the removed `visualRelevancePct` scored near zero on and reported as
		 * a relevance failure. Nothing measures relevance lexically now, and no
		 * relevance finding may carry `blocker`. */
		const result = evaluateOutcome(
			video(
				"Ceritakan hidup sebagai lebah pekerja",
				[
					{
						name: "Wax",
						durationSec: 6,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "macro wax comb interior lit from one side",
						voiceover: "Kamu lahir di dalam lilin",
						image: "/files/wax.png",
					},
				],
				6,
			),
		);
		expect(result.metrics).not.toHaveProperty("visualRelevancePct");
		expect(
			result.findings.filter(
				(finding) => /relevan/i.test(finding.id) && finding.severity === "blocker",
			),
		).toEqual([]);
	});
});
