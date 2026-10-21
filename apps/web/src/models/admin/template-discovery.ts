import type { AgentTemplateCatalog, AgentTemplateDefinition } from "@maleo/shared";
import type { TemplateSelection, TemplateLocation } from "@models/core/routing.ts";
import {
	scopedTemplates,
	templateStagePipeline,
	templateUsage,
	searchTemplates,
	EMPTY_TEMPLATE_FILTERS,
} from "./template-dashboard.ts";
import { templateFact } from "./template-structure.ts";

export function workflowFor(catalog: AgentTemplateCatalog, value: TemplateSelection) {
	return catalog.definitions.find((item) => item.kind === "workflow" && item.id === value.workflow);
}
export function workflowStages(
	catalog: AgentTemplateCatalog,
	workflow: AgentTemplateDefinition,
	filters = EMPTY_TEMPLATE_FILTERS,
	query = "",
) {
	const matches = new Set(
		searchTemplates(catalog, catalog.definitions, query, false).map((entry) => entry.item.id),
	);
	return templateStagePipeline(catalog, workflow, filters).map((stage) => {
		const matchingIds = new Set([...stage.referenceIds].filter((id) => matches.has(id)));
		const pathIds = new Set(matchingIds);
		const queue = [...pathIds];
		for (let index = 0; index < queue.length; index++)
			for (const edge of catalog.relationships) {
				if (
					edge.to !== queue[index] ||
					!stage.referenceIds.has(edge.from) ||
					["available", "profile", "next"].includes(edge.kind) ||
					pathIds.has(edge.from)
				)
					continue;
				pathIds.add(edge.from);
				queue.push(edge.from);
			}
		return {
			...stage,
			matchingIds,
			pathIds,
			matches: stage.matches && (!query.trim() || matchingIds.size > 0),
			definitions: catalog.definitions.filter(
				(entry) => entry.id !== stage.item.id && stage.referenceIds.has(entry.id),
			),
			toolCount: catalog.definitions.filter(
				(entry) => entry.kind === "tool" && stage.referenceIds.has(entry.id),
			).length,
			instructionCount: catalog.definitions.filter(
				(entry) => entry.kind === "prompt" && stage.referenceIds.has(entry.id),
			).length,
		};
	});
}
export function consumerContexts(catalog: AgentTemplateCatalog, id: string) {
	return templateUsage(catalog, id).pipelines.flatMap<{
		workflow: AgentTemplateDefinition;
		stage?: AgentTemplateDefinition;
	}>((workflow) => {
		const stages = workflowStages(catalog, workflow).filter((stage) => stage.referenceIds.has(id));
		return stages.length
			? stages.map((stage) => ({ workflow, stage: stage.item }))
			: [{ workflow, stage: undefined }];
	});
}
export function validFrame(catalog: AgentTemplateCatalog, frame: TemplateLocation): boolean {
	if (!catalog.definitions.some((entry) => entry.id === frame.id)) return false;
	if (!frame.workflow) return !frame.stage;
	const workflow = catalog.definitions.find(
		(entry) => entry.kind === "workflow" && entry.id === frame.workflow,
	);
	if (!workflow) return false;
	if (frame.stage) return workflow.steps.includes(frame.stage);
	return (
		frame.id === workflow.id ||
		scopedTemplates(catalog, workflow.id, true).definitions.some((entry) => entry.id === frame.id)
	);
}
export function normalizeDiscovery(
	catalog: AgentTemplateCatalog,
	value: TemplateSelection,
): TemplateSelection {
	const { open: _open, filters: _filters, promptText: _promptText, trail: _trail, ...rest } = value;
	const section =
		value.section === "prompts"
			? "instructions"
			: value.section === "profiles" || value.section === "operations"
				? "workflows"
				: value.section;
	const trail = value.trail?.filter((frame) => validFrame(catalog, frame)).slice(-16) ?? [];
	/* A workflow's detail pane is its workflow or stage; anything else a workflow
	 * link names opens in the drawer. Older links carried it as `inspect`. */
	const drawer =
		section === "workflows" && rest.inspect && (value.workflow || value.stage)
			? { inspect: undefined, peek: rest.peek ?? rest.inspect }
			: {};
	return {
		...rest,
		...drawer,
		section,
		...(section === "workflows" ? { query: undefined } : {}),
		...(trail.length ? { trail } : {}),
	};
}

/** Opens a definition in the drawer; one already open becomes the drawer's Back step. */
export function inspectSelection(
	value: TemplateSelection,
	target: AgentTemplateDefinition,
): TemplateSelection {
	const prior = value.peek;
	const trail =
		prior && prior !== target.id ? [...(value.trail ?? []), { id: prior }] : (value.trail ?? []);
	return {
		...value,
		peek: target.id,
		...(trail.length ? { trail: trail.slice(-16) } : {}),
		...(trail.length > 16 ? { omitted: true } : {}),
	};
}
export function workflowFacts(item: AgentTemplateDefinition) {
	const props = item.input?.properties;
	return [
		{
			name: "Purpose",
			value: item.description || "Not exposed by current catalog",
			fidelity: templateFact(item, "description").kind,
		},
		{
			name: "Trigger / entry point",
			value: item.entryPoint
				? `${item.entryPoint} (callable entry; no schedule exposed)`
				: "Not exposed by current catalog",
			fidelity: item.entryPoint ? templateFact(item, "entryPoint").kind : "not exposed",
		},
		{
			name: "Inputs",
			value:
				props && typeof props === "object"
					? Object.keys(props).join(", ") || "No fields exposed"
					: "Not exposed by current catalog",
			fidelity: item.input ? templateFact(item, "input").kind : "not exposed",
		},
		{
			name: "Outputs",
			value: item.output.join("; ") || "Not exposed by current catalog",
			fidelity: item.output.length ? templateFact(item, "output").kind : "not exposed",
		},
		{
			name: "Runtime authority",
			value: `Source ownership: ${item.source}. Runtime host not exposed by current catalog.`,
			fidelity: templateFact(item, "source").kind,
		},
		{
			name: "Execution stages",
			value: `${item.steps.length} published stages; inspect conditions before assuming continuation.`,
			fidelity: templateFact(item, "steps").kind,
		},
	];
}
export function workflowCoverage(catalog: AgentTemplateCatalog, workflow: AgentTemplateDefinition) {
	const closure = scopedTemplates(catalog, workflow.id);
	return closure.definitions.flatMap((item) => {
		const facts = [
			{ group: "Execution", field: "execution", exists: !!item.execution },
			{ group: "Instructions", field: "recipe", exists: !!item.recipe || !!item.instructions },
			{ group: "Contracts", field: "input", exists: !!item.input },
		];
		return facts.map((fact) => ({
			item,
			group: fact.group,
			fidelity: fact.exists ? templateFact(item, fact.field).kind : "not exposed",
		}));
	});
}

/** Contextual Back also works on a direct link with no browser entry to pop. */
export function templateParent(value: TemplateSelection): TemplateSelection {
	if (value.peek) {
		const previous = value.trail?.at(-1);
		return previous
			? { ...value, peek: previous.id, trail: value.trail!.slice(0, -1) }
			: { ...value, peek: undefined, trail: undefined, omitted: undefined };
	}
	if (value.inspect)
		return { ...value, inspect: undefined, trail: undefined, implementation: undefined };
	if (value.stage) return { ...value, stage: undefined, implementation: undefined };
	return { section: value.section };
}
