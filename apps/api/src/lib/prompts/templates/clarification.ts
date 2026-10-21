/* The pre-research story clarification request and its resolved-context block. */
import { truthy, type PromptTemplate } from "@maleo/shared";

/** One resolved line: the value when the context has it, else what is unstated. */
const resolved = (
	path: string,
	label: string,
	resolvedText: string,
	missing: string,
	filters?: ["round"],
) => ({
	type: "when" as const,
	if: truthy(path),
	then: [label, { type: "slot" as const, path, ...(filters ? { filters } : {}) }, resolvedText],
	else: [missing],
});

export const CLARIFICATION_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:clarification:resolvedBlock",
		description: "What the run already decided, so the clarification request never asks for it.",
		body: [
			resolved("targetDurationSec", "- Duration: ", "s (RESOLVED)", "- Duration: not stated", [
				"round",
			]),
			"\n",
			resolved("aspect", "- Aspect ratio: ", " (RESOLVED)", "- Aspect ratio: not stated"),
			"\n",
			resolved(
				"language",
				"- Narration language: ",
				" (RESOLVED)",
				"- Narration language: not stated",
			),
			"\n",
			resolved("voice", "- Voice: ", " (RESOLVED)", "- Voice: not stated"),
			"\n",
			{
				type: "when",
				if: truthy("styleName"),
				then: ["- Visual style / preset: ", { type: "slot", path: "styleName" }, " (RESOLVED)"],
				else: [
					{
						type: "when",
						if: truthy("style"),
						then: ["- Visual style / preset: ", { type: "slot", path: "style" }, " (RESOLVED)"],
						else: ["- Visual style: not stated"],
					},
				],
			},
			"\n",
			resolved(
				"referenceCount",
				"- Attached visual references: ",
				" (RESOLVED)",
				"- Attached visual references: none",
			),
			{
				type: "when",
				if: truthy("direction"),
				then: ["\n", "- Operator direction: ", { type: "slot", path: "direction" }, ""],
			},
		],
	},
	{
		id: "prompt:clarification:storyClarificationPrompt",
		description: "Ask the few story decisions nobody has answered, before framing or research.",
		body: [
			"You are planning ONE video story for the Maleo create flow. Before any framing or research happens, ask the user the few decisions that will most change the story and that nobody has answered yet.\n\nUser request: ",
			{ type: "slot", path: "request" },
			"\nSaved brief: ",
			{ type: "slot", path: "brief", filters: ["trim", { default: "(none)" }] },
			"\n\nAlready resolved — NEVER ask about anything marked RESOLVED:\n",
			{ type: "include", prompt: "prompt:clarification:resolvedBlock" },
			"\n\nRules:\n- Ask ",
			"1",
			"-",
			{ type: "const", name: "MAX_STORY_CLARIFICATION_QUESTIONS" },
			" questions. Fewer is better. If the request already answers everything material, ask exactly one question about the single biggest remaining gap.\n- Ask about DECISIONS that shape one story: audience, the change you want in the viewer, the concrete example or context to build on, the emotional register, the level of prior knowledge assumed.\n- NEVER propose alternate premises, hooks, arcs, story directions, or competing story plans. You are not offering stories to pick from.\n- NEVER ask for a value marked RESOLVED above, and never ask the user to repeat something their request already states.\n- Each question gets ",
			{ type: "const", name: "MIN_STORY_CLARIFICATION_OPTIONS" },
			"-",
			{ type: "const", name: "MAX_STORY_CLARIFICATION_OPTIONS" },
			' mutually exclusive options. Exactly ONE option is "recommended": true.\n- Every option needs a one-sentence "description" saying how it changes the resulting video. No filler.\n- "header" is two or three words naming the decision (e.g. "Audience", "Viewer outcome").\n- ids are short, stable, lowercase-kebab.\n- "field" is OPTIONAL and almost always absent. Set it ONLY when the question decides a value the finished plan itself records, and then every option\'s "value" must be exactly that value: ',
			'"',
			{ type: "const", name: "STORY_CLARIFICATION_FIELDS", filters: [{ join: '" or "' }] },
			'"',
			'. For "language" the values are BCP-47 tags ("en", "id"); for "plan_kind" they are ',
			'"',
			{ type: "const", name: "VIDEO_PLAN_KINDS", filters: [{ join: '", "' }] },
			'"',
			'. An editorial question — audience, tone, example — has NO field.\n\nRespond with ONLY this JSON object:\n{"id":"<short batch id>","stage":"',
			{ type: "const", name: "STORY_CLARIFICATION_STAGE" },
			'","purpose":"',
			{ type: "const", name: "STORY_CLARIFICATION_PURPOSE" },
			'","intro":"<one short sentence>","questions":[{"id":"audience","header":"Audience","question":"...","options":[{"id":"...","label":"...","value":"...","description":"...","recommended":true},{"id":"...","label":"...","value":"...","description":"..."}]},{"id":"kind","header":"Video kind","question":"...","field":"plan_kind","options":[{"id":"...","label":"...","value":"explainer","description":"...","recommended":true},{"id":"...","label":"...","value":"documentary","description":"..."}]}]}\nNo markdown. No prose. Omit "field" entirely unless the rule above applies.',
		],
		response: {
			parser: "json.fenced",
			schema: "storyClarificationBatch",
			policy: "clarification.askNothing",
		},
	},
];
