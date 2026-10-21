import type { PromptFragment } from "@maleo/shared";

// Fixed instruction fragments consumed by the production builders in create-character.ts.
export const PROMPT_FRAGMENTS = {
	createCharacterFragment0: {
		owner: "createCharacter",
		parts: ["Character portrait: ", ""],
		variables: [
			{
				name: "description || name",
				type: "string",
				required: true,
				source: "description || name",
				default: "name",
				condition: "Branch: styleLock.ok",
			},
		],
		condition: "Branch: styleLock.ok",
	},
	createCharacterFragment1: {
		owner: "createCharacter",
		parts: ["Character portrait: ", ""],
		variables: [
			{
				name: "description || name",
				type: "string",
				required: true,
				source: "description || name",
				default: "name",
				condition: "Branch: image; Branch: ctx.toolCallId",
			},
		],
		condition: "Branch: image; Branch: ctx.toolCallId",
	},
} as const satisfies Readonly<Record<string, PromptFragment>>;
