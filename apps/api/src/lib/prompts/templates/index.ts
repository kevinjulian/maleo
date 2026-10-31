/* Every converted prompt template, grouped by the file that owns it. */
import type { PromptTemplate } from "@maleo/shared";
import { BIBLE_TEMPLATES } from "./bible.ts";
import { CLARIFICATION_TEMPLATES } from "./clarification.ts";
import { CONSTRAINT_TEMPLATES } from "./constraints.ts";
import { CONTEXT_TEMPLATES } from "./context.ts";
import { DIRECTION_TEMPLATES } from "./direction.ts";
import { EVIDENCE_TEMPLATES } from "./evidence.ts";
import { MATERIAL_TEMPLATES } from "./materials.ts";
import { MOTION_TEMPLATES } from "./motion.ts";
import { SEQUENCE_TEMPLATES } from "./sequence.ts";
import { STORY_TEMPLATES } from "./story.ts";
import { WRITER_TEMPLATES } from "./writer.ts";

export interface PromptTemplateModule {
	source: string;
	purpose: string;
	templates: readonly PromptTemplate[];
}

const at = (file: string) => `apps/api/src/lib/prompts/templates/${file}`;

export const PROMPT_TEMPLATE_MODULES: readonly PromptTemplateModule[] = [
	{ source: at("direction.ts"), purpose: "Story direction", templates: DIRECTION_TEMPLATES },
	{
		source: at("clarification.ts"),
		purpose: "Story clarification",
		templates: CLARIFICATION_TEMPLATES,
	},
	{ source: at("evidence.ts"), purpose: "Research clarification", templates: EVIDENCE_TEMPLATES },
	{
		source: at("constraints.ts"),
		purpose: "Repair and validation",
		templates: CONSTRAINT_TEMPLATES,
	},
	{ source: at("materials.ts"), purpose: "Material guidance", templates: MATERIAL_TEMPLATES },
	{ source: at("writer.ts"), purpose: "Writing style", templates: WRITER_TEMPLATES },
	{ source: at("story.ts"), purpose: "Research and planning", templates: STORY_TEMPLATES },
	{ source: at("sequence.ts"), purpose: "Story direction", templates: SEQUENCE_TEMPLATES },
	{ source: at("bible.ts"), purpose: "Visual authoring", templates: BIBLE_TEMPLATES },
	{ source: at("motion.ts"), purpose: "Motion design", templates: MOTION_TEMPLATES },
	{ source: at("context.ts"), purpose: "Agent context", templates: CONTEXT_TEMPLATES },
];

export const PROMPT_TEMPLATES: readonly PromptTemplate[] = PROMPT_TEMPLATE_MODULES.flatMap(
	(module) => module.templates,
);
