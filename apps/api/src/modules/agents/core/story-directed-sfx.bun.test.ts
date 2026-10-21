import { describe, expect, test } from "bun:test";
import type { StorySection } from "../../../lib/story.ts";
import { plannedStoryAccentHits } from "./services/story-assets.ts";

const policy = {
	entrySfxCue: "template whoosh",
	pauseSec: 0.6,
	leadInSec: 0,
	sfxOffsetSec: 0,
	sfxVolume: 0.4,
};
const sections: StorySection[] = [
	{
		id: "one",
		semanticBeatId: "one",
		title: "One",
		narration: "One",
		visualPrompt: "one",
		estimatedDurationSec: 3,
		audioDurationSec: 3,
		audioUrl: "/one.wav",
		imageUrl: "/one.png",
		editorial: {
			purpose: "establish",
			presentation: "narrative",
			visualConcept: "one",
			noveltyKey: "one",
			sfxCue: null,
		},
	},
	{
		id: "two",
		semanticBeatId: "two",
		title: "Two",
		narration: "Two",
		visualPrompt: "two",
		estimatedDurationSec: 3,
		audioDurationSec: 3,
		audioUrl: "/two.wav",
		imageUrl: "/two.png",
		editorial: {
			purpose: "reveal",
			presentation: "headline",
			visualConcept: "two",
			noveltyKey: "two",
			sfxCue: "wooden latch snap",
		},
	},
];

describe("directed story SFX", () => {
	test("silence removes generic accents and a selected cue uses its own asset", () => {
		const hits = plannedStoryAccentHits(
			sections,
			policy,
			["/template.wav"],
			new Map([["two", { cue: "wooden latch snap", url: "/latch.wav" }]]),
		);
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({
			content: "wooden latch snap",
			url: "/latch.wav",
			startSec: 3.6,
		});
	});

	test("pinned template path remains authoritative", () => {
		const hits = plannedStoryAccentHits(sections, policy, ["/pinned.wav"], undefined);
		expect(hits.map((hit) => hit.url)).toEqual(["/pinned.wav", "/pinned.wav"]);
	});
});
