import type { AgentTemplateCatalog, AgentTemplateDefinition } from "@maleo/shared";
import type { TemplateSelection } from "@models/core/routing.ts";

export const TEMPLATE_KINDS = {
	workflows: "workflow",
	profiles: "profile",
	tools: "tool",
	instructions: "prompt",
	prompts: "prompt",
	operations: "operation",
} as const;
export function templateSelection(item: AgentTemplateDefinition): TemplateSelection {
	if (item.kind === "workflow") return { section: "workflows", workflow: item.id };
	const section =
		item.kind === "tool" ? "tools" : item.kind === "prompt" ? "instructions" : "workflows";
	return { section, inspect: item.id };
}
export function selectedTemplate(catalog: AgentTemplateCatalog, selection?: TemplateSelection) {
	const id =
		selection?.inspect ??
		selection?.stage ??
		(selection?.section === "workflows" ? selection.workflow : undefined);
	return catalog.definitions.find((item) => item.id === id);
}
export const TEMPLATE_KIND_INFO = {
	workflow: { label: "Workflow", meaning: "Executable pipeline and stage order" },
	profile: { label: "Profile", meaning: "Stage contracts; not a separate entry point" },
	operation: { label: "Operation", meaning: "Internal stage or helper work" },
	tool: { label: "Tool", meaning: "Callable capability with validated inputs" },
	prompt: { label: "Instruction", meaning: "Production instructions and composition" },
} as const;
export const TEMPLATE_RELATION_LABELS = {
	next: "Next on success",
	conditional: "Conditional work",
	contains: "Contains",
	profile: "Stage profile",
	uses_tool: "Uses tool",
	uses_prompt: "Uses prompt",
	available: "Available; optional",
} as const;
/** Plain-language effect of calling a tool, for readers who do not know the catalog vocabulary. */
export const TEMPLATE_EFFECT_LABELS: Readonly<Record<string, string>> = {
	read: "Reads the project; changes nothing",
	respond: "Replies in the conversation",
	generate: "Creates new media",
	mutate: "Changes the project",
};
