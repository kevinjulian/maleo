import type {
	AgentTemplateCatalog,
	AgentTemplateDefinition,
	AgentTemplateRelationship,
} from "@maleo/shared";

export type TemplateKind = AgentTemplateDefinition["kind"];
const dependencyKinds = new Set<AgentTemplateRelationship["kind"]>([
	"contains",
	"conditional",
	"uses_tool",
	"uses_prompt",
]);
export const isTemplateDependency = (edge: AgentTemplateRelationship) =>
	dependencyKinds.has(edge.kind);

/** Static reachability, including conditional work; availability never establishes dependency. */
export function templateUsage(catalog: AgentTemplateCatalog, id: string) {
	const incoming = catalog.relationships.filter((edge) => edge.to === id);
	const visited = new Set([id]);
	const queue = [id];
	for (let index = 0; index < queue.length; index++)
		for (const edge of catalog.relationships) {
			if (edge.to === queue[index] && isTemplateDependency(edge) && !visited.has(edge.from)) {
				visited.add(edge.from);
				queue.push(edge.from);
			}
		}
	return {
		ids: visited,
		direct: incoming.filter(isTemplateDependency),
		optional: incoming.filter((edge) => edge.kind === "available"),
		pipelines: catalog.definitions.filter(
			(item) => item.kind === "workflow" && visited.has(item.id),
		),
	};
}
export function scopedTemplates(
	catalog: AgentTemplateCatalog,
	scope: string,
	includeAvailable = false,
): AgentTemplateCatalog {
	if (scope === "all") return catalog;
	const root = catalog.definitions.find((item) => item.id === scope && item.kind === "workflow");
	const ids = new Set(root ? [root.id] : []);
	const queue = [...ids];
	for (let index = 0; index < queue.length; index++)
		for (const edge of catalog.relationships) {
			if (edge.from !== queue[index]) continue;
			if (
				!isTemplateDependency(edge) &&
				edge.kind !== "profile" &&
				!(includeAvailable && edge.kind === "available")
			)
				continue;
			if (!ids.has(edge.to)) {
				ids.add(edge.to);
				queue.push(edge.to);
			}
		}
	return {
		...catalog,
		definitions: catalog.definitions.filter((item) => ids.has(item.id)),
		relationships: catalog.relationships.filter(
			(edge) =>
				ids.has(edge.from) && ids.has(edge.to) && (includeAvailable || edge.kind !== "available"),
		),
	};
}
export type TemplateFilters = {
	content: string;
	kind: string;
	effect: string;
	prompt: string;
	source: string;
	conditions: boolean;
	repeats: boolean;
};
export const TEMPLATE_FILTER_FACETS = {
	workflow: ["content"],
	tool: ["content", "effect", "prompt"],
	prompt: ["content", "source"],
	operation: ["content", "source"],
	profile: ["content"],
} as const;
export const EMPTY_TEMPLATE_FILTERS: TemplateFilters = {
	content: "",
	kind: "",
	effect: "",
	prompt: "",
	source: "",
	conditions: false,
	repeats: false,
};
export const templateGateCount = (item: AgentTemplateDefinition) =>
	item.conditions.length + (item.predicates?.length ?? 0);
export function filterTemplates(entries: AgentTemplateDefinition[], filters: TemplateFilters) {
	return entries.filter(
		(item) =>
			(!filters.content || item.contentTypes.some((type) => type === filters.content)) &&
			(!filters.kind || item.kind === filters.kind) &&
			(!filters.effect || item.effect === filters.effect) &&
			(!filters.prompt || item.promptMode === filters.prompt) &&
			(!filters.source || item.source === filters.source) &&
			(!filters.conditions || templateGateCount(item) > 0) &&
			(!filters.repeats || !!item.repeat),
	);
}
export function searchTemplates(
	catalog: AgentTemplateCatalog,
	entries: AgentTemplateDefinition[],
	query: string,
	promptText: boolean,
) {
	const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
	if (!terms.length) return [];
	return entries
		.flatMap((item) => {
			const name = item.label.toLowerCase();
			const fields = [
				item.label,
				item.aliases.join(" "),
				item.id,
				item.summary ?? "",
				item.purpose ?? "",
				item.capabilities?.join(" ") ?? "",
				item.description,
				item.source,
			];
			if (promptText) fields.push(item.instructions?.join("\n\n") ?? "");
			const haystack = fields.join("\n").toLowerCase();
			if (!terms.every((term) => haystack.includes(term))) return [];
			const matched =
				fields.find((field) => terms.every((term) => field.toLowerCase().includes(term))) ??
				fields.find((field) => terms.some((term) => field.toLowerCase().includes(term))) ??
				item.description;
			const position = Math.max(0, matched.toLowerCase().indexOf(terms[0]!));
			const start = Math.max(0, position - 40);
			const snippet = `${start ? "…" : ""}${matched.slice(start, start + 180)}${matched.length > start + 180 ? "…" : ""}`;
			const rank =
				name === query.trim().toLowerCase() ||
				item.id.toLowerCase() === query.trim().toLowerCase() ||
				item.id.split(":").at(-1)?.toLowerCase() === query.trim().toLowerCase()
					? 0
					: name.startsWith(terms[0]!)
						? 1
						: terms.every((term) => name.includes(term))
							? 2
							: item.aliases.some((alias) => alias.toLowerCase().includes(terms[0]!))
								? 3
								: 4;
			return [{ item, snippet, rank, pipelines: templateUsage(catalog, item.id).pipelines }];
		})
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				Number(b.item.kind === "workflow") - Number(a.item.kind === "workflow") ||
				a.item.label.localeCompare(b.item.label),
		);
}
/** Dependency paths exclude topology, configuration and optional availability. */
export function dependencyReferences(catalog: AgentTemplateCatalog, id: string) {
	const paths = new Map<string, AgentTemplateDefinition[]>();
	const queue = [id];
	for (let index = 0; index < queue.length; index++)
		for (const edge of catalog.relationships) {
			if (
				edge.from !== queue[index] ||
				!isTemplateDependency(edge) ||
				edge.to === id ||
				paths.has(edge.to)
			)
				continue;
			const parent = catalog.definitions.find((entry) => entry.id === edge.from)!;
			paths.set(edge.to, edge.from === id ? [] : [...(paths.get(edge.from) ?? []), parent]);
			queue.push(edge.to);
		}
	return catalog.definitions
		.filter((entry) => paths.has(entry.id))
		.map((item) => ({ item, via: paths.get(item.id)! }));
}
/** Ordered production stages; filters never silently change execution order. */
export function templateStagePipeline(
	catalog: AgentTemplateCatalog,
	workflow: AgentTemplateDefinition,
	filters: TemplateFilters,
) {
	return workflow.steps.map((id, index) => {
		const item = catalog.definitions.find((entry) => entry.id === id)!;
		const next = workflow.steps[index + 1];
		const directMatch = filterTemplates([item], filters).length > 0;
		const dependencies = catalog.relationships.filter(
			(edge) => edge.from === id && isTemplateDependency(edge),
		);
		const referenceIds = new Set([id]);
		const queue = [id];
		for (let at = 0; at < queue.length; at++)
			for (const edge of catalog.relationships) {
				if (edge.from !== queue[at] || !isTemplateDependency(edge) || referenceIds.has(edge.to))
					continue;
				referenceIds.add(edge.to);
				queue.push(edge.to);
			}
		const referenced = catalog.definitions.filter(
			(entry) => entry.id !== id && referenceIds.has(entry.id),
		);
		const matchingIds = new Set(filterTemplates(referenced, filters).map((entry) => entry.id));
		return {
			item,
			index,
			matches: directMatch || matchingIds.size > 0,
			referenceIds,
			instructionCount: referenced.filter(
				(entry) => entry.kind === "tool" || entry.kind === "prompt",
			).length,
			connection: catalog.relationships.find(
				(edge) => edge.from === id && edge.to === next && edge.kind === "next",
			),
			dependencies: directMatch
				? dependencies
				: dependencies.filter((edge) => matchingIds.has(edge.to)),
		};
	});
}
