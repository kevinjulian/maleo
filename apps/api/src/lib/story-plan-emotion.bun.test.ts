import { describe, expect, it } from "bun:test";
import { storyPlanSchema } from "./content-generator.ts";
import { materializePlannedSections } from "../modules/agents/core/evidence.ts";
import { imageOnlyPrompt } from "../modules/agents/core/services/story-assets.ts";

const section = (over: Record<string, unknown> = {}) => ({
	title: "Origins",
	narration: "A narration long enough to be a real spoken sentence.",
	visualPrompt: "A wide establishing shot",
	...over,
});

const parseOne = (over: Record<string, unknown> = {}) =>
	storyPlanSchema.parse({ sections: [section(over)] }).sections[0]!;

describe("longform plan section emotion", () => {
	it("keeps an emotion from the fixed vocabulary", () => {
		expect(parseOne({ emotion: "tension" }).emotion).toBe("tension");
	});

	it("normalises case and surrounding whitespace", () => {
		expect(parseOne({ emotion: "  Hope " }).emotion).toBe("hope");
	});

	it("records no emotion when the planner omits it", () => {
		expect(parseOne().emotion).toBeUndefined();
	});

	it("records no emotion for an out-of-vocabulary label, without failing the parse", () => {
		// Losing a whole generated plan over one bad label would be a far worse
		// outcome than falling back to the template's default cue.
		expect(parseOne({ emotion: "euphoria" }).emotion).toBeUndefined();
	});

	it("records no emotion for a non-string value", () => {
		expect(parseOne({ emotion: 7 }).emotion).toBeUndefined();
	});

	it("still parses every other field when the emotion is unusable", () => {
		const parsed = parseOne({ emotion: "euphoria" });
		expect(parsed.title).toBe("Origins");
		expect(parsed.visualPrompt).toBe("A wide establishing shot");
	});
});

describe("materializePlannedSections — emotion propagation", () => {
	it("carries a planned emotion onto the materialized section", () => {
		const [built] = materializePlannedSections(
			[parseOne({ emotion: "sadness" })],
			0,
			undefined,
			false,
		);
		expect(built!.emotion).toBe("sadness");
	});

	it("leaves the emotion absent when the plan carried none", () => {
		const [built] = materializePlannedSections([parseOne()], 0, undefined, false);
		expect(built!.emotion).toBeUndefined();
		expect("emotion" in built!).toBe(false);
	});
});

describe("materializePlannedSections — image prompt cues", () => {
	it("moves narration beat labels out of image prompts and into shot cues", () => {
		const [built] = materializePlannedSections(
			[
				parseOne({
					narration: "Batu berubah menjadi permainan. Anak-anak menyusunnya di tanah.",
					shots: [
						{
							visualPrompt:
								"A hand arranging stones. Narration beat: batu berubah menjadi permainan.",
						},
					],
				}),
			],
			0,
			undefined,
			false,
		);

		expect(built!.visualPrompts).toEqual(["A hand arranging stones."]);
		expect(built!.shotCues).toEqual(["batu berubah menjadi permainan."]);
		expect(built!.visualPrompts?.join(" ")).not.toContain("Narration beat");
	});

	it("does not retain a beat-label cue the narration never says", () => {
		// The label is still stripped out of the image prompt; the cue it yielded is
		// recorded as unverified, because grouping matches on it verbatim and this
		// section's narrator never speaks it.
		const [built] = materializePlannedSections(
			[
				parseOne({
					shots: [
						{
							visualPrompt:
								"A hand arranging stones. Narration beat: batu berubah menjadi permainan.",
						},
					],
				}),
			],
			0,
			undefined,
			false,
		);

		expect(built!.visualPrompts).toEqual(["A hand arranging stones."]);
		expect(built!.shotCues).toBeUndefined();
	});

	it("keeps explainer teaching metadata out of image prompts", () => {
		const prompt = imageOnlyPrompt(
			[
				"Clean chalkboard animation of a feedback loop.",
				"learningObjective: understand why habits compound.",
				"coreQuestion: why do tiny choices matter?",
				"conceptLadder: cue -> routine -> reward.",
				"teachingMove: demonstrate.",
			].join("\n"),
		);

		expect(prompt).toBe("Clean chalkboard animation of a feedback loop.");
		expect(prompt).not.toContain("learningObjective");
		expect(prompt).not.toContain("coreQuestion");
		expect(prompt).not.toContain("conceptLadder");
		expect(prompt).not.toContain("teachingMove");
	});
});
