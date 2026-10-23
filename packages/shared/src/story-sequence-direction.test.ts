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
					presentation: "explainer",
					visualConcept: "Flow of customer funds",
					noveltyKey: "fund-route",
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

	test("reads a stored infographic beat as narrative without a motion graphic", () => {
		const stored = editorial({
			presentation: "infographic",
			motionGraphic: {
				needed: true,
				kind: "stat_reveal",
				purpose: "prove",
				reason: "show growth",
				value: "42%",
			},
		});
		expect(stored.presentation).toBe("narrative");
		expect(stored).not.toHaveProperty("motionGraphic");
		expect(storySequenceDirectionViolations([{ id: "a", editorial: stored }])).toEqual([]);
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
