import type {
	AgentTemplateCatalog,
	AgentTemplateDefinition,
	AgentTemplateExecution,
	AgentTemplateFidelity,
	AgentTemplateRecipe,
} from "@maleo/shared";

export function templateFact(item: AgentTemplateDefinition, name: string): AgentTemplateFidelity {
	return (
		item.provenance?.[name] ?? item.provenance?.["*"] ?? { kind: "declared", source: item.source }
	);
}

export function templateExecutionRows(execution: AgentTemplateExecution) {
	const rows: {
		position: string;
		node: AgentTemplateExecution;
		conditions: { id: string; outcome: boolean }[];
		continuation: string;
	}[] = [];
	const visit = (
		node: AgentTemplateExecution,
		position: string,
		conditions: { id: string; outcome: boolean }[],
		scoped: boolean,
	): void => {
		if (node.kind === "sequence") {
			node.children.forEach((child, index) =>
				visit(child, position ? `${position}.${index + 1}` : String(index + 1), conditions, scoped),
			);
			return;
		}
		rows.push({
			position: position || "1",
			node,
			conditions,
			continuation: node.terminal
				? scoped
					? "Return to caller"
					: "Stop sequence"
				: node.kind === "branch"
					? "Choose a branch"
					: node.kind === "scope"
						? "Return to caller after this scope"
						: "Continue",
		});
		for (const [index, child] of node.children.entries())
			visit(
				child,
				`${position || "1"}.${node.kind === "branch" ? (index === 0 ? "true" : "false") : "scope"}`,
				node.conditionId
					? [...conditions, { id: node.conditionId, outcome: index === 0 }]
					: conditions,
				scoped || node.kind === "scope",
			);
	};
	visit(execution, "", [], false);
	return rows;
}

export function templatePredicate(catalog: AgentTemplateCatalog, id: string) {
	return catalog.definitions
		.flatMap((item) => item.predicates ?? [])
		.find((predicate) => predicate.id === id);
}

export function templateCallerOutcomes(
	catalog: AgentTemplateCatalog,
	item: AgentTemplateDefinition,
	predicateId: string,
): boolean[] {
	return [
		...new Set(
			catalog.relationships
				.filter((edge) => edge.to === item.id)
				.flatMap(
					(edge) =>
						edge.conditions
							?.filter((condition) => condition.id === predicateId)
							.map((condition) => condition.outcome) ?? [],
				),
		),
	];
}

export function templateRecipeRows(recipe: AgentTemplateRecipe) {
	const rows: { position: string; node: AgentTemplateRecipe; condition: string }[] = [];
	const visit = (node: AgentTemplateRecipe, position: string, condition: string): void => {
		rows.push({ position, node, condition });
		for (const [index, child] of node.children.entries())
			visit(
				child,
				`${position}.${index + 1}`,
				node.kind === "choice"
					? `${index === 0 ? "When true" : "When false"}: ${node.when}`
					: node.kind === "repeat"
						? `For each selected item: ${node.select}`
						: condition,
			);
	};
	visit(recipe, "1", "Always in this recipe");
	return rows;
}
