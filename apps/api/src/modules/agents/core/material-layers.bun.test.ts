/* Stage-specific material routing and layer order.
 *
 * The assertions that matter are the negative ones: what a stage does NOT
 * receive. A visual directive reaching the research topic redirects what the
 * video is about, which is the failure the channels exist to prevent. */
import { describe, expect, test } from "bun:test";
import {
	EMPTY_CREATIVE_DIRECTION,
	resolveWriterStyle,
	writerStyleProfiles,
	type CreativeDirection,
} from "@maleo/shared";
import { writerStyleCraftBlock } from "../../../lib/prompts/writer-style.ts";
import {
	rulesLayer,
	storyPromptLayers,
	visualPromptLayers,
	voicePromptLayers,
} from "./material-layers.ts";

const FULL: CreativeDirection = {
	raw: "",
	story: "hopeful finance drama",
	visual: "stickman on white background",
	voice: "slow female narrator",
	rules: "no captions",
};

describe("story stage", () => {
	test("takes the subject, Story material and Rules, in that order", () => {
		expect(storyPromptLayers("Compound interest", FULL)).toBe(
			"Compound interest\n\nhopeful finance drama\n\nHard constraints (must be obeyed):\nno captions",
		);
	});

	test("never receives visual or voice material", () => {
		const out = storyPromptLayers("Compound interest", FULL);
		expect(out).not.toContain("stickman");
		expect(out).not.toContain("slow female narrator");
	});

	test("empty direction leaves the subject alone", () => {
		expect(storyPromptLayers("Compound interest", EMPTY_CREATIVE_DIRECTION)).toBe(
			"Compound interest",
		);
		expect(storyPromptLayers("Compound interest", undefined)).toBe("Compound interest");
	});
});

describe("visual stage", () => {
	test("takes the scene, Visual material and Rules, in that order", () => {
		expect(visualPromptLayers("A rising bar chart", FULL)).toBe(
			"A rising bar chart\n\nstickman on white background\n\nHard constraints (must be obeyed):\nno captions",
		);
	});

	test("the scene leads so the frame's own subject is not overridden by the look", () => {
		expect(visualPromptLayers("A rising bar chart", FULL).indexOf("A rising bar chart")).toBe(0);
	});

	test("never receives story-only or voice-only material as instruction", () => {
		expect(visualPromptLayers("A rising bar chart", FULL)).not.toContain("slow female narrator");
	});
});

describe("voice stage", () => {
	test("takes the story brief, Voice material as delivery, and Rules", () => {
		expect(voicePromptLayers("Compound interest", FULL)).toBe(
			"Compound interest\n\nNarration delivery: slow female narrator\n\nHard constraints (must be obeyed):\nno captions",
		);
	});

	test("voice material is labelled as delivery, not as subject", () => {
		expect(voicePromptLayers("Compound interest", FULL)).toContain("Narration delivery:");
	});

	test("never receives visual material", () => {
		expect(voicePromptLayers("Compound interest", FULL)).not.toContain("stickman");
	});
});

describe("rules reach every stage", () => {
	const rulesOnly: CreativeDirection = {
		...EMPTY_CREATIVE_DIRECTION,
		rules: "keep the logo exact",
	};

	test("every stage carries the constraint", () => {
		for (const out of [
			storyPromptLayers("subject", rulesOnly),
			visualPromptLayers("scene", rulesOnly),
			voicePromptLayers("brief", rulesOnly),
		]) {
			expect(out).toContain("keep the logo exact");
		}
	});

	test("rules layer last, so they read as overriding the guidance above them", () => {
		const out = visualPromptLayers("scene", FULL);
		expect(out.indexOf("no captions")).toBeGreaterThan(out.indexOf("stickman"));
	});

	test("they are labelled as constraints rather than taste", () => {
		expect(rulesLayer(rulesOnly)).toBe("Hard constraints (must be obeyed):\nkeep the logo exact");
	});

	test("no rules means no layer at all, not an empty heading", () => {
		expect(rulesLayer(EMPTY_CREATIVE_DIRECTION)).toBe("");
		expect(rulesLayer(undefined)).toBe("");
		expect(storyPromptLayers("subject", EMPTY_CREATIVE_DIRECTION)).not.toContain(
			"Hard constraints",
		);
	});
});

describe("writer style stays out of the story layer", () => {
	const REPORTAGE = resolveWriterStyle("plainspoken_reportage")!;

	/* This string is also the RESEARCH TOPIC — `matchingResearch` fingerprints it to
	 * decide whether the run's existing research still applies. Craft guidance
	 * appended here changed that fingerprint, so picking a writer style silently
	 * threw away the run's research and refetched it. Craft belongs in the narration
	 * drafting prompt, via `writerStyleCraftBlock`. */
	test("the story layer is the subject, never the craft", () => {
		const out = storyPromptLayers("Compound interest", FULL);
		expect(out).toBe(
			"Compound interest\n\nhopeful finance drama\n\nHard constraints (must be obeyed):\nno captions",
		);
		expect(out).not.toContain("Narration craft");
		expect(out).not.toContain(REPORTAGE.sentenceRhythm);
	});

	test("no stage's layers carry the craft block", () => {
		for (const out of [
			storyPromptLayers("subject", FULL),
			visualPromptLayers("scene", FULL),
			voicePromptLayers("brief", FULL),
		]) {
			expect(out).not.toContain("Narration craft");
			expect(out).not.toContain("little did they know");
		}
	});

	/* The property that makes a writer style a constant rather than a suggestion. */
	test("the shared renderer is deterministic and empty without a profile", () => {
		expect(writerStyleCraftBlock(REPORTAGE)).toBe(writerStyleCraftBlock(REPORTAGE));
		expect(writerStyleCraftBlock(REPORTAGE)).toContain("Narration craft");
		expect(writerStyleCraftBlock(REPORTAGE)).toContain("little did they know");
		expect(writerStyleCraftBlock(undefined)).toBe("");
	});

	test("every library profile renders a block", () => {
		for (const profile of writerStyleProfiles()) {
			expect(writerStyleCraftBlock(profile)).toContain("Narration craft");
		}
	});
});

describe("prompt stability", () => {
	test("the same inputs always produce the same prompt", () => {
		expect(visualPromptLayers("scene", FULL)).toBe(visualPromptLayers("scene", FULL));
	});

	test("blank channels are dropped rather than leaving blank lines", () => {
		const partial: CreativeDirection = {
			...EMPTY_CREATIVE_DIRECTION,
			visual: "  ",
			rules: "no humans",
		};
		expect(visualPromptLayers("scene", partial)).toBe(
			"scene\n\nHard constraints (must be obeyed):\nno humans",
		);
	});
});
