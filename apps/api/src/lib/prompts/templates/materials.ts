/* Routed material layers. The ORDER of each layer list is the contract: Story
 * planning takes subject, Story, then Rules; narration takes the story brief, Voice
 * as delivery, then Rules. Rules come last so they read as overriding. */
import { joinPresent, type Expression, type PromptTemplate } from "@maleo/shared";

const present = (path: string): Expression => ({ not: { empty: path } });
const rules = {
	when: present("direction.rules"),
	nodes: [
		{
			type: "include" as const,
			prompt: "prompt:materials:RULES_PREFIX",
			in: { rules: "direction.rules" },
		},
	],
};

export const MATERIAL_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:materials:RULES_PREFIX",
		description: "Rules material, labelled so a model reads it as constraint rather than taste.",
		body: [
			"Hard constraints (must be obeyed):",
			"\n",
			{ type: "slot", path: "rules", filters: ["trim"] },
		],
	},
	{
		id: "prompt:materials:storyPromptLayers",
		description:
			"Story planning and research input: subject, Story material, Rules. Never Visual or Voice.",
		body: joinPresent("\n\n", [
			{ when: present("subject"), nodes: [{ type: "slot", path: "subject", filters: ["trim"] }] },
			{
				when: present("direction.story"),
				nodes: [{ type: "slot", path: "direction.story", filters: ["trim"] }],
			},
			rules,
		]),
	},
	{
		id: "prompt:materials:voicePromptLayers",
		description:
			"Narration scripting input: the story brief, Voice material as delivery guidance, Rules.",
		body: joinPresent("\n\n", [
			{
				when: present("storyBrief"),
				nodes: [{ type: "slot", path: "storyBrief", filters: ["trim"] }],
			},
			{
				when: present("direction.voice"),
				nodes: [
					"Narration delivery: ",
					{ type: "slot", path: "direction.voice", filters: ["trim"] },
					"",
				],
			},
			rules,
		]),
	},
];
