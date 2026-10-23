import { describe, expect, test } from "vite-plus/test";
import {
	critiqueStoryboard,
	HOOK_ARCHETYPES,
	WORKSPACE_LENSES,
	sceneRegenInstruction,
	styleTransferInstruction,
} from "./engage-actions.ts";
import type { PacingInputs } from "@models/analysis/pacing-analysis.ts";

const pacing = (totalSec: number, overrides: Partial<PacingInputs> = {}): PacingInputs => ({
	totalSec,
	scenes: [],
	captionWords: [],
	overlays: [],
	audioHits: [],
	effects: [],
	...overrides,
});

describe("critiqueStoryboard", () => {
	test("flags a numeric VO claim with no text overlay in the scene window", () => {
		const findings = critiqueStoryboard(
			pacing(8, { scenes: [{ start: 0, dur: 8, move: "Slow Zoom In" }] }),
			[{ start: 0, dur: 4, name: "Proof beat", vo: "rated 4.8 stars by 2,300 reviews" }],
			[],
		);
		expect(findings.some((f) => f.message.includes("no on-screen proof"))).toBe(true);
	});

	test("claim covered by an overlapping text overlay is not flagged", () => {
		const findings = critiqueStoryboard(
			pacing(8, { scenes: [{ start: 0, dur: 8, move: "Slow Zoom In" }] }),
			[{ start: 0, dur: 4, name: "Proof beat", vo: "rated 4.8 stars by 2,300 reviews" }],
			[{ start: 1, dur: 3 }],
		);
		expect(findings.some((f) => f.message.includes("no on-screen proof"))).toBe(false);
	});

	test("non-claim VO is not flagged and findings are time-sorted", () => {
		const findings = critiqueStoryboard(
			pacing(10, { scenes: [{ start: 0, dur: 10, move: "Static" }] }),
			[{ start: 2, dur: 4, name: "Story beat", vo: "this changed my morning routine" }],
			[],
		);
		expect(findings.some((f) => f.message.includes("no on-screen proof"))).toBe(false);
		for (let i = 1; i < findings.length; i++)
			expect(findings[i]!.startSec).toBeGreaterThanOrEqual(findings[i - 1]!.startSec);
	});

	test("includes pacing lint findings (weak hook on an empty open)", () => {
		const findings = critiqueStoryboard(
			pacing(10, { scenes: [{ start: 0, dur: 10, move: "Static" }] }),
			[],
			[],
		);
		expect(findings.some((f) => f.severity === "high")).toBe(true);
	});
});

describe("prompt builders", () => {
	test("five hook archetypes, all scoped to the first scene only", () => {
		expect(HOOK_ARCHETYPES.length).toBe(5);
		for (const h of HOOK_ARCHETYPES) expect(h.instruction).toContain("ONLY the hook");
	});

	test("workspace lenses are review-only", () => {
		expect(WORKSPACE_LENSES.length).toBeGreaterThanOrEqual(3);
		for (const p of WORKSPACE_LENSES) expect(p.instruction).toContain("Do not change anything");
	});

	test("scene regen is scoped to the given scene", () => {
		const s = sceneRegenInstruction(3, "make the demo clearer");
		expect(s).toContain("scene 3 ONLY");
		expect(s).toContain("make the demo clearer");
	});

	test("style transfer extracts traits without requesting identity imitation", () => {
		const prompt = styleTransferInstruction("fast cuts and bold type");
		expect(prompt).toContain(
			"pace, composition, tone, structure, palette, typography, and visual grammar",
		);
		expect(prompt).toContain("without imitating creator/channel identity");
		expect(prompt).not.toContain("Match this creator");
	});
});
