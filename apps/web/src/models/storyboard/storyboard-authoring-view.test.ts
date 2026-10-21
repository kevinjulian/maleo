import { describe, expect, test } from "vite-plus/test";
import type { StoryboardGenerationState } from "@maleo/shared";
import {
	splitBeatNarration,
	storyboardBeatOutput,
	storyboardChatInstruction,
	storyboardPhase,
} from "./storyboard-authoring-view.ts";

const state: StoryboardGenerationState = {
	planId: "plan-a",
	draft: {
		revisionId: "rev-a",
		sections: [
			{
				id: "section-a",
				title: "One",
				beats: [{ id: "beat-a", title: "A", narration: "Words", visualPrompt: "Wide" }],
			},
		],
	},
};

describe("storyboard authoring view model", () => {
	test("covers loading, failed, empty, legacy, draft, approved, generating, and conflict phases", () => {
		const input = {
			state,
			legacy: false,
			loading: false,
			error: null,
			conflict: null,
			generatedByBeatId: {},
		};
		expect(storyboardPhase({ ...input, loading: true })).toBe("loading");
		expect(storyboardPhase({ ...input, error: "no" })).toBe("failed");
		expect(storyboardPhase({ ...input, state: null })).toBe("empty");
		expect(storyboardPhase({ ...input, legacy: true })).toBe("legacy");
		expect(storyboardPhase(input)).toBe("draft");
		expect(
			storyboardPhase({
				...input,
				state: {
					...state,
					approvedSnapshot: {
						...state.draft,
						approvalMode: "explicit",
						extensionPolicy: "review_additions",
						approvedAt: new Date(0).toISOString(),
					},
				},
			}),
		).toBe("approved");
		expect(
			storyboardPhase({ ...input, generatedByBeatId: { "beat-a": [{ status: "imaging" }] } }),
		).toBe("generating");
		expect(storyboardPhase({ ...input, conflict: {} })).toBe("conflict");
	});

	test("groups current, stale, failed, and multiple generated outputs under beat", () => {
		const generated = [
			{
				status: "failed",
				error: "image failed",
				imageUrls: ["a.png", "b.png"],
				imageSourceRevisionIds: ["approved", "old"],
				voiceSegments: [{ audioUrl: "a.wav", audioDurationSec: 2.5, sourceRevisionId: "approved" }],
			},
		];
		expect(storyboardBeatOutput(generated, "approved", state.draft.sections[0]!.beats[0])).toEqual({
			images: [
				{ url: "a.png", stale: false },
				{ url: "b.png", stale: true },
			],
			voices: [{ url: "a.wav", durationSec: 2.5, stale: false }],
			status: "failed",
			error: "image failed",
			voiceDirection: undefined,
			pacing: undefined,
			emotion: undefined,
		});
	});

	test("selected-beat chat instruction scopes identity", () => {
		expect(storyboardChatInstruction("improve", "beat-a")).toContain('"beat-a"');
		expect(storyboardChatInstruction("improve", "beat-a")).toContain(
			"preserve every unrelated beat",
		);
	});

	test("split keeps all narration", () => {
		expect(splitBeatNarration("one two three four")).toEqual(["one two", "three four"]);
	});
});
