import { describe, expect, test } from "vite-plus/test";
import { renderToStaticMarkup } from "react-dom/server";
import type { StoryboardGenerationState } from "@maleo/shared";
import { StoryboardSurface, type StoryboardSurfaceProps } from "./storyboard-view.tsx";

const state: StoryboardGenerationState = {
	planId: "plan-a",
	draft: {
		revisionId: "rev-a",
		sections: [
			{
				id: "section-a",
				title: "Opening",
				beats: [
					{
						id: "beat-a",
						title: "Hook",
						narration: "Start here",
						visualPrompt: "Wide reveal",
						editorial: {
							purpose: "establish",
							presentation: "headline",
							visualConcept: "door opens into hard light",
							noveltyKey: "threshold",
							onScreenText: "No way back",
							sfxCue: null,
							shots: [
								{
									index: 0,
									visualIntent: "Hero crosses the threshold",
									role: "continuity",
									bindings: [{ entityId: "hero" }, { plannedKey: "door" }],
									rationale: "Keeps hero and threshold legible.",
								},
							],
						},
					},
				],
			},
		],
	},
	approvedSnapshot: {
		revisionId: "rev-a",
		sections: [
			{
				id: "section-a",
				title: "Opening",
				beats: [
					{ id: "beat-a", title: "Hook", narration: "Start here", visualPrompt: "Wide reveal" },
				],
			},
		],
		approvalMode: "explicit",
		extensionPolicy: "review_additions",
		approvedAt: new Date(0).toISOString(),
	},
};

function draft(
	patch: Partial<StoryboardSurfaceProps["draft"]> = {},
): StoryboardSurfaceProps["draft"] {
	return {
		confirmed: state,
		storyboard: state,
		legacy: false,
		generatedByBeatId: {
			"beat-a": [
				{
					status: "failed",
					error: "second image failed",
					imageUrls: ["current.png", "stale.png"],
					imageSourceRevisionIds: ["rev-a", "old"],
					voiceSegments: [
						{ audioUrl: "voice.wav", audioDurationSec: 2.5, sourceRevisionId: "rev-a" },
					],
				},
			],
		},
		references: {
			"entity:hero": { label: "Mara", role: "character", source: "existing" },
			"planned:door": { label: "Threshold door", role: "prop", source: "planned" },
		},
		selectedBeatId: null,
		pending: false,
		loading: false,
		error: null,
		conflict: null,
		textDrafts: {},
		refresh: async () => {},
		selectBeat: () => {},
		setTextDraft: () => {},
		submit: async () => ({ ok: true, state, legacy: false, generatedByBeatId: {} }),
		approve: async () => ({ ok: true, state, legacy: false, generatedByBeatId: {} }),
		...patch,
	};
}

const assist = async (): Promise<void> => {};

describe("StoryboardSurface", () => {
	test("empty project offers direct creation without chat", () => {
		const html = renderToStaticMarkup(
			<StoryboardSurface draft={draft({ confirmed: null, storyboard: null })} onAssist={assist} />,
		);
		expect(html).toContain("Create storyboard");
		expect(html).toContain("Chat remains optional");
	});

	test("renders approval provenance and grouped current, stale, failed, and multi-output state", () => {
		const html = renderToStaticMarkup(<StoryboardSurface draft={draft()} onAssist={assist} />);
		expect(html).toContain("Approved revision rev-a");
		expect(html).toContain("Current visual");
		expect(html).toContain("Stale visual");
		expect(html).toContain("Current voice");
		expect(html).toContain("second image failed");
		expect(html).toContain("Editorial direction");
		expect(html).toContain("door opens into hard light");
		expect(html).toContain("No way back");
		expect(html).toContain('placeholder="Silence"');
		expect(html).toContain("Planned visual direction");
		expect(html).toContain("Hero crosses the threshold");
		expect(html).toContain("Mara");
		expect(html).toContain("character · existing");
		expect(html).toContain("Threshold door");
		expect(html).toContain("prop · planned");
		expect(html).toContain("Keeps hero and threshold legible.");
		expect(html.match(/Generated visual/g)).toHaveLength(2);
	});

	test("renders explicit conflict review state", () => {
		const conflict = {
			ok: false,
			reason: "conflict",
			message: "reload",
			state,
			legacy: false,
			generatedByBeatId: {},
		} as const;
		const html = renderToStaticMarkup(
			<StoryboardSurface draft={draft({ conflict })} onAssist={assist} />,
		);
		expect(html).toContain("Revision conflict");
		expect(html).toContain("Review latest");
	});
});
