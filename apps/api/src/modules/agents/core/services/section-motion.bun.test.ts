import { afterEach, describe, expect, test } from "bun:test";
import { MOTION_EXAMPLES, textAnimationSchema, type StoryEditorialDecision } from "@maleo/shared";
import { setTextRunnerForTests } from "../../../../lib/text-runner.ts";
import type { AgentJob, AgentTextOverlay } from "../model.ts";
import {
	authorSectionMotion,
	directedTextOverlays,
	motionIdBase,
	type DirectedTextSlot,
} from "./section-motion.ts";

const headline = MOTION_EXAMPLES.find((e) => e.presentation === "headline")!;

function job(textOverlays: AgentJob["textOverlays"] = []): AgentJob {
	return {
		id: "job-motion",
		projectId: "p",
		contentType: "video",
		status: "running",
		aspect: "16:9",
		visualStyle: "flat editorial, coral accent",
		events: [],
		artifacts: [],
		scenes: [],
		textOverlays,
		videoOverlays: [],
		audioOverlays: [],
	} as unknown as AgentJob;
}

const editorial = (
	presentation: StoryEditorialDecision["presentation"],
): StoryEditorialDecision => ({
	purpose: "reveal",
	presentation,
	visualConcept: "a bold title card",
	noveltyKey: "title",
	onScreenText: "Ship faster",
	sfxCue: null,
});
const slot = (presentation: StoryEditorialDecision["presentation"]): DirectedTextSlot => ({
	text: "Ship faster",
	startSec: 4,
	durationSec: 2.4,
	editorial: editorial(presentation),
});

/** Answers prompts in order and counts the calls. */
function answering(...replies: string[]) {
	const calls: string[] = [];
	setTextRunnerForTests(async (prompt) => {
		calls.push(prompt);
		return { stdout: replies.shift() ?? "{}", stderr: "" };
	});
	return calls;
}

async function authored(): Promise<{ j: AgentJob; clips: AgentTextOverlay[] }> {
	const j = job();
	answering(JSON.stringify(headline.intent));
	await authorSectionMotion(j, [slot("headline")]);
	return { j, clips: directedTextOverlays(j, [slot("headline")]) };
}

afterEach(() => setTextRunnerForTests(null));

describe("section motion", () => {
	test("a headline beat becomes one editable clip per layer, ids in its range", async () => {
		const { clips } = await authored();
		const base = motionIdBase(slot("headline"));
		expect(clips.map((c) => [c.id, c.preset])).toEqual([
			[base, "shape-rect"],
			[base + 1, "plain"],
			[base + 2, "shape-circle"],
		]);
		expect(clips.find((c) => c.preset === "plain")?.content).toBe("Ship faster");
		expect(new Set(clips.map((c) => c.track)).size).toBe(3);
		for (const clip of clips) {
			expect(clip.startSec).toBeGreaterThanOrEqual(4);
			expect(clip.startSec + clip.durationSec).toBeLessThanOrEqual(4 + 2.4 + 1e-9);
			const animation = (clip.layout as { animation?: unknown }).animation;
			expect(animation).toBeDefined();
			expect(textAnimationSchema.safeParse(animation).success).toBe(true);
		}
	});

	test("motion takes lanes free of the overlays around it", async () => {
		const j = job();
		answering(JSON.stringify(headline.intent));
		await authorSectionMotion(j, [slot("headline")]);
		const title: AgentTextOverlay = { content: "Title", startSec: 3, durationSec: 3, track: 1 };
		const lanes = directedTextOverlays(j, [slot("headline")], [title]).map((c) => c.track);
		expect(Math.min(...(lanes as number[]))).toBe(2);
	});

	test("a failed beat keeps plain text and says why", async () => {
		const j = job();
		answering("not json", "{}");
		expect(await authorSectionMotion(j, [slot("explainer")])).toBe(0);
		expect(directedTextOverlays(j, [slot("explainer")])).toEqual([
			expect.objectContaining({ preset: "plain", content: "Ship faster" }),
		]);
		expect(j.events).toContainEqual(
			expect.objectContaining({ kind: "thinking_note", title: "Motion" }),
		);
	});

	test("lint findings are recorded with the run without blocking placement", async () => {
		const j = job();
		const offFrame = structuredClone(headline.intent);
		offFrame.layers[0]!.box = { ...offFrame.layers[0]!.box, xPct: 90, widthPct: 30 };
		answering(JSON.stringify(offFrame));
		expect(await authorSectionMotion(j, [slot("headline")])).toBe(1);
		expect(directedTextOverlays(j, [slot("headline")])).toHaveLength(3);
		expect(j.events).toContainEqual(
			expect.objectContaining({
				kind: "thinking_note",
				title: "Motion",
				body: expect.stringContaining("outside the frame"),
			}),
		);
	});

	test("a narrative beat gets no motion and no model call", async () => {
		const j = job();
		const calls = answering();
		expect(await authorSectionMotion(j, [slot("narrative")])).toBe(0);
		expect(calls).toHaveLength(0);
		expect(directedTextOverlays(j, [slot("narrative")])[0]?.preset).toBe("plain");
	});

	test("an unchanged beat is not authored twice in a run", async () => {
		const j = job();
		const calls = answering(JSON.stringify(headline.intent));
		await authorSectionMotion(j, [slot("headline")]);
		await authorSectionMotion(j, [slot("headline")]);
		expect(calls).toHaveLength(1);
	});

	test("an edited key survives regeneration, with no model call", async () => {
		const { clips } = await authored();
		const edited = clips.map((clip) =>
			clip.preset === "plain"
				? {
						...clip,
						layout: {
							...clip.layout,
							animation: { tracks: { opacity: [{ t: 0, v: 0.25, easing: "linear" as const }] } },
						},
					}
				: clip,
		);
		const later = job(edited);
		const calls = answering();
		expect(await authorSectionMotion(later, [slot("headline")])).toBe(0);
		expect(calls).toHaveLength(0);
		expect(directedTextOverlays(later, [slot("headline")])).toEqual(edited);
	});

	test("changed text asks for new motion", async () => {
		const { clips } = await authored();
		const later = job(clips);
		const calls = answering(JSON.stringify(headline.intent));
		await authorSectionMotion(later, [{ ...slot("headline"), text: "Ship faster today" }]);
		expect(calls).toHaveLength(1);
	});
});
