import { describe, expect, it } from "vite-plus/test";
import {
	adjacentDuplicateStoryImagePromptIndexes,
	authoredStoryVisualText,
	storyVisualBeatSignals,
} from "./story-visual-signals.ts";
import { beatVisualIntentSchema } from "./beat-visual-intent.ts";
import { storyBeatCoverageViolations } from "./story-beat-coverage.ts";

describe("adjacent duplicate detection", () => {
	it("reports identical adjacent authored visuals", () => {
		expect(
			adjacentDuplicateStoryImagePromptIndexes([
				"a worker bee cleaning a wax cell",
				"a worker bee cleaning a wax cell",
				"pollen baskets filling on a flower",
			]),
		).toEqual([1]);
	});

	it("sees through a per-beat label appended after the authored visual", () => {
		/* The composed form the pipeline used to check. Two beats showing the same
		 * picture differed only by `N/M` and a canned composition string, so the
		 * gate returned [] on every section it ever ran against. Recovering the
		 * authored text first is what makes the duplicate visible. */
		const composed = [
			"a market stall, Final visual beat 1/3: concrete visual action, composition: foreground tactile detail",
			"a market stall, Final visual beat 2/3: concrete visual action, composition: over-body first-person movement",
		];
		expect(adjacentDuplicateStoryImagePromptIndexes(composed)).toEqual([]);
		expect(adjacentDuplicateStoryImagePromptIndexes(composed.map(authoredStoryVisualText))).toEqual(
			[1],
		);
	});

	it("allows a shared motif when the visible details differ", () => {
		expect(
			adjacentDuplicateStoryImagePromptIndexes([
				"wax comb corridor seen from bee height, antennae sweeping the wall",
				"wax comb corridor from above, a worker crossing the frame at speed",
			]),
		).toEqual([]);
	});
});

describe("storyVisualBeatSignals", () => {
	it("records both signals for a project with generated beats", () => {
		const signals = storyVisualBeatSignals([
			{
				visualPrompts: ["planned one", "planned two"],
				visualSegments: [
					{ visualPrompt: "planned one" },
					{ visualPrompt: "planned one" },
					{ visualPrompt: "planned two" },
					{ visualPrompt: "planned one" },
				],
			},
		]);
		expect(signals.sections).toBe(1);
		expect(signals.beats).toBe(4);
		expect(signals.plannedShots).toBe(2);
		expect(signals.beatsPerPlannedShot).toBe(2);
		// One adjacent pair out of three repeats.
		expect(signals.visualBeatReusePct).toBe(33.3);
		// planned two (index 1) then planned one (index 0) is a step backwards.
		expect(signals.nonMonotonicSteps).toBe(1);
	});

	it("reports one visual per beat as the contract met", () => {
		const signals = storyVisualBeatSignals([
			{
				visualPrompts: ["planned one", "planned two"],
				visualSegments: [{ visualPrompt: "authored one" }, { visualPrompt: "authored two" }],
			},
		]);
		expect(signals.beatsPerPlannedShot).toBe(1);
		expect(signals.visualBeatReusePct).toBe(0);
		expect(signals.nonMonotonicSteps).toBe(0);
	});

	it("records absent rather than passing when nothing has been generated", () => {
		const signals = storyVisualBeatSignals([{ visualPrompts: ["planned one"] }]);
		expect(signals.sections).toBe(0);
		expect(signals.beatsPerPlannedShot).toBeNull();
		expect(signals.visualBeatReusePct).toBeNull();
	});
});

describe("the recorded signal and the live gate agree", () => {
	/* They did not, once: the signal ran on authored text and the pre-submission
	 * check ran on the composed provider string, so a project could record 45.8%
	 * reuse while every section passed generation. Both now call the same
	 * predicate, and this pins that on one fixture. */
	const intent = (over: Record<string, unknown>) =>
		beatVisualIntentSchema.parse({
			beatIndex: 0,
			visualMoment: "the wax cap lifting",
			shotType: "extreme macro",
			subjectIds: ["bee"],
			...over,
		});

	it("both see a duplicate pair", () => {
		const beats = [intent({ beatIndex: 0 }), intent({ beatIndex: 1 })];
		const segments = beats.map((beat) => ({ visualPrompt: "rendered mirror", intent: beat }));

		const signals = storyVisualBeatSignals([{ visualPrompts: ["a"], visualSegments: segments }]);
		const violations = storyBeatCoverageViolations({
			beats: beats.map((beat) => ({ intent: beat })),
		});

		expect(signals.visualBeatReusePct).toBe(100);
		expect(violations.map((v) => v.invariant)).toEqual(["adjacent_differ"]);
	});

	it("both see a distinct pair", () => {
		const beats = [
			intent({ beatIndex: 0 }),
			intent({ beatIndex: 1, shotType: "wide establishing" }),
		];
		const segments = beats.map((beat) => ({ visualPrompt: "rendered mirror", intent: beat }));

		const signals = storyVisualBeatSignals([{ visualPrompts: ["a"], visualSegments: segments }]);
		const violations = storyBeatCoverageViolations({
			beats: beats.map((beat) => ({ intent: beat })),
		});

		// The rendered mirror is IDENTICAL on both beats here. A string comparison
		// would call this reuse; the structured one does not, which is the whole
		// point of moving off the composed prompt.
		expect(signals.visualBeatReusePct).toBe(0);
		expect(violations).toEqual([]);
	});

	it("falls back to prose for beats that predate structured intent", () => {
		const signals = storyVisualBeatSignals([
			{
				visualPrompts: ["a"],
				visualSegments: [{ visualPrompt: "a wax cell" }, { visualPrompt: "A wax cell." }],
			},
		]);
		expect(signals.visualBeatReusePct).toBe(100);
	});
});
