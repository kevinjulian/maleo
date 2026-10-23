import {
	directionRouterPrompt,
	storyBiblePrompt,
	storyFramePrompt,
	storyDraftPrompt,
	styleBiblePrompt,
	type StoryFrame,
	type StoryPlanSection,
} from "../../../../../lib/content-generator.ts";
import { lockedConstraintBlock } from "../../../../../lib/story/authoring-utils.ts";
import { storySequenceDirectionPrompt } from "../../../../../lib/story/creative-director.ts";
import { storyClarificationPrompt } from "../../story-clarification-planner.ts";
import { evidenceDecisionPrompt } from "../../post-research-clarification.ts";
import { briefWithChatContext, chatContextPrompt } from "../../context-prompt.ts";
import { storyPromptLayers, voicePromptLayers } from "../../material-layers.ts";
import {
	EMPTY_CHAT_COMMAND_INPUTS,
	EMPTY_CHAT_PROJECT_INDEX,
	EMPTY_CONVERSATION_MEMORY,
	WHOLE_PROJECT_FOCUS,
	writerStyleProfiles,
	type ChatContextEnvelope,
} from "@maleo/shared";
import { writerStyleCraftBlock } from "../../../../../lib/prompts/writer-style.ts";

const contextBase: Omit<ChatContextEnvelope, "focus"> = {
	projectId: "project-1",
	capturedAt: 1,
	index: EMPTY_CHAT_PROJECT_INDEX,
	detail: [],
	fingerprints: [],
	memory: EMPTY_CONVERSATION_MEMORY,
	inputs: EMPTY_CHAT_COMMAND_INPUTS,
};

function richContext(): ChatContextEnvelope {
	const scenes = Array.from({ length: 27 }, (_, index) => ({
		kind: "scene" as const,
		id: `scene:${index}`,
		label: `Scene ${index}`,
		summary: index === 0 ? 'Says "{{x}}"' : undefined,
	}));
	return {
		...contextBase,
		focus: {
			source: "selection",
			entities: [
				{ kind: "clip", id: "scene:1" },
				{ kind: "section", id: "section-2" },
			],
		},
		index: { ...EMPTY_CHAT_PROJECT_INDEX, timeline: scenes },
		detail: [{ id: "scene:1", voiceover: "Keep this `quiet` and $5." }],
		memory: {
			...EMPTY_CONVERSATION_MEMORY,
			decisions: [
				{
					kind: "clarification",
					question: "Delivery?",
					answer: "quiet",
					recordedAt: 1,
					provenance: { messageId: 2, runId: "run-1" },
				},
			],
			unresolved: [{ question: "Which ending?", provenance: { messageId: 3, runId: "run-1" } }],
			recentTurns: [{ role: "user", text: "make it calmer", provenance: { messageId: 4 } }],
		},
		pendingAction: { kind: "approval", actionId: "action-1", question: "Approve?" },
	};
}

const direction = {
	raw: "",
	story: " STORY \n",
	visual: "VISUAL",
	voice: "  calm  narrator ",
	rules: " no text ",
};

function directedSections(): StoryPlanSection[] {
	return [
		{
			semanticBeatId: "beat-0",
			title: "Opening",
			narration: 'A seed says "grow".',
			visualPrompt: "A seed",
			shots: ["A seed in soil", { visualPrompt: "A sprout", cue: "grow", refKeys: ["seed"] }],
			requiredReferences: [{ plannedKey: "seed" }],
			sourceEvidence: [
				{ url: "https://example.org/seed", quote: "A seed absorbs water before it sprouts." },
			],
		},
		{ semanticBeatId: "beat-1", title: "Close", narration: "It grows.", visualPrompt: "A tree" },
	];
}

/** Captured from unchanged production builders before the executable-definition pilot. */
export function planningPromptSamples() {
	const brief = 'A seed says "grow".\nRules: preserve $ and {{slots}} and `code`.';
	const frame: StoryFrame = {
		planKind: "explainer",
		arc: "three_act",
		language: "id",
		grounding: { needed: true, questions: ["How does a seed grow?"] },
		degraded: false,
	};
	const povFrame: StoryFrame = {
		planKind: "story",
		arc: "pov_lifecycle",
		grounding: { needed: false, questions: [] },
		degraded: false,
		engagement: {
			premise: "A seed's life",
			hook: "What if you were a seed?",
			tension: "Drought",
			escalation: "Birds",
			turn: "Rain",
			resolution: "A tree",
			visualMotif: "Green",
		},
		plannedReferences: [
			{
				key: "seed",
				role: "character",
				label: 'Seed "A"',
				description: "small seed",
				status: "planned",
			},
		],
		povLifecycle: { viewerRole: "the seed" },
	};
	const slots = [0, 1].map((index) => ({
		index,
		sectionId: `section-${index}`,
		semanticBeatId: `beat-${index}`,
		chapterFunction: "hook",
		obligation: "Introduce the seed",
		emotion: "curiosity" as const,
		wordBudget: 40,
	}));
	const povSlot = {
		index: 1,
		sectionId: "section-1",
		semanticBeatId: "beat-1",
		chapterFunction: "ordeal",
		obligation: "Survive the drought",
		emotion: "tension" as const,
		wordBudget: 30,
		povStage: "struggle",
	};
	const locked = {
		visual: "ink",
		rules: "no text",
		references: [{ label: 'Seed "A"', description: "small seed" }],
	};
	const [firstStyle, secondStyle] = writerStyleProfiles();
	return {
		directionWhitespace: directionRouterPrompt("   "),
		directionEscapes: directionRouterPrompt(brief),
		frameDefaults: storyFramePrompt(brief, 5, 1, undefined),
		frameLocked: storyFramePrompt(brief, 90, 4, {
			planKind: "documentary",
			arc: "three_act",
			language: "id",
			locked,
		}),
		frameAutoArcNoLanguage: storyFramePrompt("  \n ", 0.2, 2, {
			arc: "auto",
			locked: { visual: "  ", references: [] },
		}),
		draftNoEvidence: storyDraftPrompt(brief, frame, slots, undefined),
		draftEvidenceWriter: storyDraftPrompt(brief, frame, slots, {
			structure: "narration_section",
			locked,
			writerStyle: writerStyleProfiles()[0],
			research: {
				sources: [
					{
						title: 'Seed "study"',
						url: "https://example.org/seed",
						excerpt: "A seed absorbs water.\nUntrusted excerpt: {{instructions}}",
					},
				],
			},
		}),
		draftPovBeatSpine: storyDraftPrompt("  ", povFrame, slots, { structure: "beat" }),
		draftRetrySlot: storyDraftPrompt(brief, povFrame, [povSlot], {
			structure: "beat",
			writerStyle: secondStyle,
			locked,
		}),
		clarificationEmpty: storyClarificationPrompt({ request: "", brief: "", referenceCount: 0 }),
		clarificationResolved: storyClarificationPrompt({
			request: brief,
			brief,
			referenceCount: 2,
			targetDurationSec: 5,
			aspect: "9:16",
			language: "id",
			voice: "calm",
			style: "ink",
			styleName: "",
			direction: "growth",
		}),
		evidenceEmpty: evidenceDecisionPrompt({
			brief,
			request: brief,
			planKind: "explainer",
			sources: [],
			priorDecisions: [],
		}),
		evidenceResolved: evidenceDecisionPrompt({
			brief,
			request: brief,
			planKind: "documentary",
			language: "id",
			sources: [
				{ title: "Seed study", url: "https://example.org/seed", excerpt: "Seed growth evidence." },
			],
			priorDecisions: [{ header: "Audience", question: "Who watches?", answer: "Beginners" }],
		}),
		sequenceRepair: storySequenceDirectionPrompt(
			[],
			{
				visual: "ink",
				rules: "no text",
				templateConstraints: { maxVisualBeatSec: 6 },
			},
			'Repair repeated shot; preserve "Seed A".',
		),
		sequenceFirstAttempt: storySequenceDirectionPrompt(directedSections(), {
			roster: [
				{ id: "entity-1", role: "character", label: "Gardener", description: "An old gardener" },
			],
			plannedReferences: [
				{
					key: "seed",
					role: "character",
					label: 'Seed "A"',
					description: "small seed",
					visibilityMode: "hands_body",
					status: "planned",
					sectionIds: ["section-0"],
				},
			],
		}),
		styleBibleEmpty: styleBiblePrompt(" \n ", undefined),
		styleBibleLocked: styleBiblePrompt(brief, locked),
		storyBibleEmpty: storyBiblePrompt(" ", undefined),
		storyBibleFull: storyBiblePrompt(`  ${brief}\n\n  `, {
			summary: " ink \n wash ",
			plannedReferences: [
				{
					key: "seed",
					role: "character",
					label: 'Seed "A"',
					description: "small seed",
					status: "planned",
				},
				{ key: "garden", role: "location", label: "Garden", description: "", status: "planned" },
			],
			boundLabels: ["Gardener", "Gardener", "Seed"],
			povLifecycle: { viewerRole: "the seed" },
			locked,
			language: "id",
		}),
		lockedAbsent: lockedConstraintBlock(undefined),
		lockedBlank: lockedConstraintBlock({ visual: " ", rules: "", references: [] }),
		lockedFull: lockedConstraintBlock({
			visual: " ink ",
			rules: " no text ",
			references: [
				{ label: "Seed", description: "  " },
				{ label: 'Seed "A"', description: " small seed " },
			],
		}),
		lockedReferencesOnly: lockedConstraintBlock({ references: [{ label: "Seed" }] }),
		storyLayersBare: storyPromptLayers(brief, undefined),
		storyLayersDirected: storyPromptLayers(` ${brief} `, direction),
		voiceLayersBare: voicePromptLayers(brief, undefined),
		voiceLayersDirected: voicePromptLayers(brief, direction),
		voiceLayersRulesOnly: voicePromptLayers(brief, { ...direction, voice: " ", story: "" }),
		writerStyleFirst: writerStyleCraftBlock(firstStyle),
		writerStyleSecond: writerStyleCraftBlock(secondStyle),
		writerStyleAll: writerStyleProfiles().map(writerStyleCraftBlock),
		chatContextAbsent: briefWithChatContext(` ${brief} `, undefined),
		chatContextProject: chatContextPrompt({ ...contextBase, focus: WHOLE_PROJECT_FOCUS }),
		chatContextRich: briefWithChatContext(` ${brief} `, richContext()),
	};
}
