import { describe, expect, test } from "vite-plus/test";
import {
	storyEditorialDecisionSchema,
	storySequenceDirectionViolations,
	type DirectedStoryBeat,
} from "./story-sequence-direction.ts";

const editorial = (overrides: Record<string, unknown> = {}) =>
	storyEditorialDecisionSchema.parse({
		purpose: "establish",
		presentation: "narrative",
		visualConcept: "Empty exchange lobby after withdrawals stop",
		noveltyKey: "empty-lobby",
		sfxCue: null,
		...overrides,
	});

describe("story sequence direction", () => {
	test("accepts distinct treatments and intentional silence", () => {
		const beats: DirectedStoryBeat[] = [
			{ id: "a", editorial: editorial() },
			{
				id: "b",
				editorial: editorial({
					purpose: "explain",
					presentation: "infographic",
					visualConcept: "Flow of customer funds",
					noveltyKey: "fund-route",
					motionGraphic: {
						needed: true,
						kind: "table_build",
						purpose: "evidence",
						reason: "show route",
						title: "Fund route",
						columns: ["Step", "Destination"],
						tableRows: [
							["1", "FTX"],
							["2", "Alameda"],
						],
					},
				}),
			},
		];
		expect(storySequenceDirectionViolations(beats, { requireDirection: true })).toEqual([]);
	});

	test("reports missing direction only when required or partially directed", () => {
		const legacy = [{ id: "a" }, { id: "b" }];
		expect(storySequenceDirectionViolations(legacy)).toEqual([]);
		expect(
			storySequenceDirectionViolations(legacy, { requireDirection: true }).map(
				(item) => item.invariant,
			),
		).toEqual(["missing_direction", "missing_direction"]);
		expect(
			storySequenceDirectionViolations([{ id: "a", editorial: editorial() }, { id: "b" }]).map(
				(item) => item.invariant,
			),
		).toEqual(["missing_direction"]);
	});

	test("rejects repeated treatment and repeated non-silent SFX", () => {
		const same = editorial({ sfxCue: "generic whoosh" });
		const violations = storySequenceDirectionViolations([
			{ id: "a", editorial: same },
			{ id: "b", editorial: same },
		]);
		expect(violations.map((item) => item.invariant)).toEqual([
			"repeated_treatment",
			"repeated_sfx",
		]);
	});

	test("rejects prose stats and incomplete charts or tables", () => {
		const cases = [
			{
				needed: true,
				kind: "stat_reveal",
				purpose: "stat",
				reason: "cause",
				value: "panic becomes evidence",
			},
			{
				needed: true,
				kind: "bar_chart",
				purpose: "comparison",
				reason: "compare",
				rows: [{ label: "Only", value: 42 }],
			},
			{
				needed: true,
				kind: "table_build",
				purpose: "evidence",
				reason: "route",
				columns: ["Step"],
			},
		] as const;
		for (const motionGraphic of cases) {
			const violations = storySequenceDirectionViolations([
				{ id: "a", editorial: editorial({ presentation: "infographic", motionGraphic }) },
			]);
			expect(violations.map((item) => item.invariant)).toEqual(["invalid_infographic"]);
		}
	});

	test("keeps native text out of image concept", () => {
		const violations = storySequenceDirectionViolations([
			{
				id: "a",
				editorial: editorial({
					onScreenText: "25 years",
					visualConcept: "Court document showing 25 years",
				}),
			},
		]);
		expect(violations.map((item) => item.invariant)).toEqual(["native_text_in_image"]);
	});
});
