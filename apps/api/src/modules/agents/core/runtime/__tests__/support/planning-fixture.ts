/* Story planning without providers, counting what runs: the frame, the research
 * pass, and the drafts. The same seams the post-research suites use. */
import {
	setStoryBibleAuthorForTests,
	setStoryFramePlannerForTests,
	setStoryPlannerForTests,
	setStyleBibleGeneratorForTests,
} from "../../../../../../lib/content-generator.ts";
import { setEvidenceAnalyzerForTests } from "../../../post-research-clarification.ts";
import { setResearchProviderForTests } from "../../../services/research.ts";
import { setStoryClarificationPlannerForTests } from "../../../story-clarification-planner.ts";
import type { StoryClarificationBatch } from "@maleo/shared";

/** What planning has run since the stubs were installed. */
export interface PlanningCalls {
	frames: number;
	searches: number;
	drafts: string[];
}

export const planningCalls: PlanningCalls = { frames: 0, searches: 0, drafts: [] };

export const POST_RESEARCH_BATCH: StoryClarificationBatch = {
	id: "post-1",
	stage: "post_research",
	purpose: "story_brief",
	questions: [
		{
			id: "case",
			header: "Case study",
			question: "Which fund should the video follow?",
			options: [
				{
					id: "ohio",
					label: "Ohio",
					value: "Follow the Ohio pension fund",
					description: "A high-return fund.",
					recommended: true,
					sources: [{ title: "Ohio pension study", url: "https://example.test/ohio" }],
				},
				{
					id: "vt",
					label: "Vermont",
					value: "Follow the Vermont pension fund",
					description: "A low-return counterexample.",
					sources: [{ title: "Vermont pension study", url: "https://example.test/vermont" }],
				},
			],
		},
	],
};

/** Install the planning stubs. `postResearch` decides whether the sources raise a
 *  question; `grounded: false` frames a story that needs no sources at all. */
export function installPlanningProviders(
	postResearch: "none" | "batch",
	options: { grounded?: boolean } = {},
): void {
	const grounded = options.grounded ?? true;
	planningCalls.frames = 0;
	planningCalls.searches = 0;
	planningCalls.drafts = [];
	// No pre-research questions: planning goes ahead, recorded as "unavailable".
	setStoryClarificationPlannerForTests(async () => null);
	setStoryFramePlannerForTests(async () => {
		planningCalls.frames += 1;
		return grounded
			? {
					planKind: "explainer",
					arc: "three_act",
					language: "en",
					grounding: { needed: true, questions: ["what returns are typical?"] },
				}
			: {
					planKind: "story",
					arc: "three_act",
					language: "en",
					grounding: { needed: false, questions: [] },
				};
	});
	setResearchProviderForTests({
		search: async () => {
			planningCalls.searches += 1;
			return [
				{
					title: "Ohio pension study",
					url: "https://example.test/ohio",
					snippet: "7.1% over 30 years.",
				},
				{
					title: "Vermont pension study",
					url: "https://example.test/vermont",
					snippet: "4.4% over 30 years.",
				},
			];
		},
		readPage: async () => ({
			title: "Pension study",
			text: "Long-run returns of public pension funds compounded over thirty years.",
		}),
	});
	setStoryPlannerForTests(async (brief) => {
		planningCalls.drafts.push(brief);
		return [
			{
				title: "Opening",
				narration: "A concise opening about compounding.",
				visualPrompt: "A ledger filling with numbers",
			},
		];
	});
	setStyleBibleGeneratorForTests(async () => "test style bible");
	setStoryBibleAuthorForTests(async () => ({
		subjects: [{ id: "s", label: "subject" }],
		locations: [{ id: "l", label: "place" }],
		medium: "m",
		palette: "p",
		negatives: ["n"],
	}));
	setEvidenceAnalyzerForTests(async () =>
		postResearch === "batch" ? { kind: "batch", batch: POST_RESEARCH_BATCH } : { kind: "none" },
	);
}

export function removePlanningProviders(): void {
	setStoryClarificationPlannerForTests(null);
	setStoryFramePlannerForTests(null);
	setResearchProviderForTests(null);
	setStoryPlannerForTests(null);
	setStyleBibleGeneratorForTests(null);
	setStoryBibleAuthorForTests(null);
	setEvidenceAnalyzerForTests(null);
}
