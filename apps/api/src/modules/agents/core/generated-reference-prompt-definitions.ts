import type { PromptFragment } from "@maleo/shared";

// Fixed instruction fragments consumed by the production builders in generated-reference.ts.
export const PROMPT_FRAGMENTS = {
	canonicalReferencePromptFragment0: {
		owner: "canonicalReferencePrompt",
		parts: ["", ' reference for "', '": ', ""],
		variables: [
			{
				name: "input.role",
				type: '"character" | "location" | "product" | "prop"',
				required: true,
				source: "input.role",
			},
			{ name: "input.label", type: "string", required: true, source: "input.label" },
			{ name: "input.description", type: "string", required: true, source: "input.description" },
		],
	},
	canonicalReferencePromptFragment1: {
		owner: "canonicalReferencePrompt",
		parts: ["hands_body"],
		variables: [],
		condition: 'Case: "hands_body"',
	},
	canonicalReferencePromptFragment2: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical first-person reference focused on visible hands, forearms, clothing, and held tools; do not make a front-facing portrait.",
		],
		variables: [
			{
				name: "base",
				type: "string",
				required: true,
				source: "base",
				condition: 'Case: "hands_body"',
			},
		],
		condition: 'Case: "hands_body"',
	},
	canonicalReferencePromptFragment3: {
		owner: "canonicalReferencePrompt",
		parts: ["reflection"],
		variables: [],
		condition: 'Case: "reflection"',
	},
	canonicalReferencePromptFragment4: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical reference seen through a natural reflection; face visibility is allowed only as reflected POV context.",
		],
		variables: [
			{
				name: "base",
				type: "string",
				required: true,
				source: "base",
				condition: 'Case: "reflection"',
			},
		],
		condition: 'Case: "reflection"',
	},
	canonicalReferencePromptFragment5: {
		owner: "canonicalReferencePrompt",
		parts: ["silhouette"],
		variables: [],
		condition: 'Case: "silhouette"',
	},
	canonicalReferencePromptFragment6: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical reference focused on recognizable body silhouette, clothing, and posture rather than facial detail.",
		],
		variables: [
			{
				name: "base",
				type: "string",
				required: true,
				source: "base",
				condition: 'Case: "silhouette"',
			},
		],
		condition: 'Case: "silhouette"',
	},
	canonicalReferencePromptFragment7: {
		owner: "canonicalReferencePrompt",
		parts: ["companion_view"],
		variables: [],
		condition: 'Case: "companion_view"',
	},
	canonicalReferencePromptFragment8: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical reference as another character would see them in-scene, preserving body traits and clothing.",
		],
		variables: [
			{
				name: "base",
				type: "string",
				required: true,
				source: "base",
				condition: 'Case: "companion_view"',
			},
		],
		condition: 'Case: "companion_view"',
	},
	canonicalReferencePromptFragment9: {
		owner: "canonicalReferencePrompt",
		parts: ["object"],
		variables: [],
		condition: 'Case: "object"',
	},
	canonicalReferencePromptFragment10: {
		owner: "canonicalReferencePrompt",
		parts: ["", ". Create a clean canonical object/prop reference with no extra subjects."],
		variables: [
			{ name: "base", type: "string", required: true, source: "base", condition: 'Case: "object"' },
		],
		condition: 'Case: "object"',
	},
	canonicalReferencePromptFragment11: {
		owner: "canonicalReferencePrompt",
		parts: ["environment"],
		variables: [],
		condition: 'Case: "environment"',
	},
	canonicalReferencePromptFragment12: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical location reference with stable layout, materials, and lighting, no extra primary characters.",
		],
		variables: [
			{
				name: "base",
				type: "string",
				required: true,
				source: "base",
				condition: 'Case: "environment"',
			},
		],
		condition: 'Case: "environment"',
	},
	canonicalReferencePromptFragment13: {
		owner: "canonicalReferencePrompt",
		parts: ["face"],
		variables: [],
		condition: 'Case: "face"',
	},
	canonicalReferencePromptFragment14: {
		owner: "canonicalReferencePrompt",
		parts: [
			"",
			". Create a canonical character portrait/reference image preserving the visible identity.",
		],
		variables: [{ name: "base", type: "string", required: true, source: "base" }],
	},
} as const satisfies Readonly<Record<string, PromptFragment>>;
