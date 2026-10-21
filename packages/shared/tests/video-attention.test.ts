import { describe, expect, test } from "vite-plus/test";
import {
	attentionLoadPerSecond,
	lintAttention,
	type AttentionSpan,
} from "../src/video-attention.ts";

describe("viewer attention", () => {
	test("scores simultaneous semantic and audio cues", () => {
		const spans: AttentionSpan[] = [
			{ kind: "voiceover", start: 0, dur: 3 },
			{ kind: "text", start: 0, dur: 3 },
			{ kind: "infographic", start: 0, dur: 3 },
			{ kind: "sfx", start: 0, dur: 0.4 },
			{ kind: "scene_cut", start: 0.2, dur: 0 },
		];
		expect(attentionLoadPerSecond(3, spans)[0]).toBeGreaterThan(4);
	});

	test("blocks sustained overload and competing primary overlays", () => {
		const spans: AttentionSpan[] = [
			{ kind: "voiceover", content: "Practice five habits every day", start: 0, dur: 3 },
			{ kind: "caption", start: 0, dur: 3 },
			{
				kind: "text",
				content: "Practice five habits every day for a happier life",
				start: 0,
				dur: 3,
			},
			{ kind: "infographic", start: 0, dur: 3 },
			{ kind: "motion", start: 0, dur: 3 },
			{ kind: "sfx", start: 0, dur: 0.5 },
			{ kind: "scene_cut", start: 0.2, dur: 0 },
		];
		const findings = lintAttention(3, spans);
		expect(findings.some((finding) => finding.code === "viewer_overload")).toBe(true);
		expect(
			findings.some(
				(finding) => finding.code === "semantic_stack" && finding.severity === "blocker",
			),
		).toBe(true);
		expect(findings.some((finding) => finding.code === "duplicate_message")).toBe(true);
	});

	test("blocks text that exceeds reading time", () => {
		const findings = lintAttention(2, [
			{ kind: "text", content: "one two three four five six seven eight", start: 0, dur: 2 },
		]);
		expect(findings.some((finding) => finding.code === "unreadable_text")).toBe(true);
	});
});
