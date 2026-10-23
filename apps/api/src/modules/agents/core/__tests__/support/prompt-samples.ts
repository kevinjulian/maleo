import {
	directionRouterPrompt,
	storyFramePrompt,
	storyDraftPrompt,
	generateStyleBible,
	authorStoryBible,
	type StoryFrame,
} from "../../../../../lib/content-generator.ts";
import { storySequenceDirectionPrompt } from "../../../../../lib/story/creative-director.ts";
import { storyBeatVisualPrompt } from "../../../../../lib/story/image-director.ts";
import { lockedConstraintBlock } from "../../../../../lib/story/authoring-utils.ts";
import { setTextRunnerForTests } from "../../../../../lib/text-runner.ts";
import { storyClarificationPrompt } from "../../story-clarification-planner.ts";
import { evidenceDecisionPrompt } from "../../post-research-clarification.ts";
import { storyPromptLayers, voicePromptLayers, visualPromptLayers } from "../../material-layers.ts";
import { canonicalReferencePrompt } from "../../generated-reference.ts";
import { instructionsFor } from "../../runtime/instructions.ts";
import { writerStyleProfiles } from "@maleo/shared";
import { writerStyleCraftBlock } from "../../../../../lib/prompts/writer-style.ts";

/** Synthetic requests captured before extraction; no project, provider or billing. */
export async function promptSamples(): Promise<Record<string, string>> {
	const brief = "How a seed becomes a tree";
	const locked = {
		visual: "ink sketch",
		rules: "no text",
		references: [{ label: "Seed", description: "small brown seed" }],
	};
	const frame: StoryFrame = {
		planKind: "story",
		arc: "three_act",
		language: "en",
		grounding: { needed: false, questions: [] },
		degraded: false,
	};
	const slot = {
		index: 0,
		sectionId: "section-1",
		semanticBeatId: "beat-1",
		chapterFunction: "hook",
		obligation: "Introduce the seed",
		emotion: "curiosity" as const,
		wordBudget: 40,
	};
	const direction = {
		raw: "growth",
		story: "growth",
		visual: "ink sketch",
		voice: "calm",
		rules: "no text",
	};
	const values: Record<string, string> = {
		direction: directionRouterPrompt("ink sketch, calm narration, no text"),
		frameDefault: storyFramePrompt(brief, 60, 4, undefined),
		frameOptions: storyFramePrompt(brief, 65, 3, {
			planKind: "explainer",
			arc: "three_act",
			language: "id",
			locked,
		}),
		draftDefault: storyDraftPrompt(brief, frame, [slot], undefined),
		draftEvidence: storyDraftPrompt(
			brief,
			{
				...frame,
				planKind: "explainer",
				engagement: { hook: "A seed wakes up", visualMotif: "roots" },
			},
			[slot],
			{
				structure: "beat",
				locked,
				writerStyle: writerStyleProfiles()[0],
				research: {
					sources: [
						{
							title: "Seed biology",
							url: "https://example.org/seed",
							excerpt: "A seed absorbs water before germination.",
						},
					],
				},
			},
		),
		sequenceDefault: storySequenceDirectionPrompt([], {}),
		sequenceCorrection: storySequenceDirectionPrompt(
			[],
			{
				visual: "ink sketch",
				rules: "no text",
				templateConstraints: { maxVisualBeatSec: 6 },
			},
			"Change the repeated camera angle",
		),
		beatDefault: storyBeatVisualPrompt(
			{ title: "Seed", narration: "A seed wakes up." },
			[{ text: "A seed wakes up.", durationSec: 4 }],
			undefined,
		),
		beatOptions: storyBeatVisualPrompt(
			{ title: "Seed", narration: "A seed wakes up." },
			[{ text: "A seed wakes up.", durationSec: 4 }],
			{
				plannedShots: ["A seed on soil"],
				locked,
				visual: "ink sketch",
				rules: "no text",
				style: "fine ink",
				previousEndState: "seed resting",
				language: "en",
			},
		),
		clarificationDefault: storyClarificationPrompt({ request: brief, brief, referenceCount: 0 }),
		clarificationResolved: storyClarificationPrompt({
			request: brief,
			brief,
			referenceCount: 1,
			targetDurationSec: 60,
			aspect: "9:16",
			language: "en",
			voice: "calm",
			styleName: "Sketch",
			direction: "growth",
		}),
		evidenceDefault: evidenceDecisionPrompt({
			brief,
			request: brief,
			planKind: "story",
			sources: [],
			priorDecisions: [],
		}),
		evidenceSources: evidenceDecisionPrompt({
			brief,
			request: brief,
			planKind: "documentary",
			language: "en",
			sources: [
				{
					title: "Seed biology",
					url: "https://example.org/seed",
					excerpt: "A seed absorbs water before germination.",
				},
			],
			priorDecisions: [{ header: "Audience", question: "Who watches?", answer: "gardeners" }],
		}),
		locked: lockedConstraintBlock(locked),
		storyLayers: storyPromptLayers(brief, direction),
		voiceLayers: voicePromptLayers(brief, direction),
		visualLayers: visualPromptLayers("Seed opening", direction),
		writerStyle: writerStyleCraftBlock(writerStyleProfiles()[0]),
	};
	values["agent:video"] = instructionsFor("video");
	for (const visibilityMode of [
		"face",
		"hands_body",
		"reflection",
		"silhouette",
		"companion_view",
		"object",
		"environment",
	] as const)
		values[`reference:${visibilityMode}`] = canonicalReferencePrompt({
			role: "character",
			label: "Seed",
			description: "small brown seed",
			visibilityMode,
		});
	try {
		setTextRunnerForTests(async (prompt) => {
			values.style = prompt;
			return { stdout: "ink sketch", stderr: "" };
		});
		await generateStyleBible(brief, locked);
		setTextRunnerForTests(async (prompt) => {
			values.bible = prompt;
			return { stdout: "{}", stderr: "" };
		});
		// The seam captures the real request; deliberately invalid output never creates assets.
		await authorStoryBible(brief, {
			locked,
			summary: "ink sketch",
			boundLabels: ["Seed"],
			language: "en",
		}).catch(() => {});
	} finally {
		setTextRunnerForTests(null);
	}
	return values;
}
