/* The workspace writer style as narration craft for the drafting prompt. */
import type { PromptTemplate } from "@maleo/shared";

const line = "\n";

export const WRITER_TEMPLATES: readonly PromptTemplate[] = [
	{
		id: "prompt:writer:writerStyleCraftBlock",
		description: "How narration is written: person, tense, rhythm, figuration and forbidden moves.",
		body: [
			{
				type: "when",
				if: { exists: "profile" },
				then: [
					"Narration craft — write EVERY section's narration this way:",
					line,
					"- Person: ",
					{ type: "format", name: "underscoresAsSpaces", in: { value: "profile.person" } },
					". Tense: ",
					{ type: "slot", path: "profile.tense" },
					".",
					line,
					"- Rhythm: ",
					{ type: "slot", path: "profile.sentenceRhythm" },
					"",
					line,
					"- Concreteness: ",
					{ type: "slot", path: "profile.concreteness" },
					"",
					line,
					"- Figuration: ",
					{ type: "slot", path: "profile.figuration" },
					".",
					line,
					"- ",
					{
						type: "when",
						if: { eq: ["profile.addressesViewer", true] },
						then: ["Address the viewer directly."],
						else: ["Do not address the viewer."],
					},
					"",
					line,
					"- Open the first section like this: ",
					{ type: "slot", path: "profile.openingMove" },
					"",
					line,
					"- Never do: ",
					{ type: "slot", path: "profile.forbiddenMoves", filters: [{ join: ", " }] },
					".",
					line,
					"- Never write the words: ",
					{ type: "slot", path: "profile.forbiddenPhrases", filters: [{ join: ", " }] },
					".",
					line,
					"This governs narration only. Keep every visualPrompt in English and unchanged by it.",
				],
			},
		],
	},
];
