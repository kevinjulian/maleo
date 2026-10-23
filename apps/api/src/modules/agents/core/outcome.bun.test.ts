import { describe, expect, test } from "bun:test";
import type { AgentJob } from "./model.ts";
import {
	createOutcomeContract,
	evaluateOutcome,
	recordOutcomeEvaluation,
	setOutcomeIntent,
} from "./outcome.ts";

function job(over: Partial<AgentJob> = {}): AgentJob {
	const base: AgentJob = {
		id: "run-1",
		projectId: "project-1",
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
		brief: "Explain why people lose focus and give practical focus methods",
		startedAt: 100,
		targetDurationSec: 10,
		outcomeContract: {
			...createOutcomeContract({
				instruction: "Make a 10 second video explaining focus loss and practical methods",
				brief: "Explain why people lose focus and give practical focus methods",
				contentType: "video",
				format: "9:16",
				targetDurationSec: 10,
				createdAt: 100,
			}),
			intent: "build_short",
		},
	};
	return { ...base, ...over };
}

describe("outcome contract", () => {
	test("snapshots exact user objective and delivery constraints", () => {
		const contract = createOutcomeContract({
			instruction: "Buat video 2 menit tentang fokus",
			brief: "beri penyebab dan tindakan",
			contentType: "video",
			format: "9:16",
			audience: "students",
			platform: "reels",
			targetDurationSec: 120,
			createdAt: 42,
		});
		expect(contract.objective).toContain("2 menit");
		expect(contract.objective).toContain("penyebab dan tindakan");
		expect(contract.targetDurationSec).toBe(120);
		expect(contract.requirements.map((item) => item.id)).toContain("target_duration");
		expect(contract.createdAt).toBe(42);
	});

	test("stores classified intent on same immutable run target", () => {
		const current = job();
		setOutcomeIntent(current, "build_short");
		expect(current.outcomeContract?.intent).toBe("build_short");
	});
});

describe("outcome evaluation", () => {
	test("blocks empty or visually incomplete delivery", () => {
		const empty = evaluateOutcome(job(), 200);
		expect(empty.status).toBe("failed");
		expect(
			empty.findings.some(
				(finding) => finding.id === "content-empty" && finding.severity === "blocker",
			),
		).toBe(true);

		const missingVisual = evaluateOutcome(
			job({
				scenes: [
					{
						name: "Focus",
						durationSec: 10,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "student loses focus",
						voiceover: "People lose focus. Use timed deep work.",
					},
				],
			}),
			200,
		);
		expect(
			missingVisual.findings.some(
				(finding) =>
					finding.id === "visuals-missing-scene-0" &&
					finding.severity === "blocker" &&
					finding.fix?.tool === "generate_frame",
			),
		).toBe(true);
	});

	test("passes complete render-safe delivery near requested duration", () => {
		const result = evaluateOutcome(
			job({
				scenes: [
					{
						name: "Focus loss",
						durationSec: 5,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "student loses focus",
						voiceover: "People lose focus.",
						image: "/files/focus.png",
					},
					{
						name: "Focus method",
						durationSec: 5,
						shot: "close",
						move: "pan",
						transition: "cut",
						visual: "student uses timed deep work",
						voiceover: "Use practical timed focus methods.",
						image: "/files/method.png",
					},
				],
			}),
			200,
		);
		expect(result.status).toBe("passed");
		expect(result.score).toBe(100);
		expect(result.metrics.durationErrorPct).toBe(0);
	});

	test("blocks visual and voiceover segments above template pacing limits", () => {
		const result = evaluateOutcome(
			job({
				scenes: [
					{
						name: "Long hold",
						durationSec: 10,
						contentDurationSec: 9,
						shot: "wide",
						move: "Static",
						transition: "cut",
						visual: "unchanged frame",
						voiceover: "Long thought",
						image: "/files/hold.png",
					},
				],
				audioOverlays: [
					{
						id: 1,
						kind: "voiceover",
						content: "Long thought",
						url: "/files/long.wav",
						startSec: 0,
						durationSec: 9,
					},
				],
			}),
			200,
		);
		expect(result.status).toBe("failed");
		expect(result.findings.some((finding) => finding.id.includes("long_visual_beat"))).toBe(true);
		expect(result.findings.some((finding) => finding.id.includes("long_voiceover_segment"))).toBe(
			true,
		);
	});

	test("blocks unsupported factual claims and invalid caption timing", () => {
		const result = evaluateOutcome(
			job({
				scenes: [
					{
						name: "Claim",
						durationSec: 10,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "focus chart",
						voiceover: "Focus falls after 8 seconds.",
						claim: "Focus falls after 8 seconds.",
						image: "/files/focus.png",
					},
				],
				audioOverlays: [
					{
						id: 1,
						kind: "voiceover",
						content: "Focus",
						url: "/files/focus.wav",
						startSec: 0,
						durationSec: 2,
						words: [{ text: "Focus", startSec: 0, endSec: 3 }],
					},
				],
			}),
			200,
		);
		expect(result.status).toBe("failed");
		expect(result.findings.some((finding) => finding.id === "evidence-unsupported")).toBe(true);
		expect(result.findings.some((finding) => finding.id === "timeline-invalid")).toBe(true);
	});

	test("blocks competing primary presentation layers", () => {
		const result = evaluateOutcome(
			job({
				scenes: [
					{
						name: "Summary",
						durationSec: 10,
						shot: "wide",
						move: "zoom",
						transition: "cut",
						visual: "five habits",
						voiceover: "Practice five habits every day",
						image: "/files/focus.png",
					},
				],
				textOverlays: [
					{
						id: 1,
						content: "Practice five habits every day for a happier life",
						startSec: 0,
						durationSec: 3,
						preset: "explainer-card",
					},
					{ id: 2, content: "Five habits", startSec: 0, durationSec: 3, preset: "title" },
				],
				audioOverlays: [
					{
						id: 3,
						kind: "voiceover",
						content: "Practice five habits every day",
						url: "/files/focus.wav",
						startSec: 0,
						durationSec: 3,
					},
				],
			}),
			200,
		);
		expect(result.status).toBe("failed");
		expect(
			result.findings.some(
				(finding) => finding.requirementId === "viewer_attention" && finding.severity === "blocker",
			),
		).toBe(true);
		expect(result.metrics.peakAttentionLoad).toBeGreaterThan(2);
	});

	test("records queryable evaluation event on job", () => {
		const current = job({
			scenes: [
				{
					name: "Focus",
					durationSec: 10,
					shot: "wide",
					move: "zoom",
					transition: "cut",
					visual: "focus method",
					voiceover: "practical focus method",
					image: "/files/focus.png",
				},
			],
		});
		const result = recordOutcomeEvaluation(current);
		expect(current.outcomeEvaluation).toEqual(result);
		expect(current.events.at(-1)).toEqual({ kind: "outcome_evaluation", evaluation: result });
	});
});
