import type { PromptFragment } from "@maleo/shared";

// Fixed instruction fragments consumed by the production builders in cli.ts.
export const PROMPT_FRAGMENTS = {
	buildCodexImagePromptFragment0: {
		owner: "buildCodexImagePrompt",
		parts: ["", " ", ""],
		variables: [
			{
				name: "CODEX_IMAGE_SKILL",
				type: '"$imagegen"',
				required: true,
				source: "CODEX_IMAGE_SKILL",
			},
			{ name: "input.prompt", type: "string", required: true, source: "input.prompt" },
		],
	},
	buildCodexImagePromptFragment1: {
		owner: "buildCodexImagePrompt",
		parts: ["Aspect ratio: ", ""],
		variables: [
			{
				name: "input.aspect",
				type: "string",
				required: true,
				source: "input.aspect",
				condition: "Branch: input.aspect",
			},
		],
		condition: "Branch: input.aspect",
	},
	buildCodexImagePromptFragment2: {
		owner: "buildCodexImagePrompt",
		parts: [
			"Use the ",
			" attached image(s) as visual references for subject, style, and identity.",
		],
		variables: [
			{
				name: "input.references.length",
				type: "number",
				required: true,
				source: "input.references.length",
				condition: "Branch: input.references.length > 0",
			},
		],
		condition: "Branch: input.references.length > 0",
	},
	buildCodexImagePromptFragment3: {
		owner: "buildCodexImagePrompt",
		parts: ["Requirements:"],
		variables: [],
	},
	buildCodexImagePromptFragment4: {
		owner: "buildCodexImagePrompt",
		parts: ["- Follow the request exactly, including any negative constraints such as 'no text'."],
		variables: [],
	},
	buildCodexImagePromptFragment5: {
		owner: "buildCodexImagePrompt",
		parts: ["- Do not add requirements the request did not ask for."],
		variables: [],
	},
	buildCodexImagePromptFragment6: {
		owner: "buildCodexImagePrompt",
		parts: ["- Save the generated image file into the current working directory."],
		variables: [],
	},
	buildCodexImagePromptFragment7: {
		owner: "buildCodexImagePrompt",
		parts: ["- Reply with ONLY the absolute path of the saved image file, and nothing else."],
		variables: [],
	},
	buildCodexImagePromptFragment8: { owner: "buildCodexImagePrompt", parts: ["\n"], variables: [] },
} as const satisfies Readonly<Record<string, PromptFragment>>;
