import type { PromptFragment } from "@maleo/shared";
import {
	IMAGE_PROMPT_FRAGMENTS,
	CODEX_IMAGE_PROMPT_FRAGMENTS,
	IMAGE_PROMPT_BLOCK_ORDER,
	CODEX_IMAGE_SKILL,
} from "@maleo/media/prompt-definitions";
import { PROMPT_FRAGMENTS as beats } from "../../../lib/story/image-director-prompt-definitions.ts";
import { VISUAL_LAYER_ORDER } from "./material-layers.ts";
import { PROMPT_FRAGMENTS as references } from "./generated-reference-prompt-definitions.ts";
import { PROMPT_FRAGMENTS as instructions } from "./runtime/instructions-prompt-definitions.ts";
import { PROMPT_FRAGMENTS as character } from "./tools/visual/create-character-prompt-definitions.ts";

interface PromptModule {
	purpose: string;
	purposes?: Readonly<Record<string, string>>;
	labels?: Readonly<Record<string, string>>;
	summaries?: Readonly<Record<string, string>>;
	id: string;
	source: string;
	fragments: Readonly<Record<string, PromptFragment>>;
	staticValues?: Readonly<Record<string, string | number>>;
	composition?: Readonly<Record<string, readonly string[]>>;
}

/* Prompts still assembled from source-extracted fragments. Planning prompts are
 * templates (lib/prompts/templates) and are projected from there instead. */
export const PROMPT_MODULES: readonly PromptModule[] = [
	{
		id: "beats",
		purpose: "Visual authoring",
		source: "apps/api/src/lib/story/image-director.ts",
		fragments: beats,
	},
	{
		id: "materials",
		purpose: "Material guidance",
		purposes: { visualPromptLayers: "Visual authoring" },
		labels: { visualPromptLayers: "Assemble visual guidance" },
		source: "apps/api/src/modules/agents/core/material-layers.ts",
		fragments: {},
		composition: { visualPromptLayers: VISUAL_LAYER_ORDER },
	},
	{
		id: "references",
		purpose: "Visual references",
		source: "apps/api/src/modules/agents/core/generated-reference.ts",
		fragments: references,
	},
	{
		id: "instructions",
		purpose: "Agent behavior",
		labels: {
			COMMON: "Shared agent instructions",
			IMAGE: "Image agent instructions",
			TEXT: "Text agent instructions",
			VIDEO: "Video agent instructions",
		},
		source: "apps/api/src/modules/agents/core/runtime/instructions.ts",
		fragments: instructions,
		staticValues: { COMMON: instructions.COMMONFragment0.parts[0] },
	},
	{
		id: "character",
		purpose: "Character authoring",
		source: "apps/api/src/modules/agents/core/tools/visual/create-character.ts",
		fragments: character,
	},
	{
		id: "image",
		purpose: "Image compilation",
		labels: {
			BASE_NEGATIVE: "Image exclusions",
			sentence: "Format guidance sentence",
			subjectLine: "Describe subject",
			referenceUseText: "Describe reference usage",
			referenceMap: "Bind reference roles",
			referenceBrief: "Describe visual references",
			compileImagePrompt: "Compile image guidance",
		},
		source: "packages/media/src/generation/image-prompt.ts",
		fragments: IMAGE_PROMPT_FRAGMENTS,
		composition: { compileImagePrompt: IMAGE_PROMPT_BLOCK_ORDER },
	},
	{
		id: "codexImage",
		purpose: "Provider guidance",
		source: "packages/media/src/providers/codex/cli.ts",
		fragments: CODEX_IMAGE_PROMPT_FRAGMENTS,
		staticValues: { CODEX_IMAGE_SKILL },
	},
];

export function promptIdsFor(...modules: string[]): string[] {
	return PROMPT_MODULES.filter((module) => modules.includes(module.id)).flatMap((module) =>
		[
			...new Set([
				...Object.values(module.fragments).map((fragment) => fragment.owner),
				...Object.keys(module.composition ?? {}),
			]),
		].map((name) => `prompt:${module.id}:${name}`),
	);
}
