/* The prompt template registry: every converted prompt, validated once at load.
 *
 * Templates are data (templates/*.ts); constants and formatters are the code they
 * may name (constants.ts, formatters.ts). A template that references an unknown
 * template, constant, filter or formatter, or includes itself, fails here — before
 * any run starts — rather than when a request happens to reach it. */
import {
	renderTemplate,
	validateTemplates,
	type PromptTemplate,
	type ResponseContract,
	type TemplateFormatter,
	type TemplateRuntime,
} from "@maleo/shared";
import { PROMPT_CONSTANTS } from "./constants.ts";
import { PROMPT_FORMATTERS } from "./formatters.ts";
import { responseErrors } from "./responses.ts";
import { PROMPT_TEMPLATES } from "./templates/index.ts";

/** A rendered prompt that still knows which template produced it. */
export interface RenderedPrompt {
	readonly id: string;
	readonly text: string;
	/** Present when the template is a model request; a fragment has none. */
	readonly response?: ResponseContract;
}

export interface TemplateRegistry {
	get(id: string): PromptTemplate | undefined;
	list(): readonly PromptTemplate[];
	render(id: string, input: unknown): RenderedPrompt;
}

export class TemplateLoadError extends Error {}

export function createTemplateRegistry(
	templates: readonly PromptTemplate[],
	constants: ReadonlyMap<string, unknown> = PROMPT_CONSTANTS,
	formatters: ReadonlyMap<string, TemplateFormatter> = PROMPT_FORMATTERS,
): TemplateRegistry {
	const errors = [
		...validateTemplates(templates, {
			constants: new Set(constants.keys()),
			formatters: new Set(formatters.keys()),
		}),
		...responseErrors(templates),
	];
	if (errors.length)
		throw new TemplateLoadError(`Prompt templates failed to load:\n${errors.join("\n")}`);
	const byId = new Map(templates.map((template) => [template.id, template]));
	const runtime: TemplateRuntime = {
		template: (id) => byId.get(id),
		constant: (name) => constants.get(name),
		formatter: (name) => formatters.get(name),
	};
	return {
		get: (id) => byId.get(id),
		list: () => templates,
		render: (id, input) => {
			const response = byId.get(id)?.response;
			return { id, text: renderTemplate(id, input, runtime), ...(response ? { response } : {}) };
		},
	};
}

/** The production registry. Built at module load, so a bad template fails boot. */
export const promptTemplates: TemplateRegistry = createTemplateRegistry(PROMPT_TEMPLATES);

/** Render a registered template; the result carries its template id to the text runner. */
export function renderPrompt(id: string, input: unknown): RenderedPrompt {
	return promptTemplates.render(id, input);
}
