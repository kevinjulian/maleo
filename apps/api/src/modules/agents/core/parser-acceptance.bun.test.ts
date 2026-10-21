/* Parser acceptance baseline: what each planning reply parser accepts, repairs,
 * retries or degrades, captured from the code before prompts became templates.
 * Every parser sees the same reply kinds: valid, invalid, fenced, plain prose,
 * empty and truncated. Re-capture with MALEO_CAPTURE_PARSER_BASELINE=1. */
import { afterAll, expect, test } from "bun:test";
import {
	authorStoryBible,
	generateStyleBible,
	planStoryFrame,
	planStoryFromFrame,
	routeDirection,
	type StoryFrame,
} from "../../../lib/content-generator.ts";
import { directStorySequence } from "../../../lib/story/creative-director.ts";
import { setTextRunnerForTests } from "../../../lib/text-runner.ts";
import { analyzeEvidenceDecisions } from "./post-research-clarification.ts";
import { generateStoryClarification } from "./story-clarification-planner.ts";
import { POST_RESEARCH_BATCH } from "./runtime/__tests__/support/planning-fixture.ts";

const FIXTURE = new URL("./__tests__/support/parser-acceptance.json", import.meta.url);

const sections = [
	{
		id: "section-1",
		semanticBeatId: "beat-1",
		title: "One",
		narration: "First fact.",
		visualPrompt: "First image",
	},
	{
		id: "section-2",
		semanticBeatId: "beat-2",
		title: "Two",
		narration: "Second fact.",
		visualPrompt: "Second image",
	},
];
const frame: StoryFrame = {
	planKind: "story",
	arc: "three_act",
	language: "en",
	grounding: { needed: false, questions: [] },
	degraded: false,
};
const preBatch = {
	id: "pre-1",
	stage: "pre_research",
	purpose: "story_brief",
	questions: [
		{
			id: "audience",
			header: "Audience",
			question: "Who watches?",
			options: [
				{
					id: "new",
					label: "Beginners",
					value: "Explain for beginners",
					description: "Introduce the subject.",
					recommended: true,
				},
				{
					id: "expert",
					label: "Experts",
					value: "Explain for experts",
					description: "Assume prior knowledge.",
				},
			],
		},
	],
};
const evidenceSources = [
	{ title: "Ohio pension study", url: "https://example.test/ohio", excerpt: "7.1% over 30 years." },
	{
		title: "Vermont pension study",
		url: "https://example.test/vermont",
		excerpt: "4.4% over 30 years.",
	},
];

/** One valid reply per parser; the other kinds derive from it. */
const VALID: Record<string, string> = {
	frame: JSON.stringify({
		planKind: "explainer",
		arc: "three_act",
		language: "en",
		grounding: { needed: true, questions: ["What returns are typical?"] },
	}),
	draft: JSON.stringify({
		sections: [
			{ slot: 0, title: "Opening", narration: "Seeds wait.", visualPrompt: "A seed" },
			{ slot: 1, title: "Growth", narration: "Then they grow.", visualPrompt: "A sprout" },
		],
	}),
	clarification: JSON.stringify(preBatch),
	evidence: JSON.stringify(POST_RESEARCH_BATCH),
	direction: JSON.stringify({
		story: "a seed story",
		visual: "ink",
		voice: "calm",
		rules: "no text",
	}),
	style: "ink wash,\n muted greens,  soft light",
	bible: JSON.stringify({
		subjects: [{ id: "seed", label: "Seed" }],
		locations: [{ id: "garden", label: "Garden" }],
		palette: "green",
	}),
	sequence: JSON.stringify({
		beats: sections.map((section, index) => ({
			beatId: section.semanticBeatId,
			editorial: {
				purpose: index ? "reveal" : "establish",
				presentation: "narrative",
				visualConcept: `Concept ${index}`,
				noveltyKey: `novel-${index}`,
				sfxCue: null,
			},
		})),
	}),
};

function replies(valid: string) {
	return {
		valid,
		invalid: JSON.stringify({
			unexpected: true,
			sections: "no",
			beats: 3,
			questions: "none",
			subjects: "x",
		}),
		fenced: `Here you go:\n\`\`\`json\n${valid}\n\`\`\`\n`,
		plain: "I would rather describe this in prose.",
		empty: "",
		truncated: valid.slice(0, Math.floor(valid.length / 2)),
	};
}

/** Each parser's public entry, driven through the text runner seam. */
const PARSERS: Record<string, () => Promise<unknown>> = {
	frame: () => planStoryFrame("seeds", 30, 2, { language: "en" }),
	draft: () =>
		planStoryFromFrame(
			"seeds",
			30,
			frame,
			{ sectionCount: 2, wordBudget: 60 },
			{ structure: "beat" },
		),
	clarification: () =>
		generateStoryClarification({ request: "make a video", brief: "seeds", referenceCount: 0 }),
	evidence: () =>
		analyzeEvidenceDecisions({
			brief: "pensions",
			request: "pensions",
			planKind: "explainer",
			sources: evidenceSources,
			priorDecisions: [],
		}),
	direction: () => routeDirection("ink, calm, no text"),
	style: () => generateStyleBible("seeds"),
	bible: () => authorStoryBible("seeds", { summary: "ink" }),
	sequence: () => directStorySequence(sections),
};

const DRAFT_PROMPT = "STRUCTURE IS ALREADY FIXED";

async function outcome(
	parser: string,
	reply: string,
): Promise<{ calls: number; value?: unknown; error?: string }> {
	let calls = 0;
	setTextRunnerForTests(async (prompt) => {
		calls += 1;
		// The draft stage directs the sequence afterwards; only the draft sees the scripted reply.
		const stdout = parser === "draft" && !prompt.includes(DRAFT_PROMPT) ? "{}" : reply;
		return { stdout, stderr: "" };
	});
	try {
		const value = await PARSERS[parser]!();
		return { calls, value };
	} catch (error) {
		return { calls, error: error instanceof Error ? error.message : String(error) };
	}
}

/** Generated ids are random per run; the baseline compares everything else. */
function normalized(value: unknown): unknown {
	return JSON.parse(
		JSON.stringify(value).replace(
			/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
			"<uuid>",
		),
	);
}

afterAll(() => setTextRunnerForTests(null));

test("parsers accept, repair and degrade replies exactly as before conversion", async () => {
	const observed: Record<string, Record<string, unknown>> = {};
	for (const parser of Object.keys(PARSERS)) {
		const kinds: Record<string, unknown> = {};
		for (const [kind, reply] of Object.entries(replies(VALID[parser]!)))
			kinds[kind] = normalized(await outcome(parser, reply));
		observed[parser] = kinds;
	}
	if (process.env.MALEO_CAPTURE_PARSER_BASELINE === "1")
		await Bun.write(FIXTURE, `${JSON.stringify(observed, null, "\t")}\n`);
	expect(observed).toEqual(await Bun.file(FIXTURE).json());
});
