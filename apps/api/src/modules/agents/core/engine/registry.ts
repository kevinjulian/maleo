/* One registry for everything a workflow definition may name, validated at load.
 *
 * Definitions come only through `get(id)`, which also returns the revision of the
 * definition's content; a run records both and executes that snapshot until it
 * ends. Code defaults back the registry now; a stored implementation can sit
 * behind the same interface later. */
import { agentTemplateRevision, validateWorkflow, type WorkflowDefinition } from "@maleo/shared";
import type { Fact, Operation, Rule } from "./types.ts";

export interface WorkflowEntry {
	definition: WorkflowDefinition;
	revision: string;
}

export interface EngineRegistry {
	get(id: string): WorkflowEntry | undefined;
	definitions(): readonly WorkflowDefinition[];
	operation(id: string): Operation | undefined;
	fact(id: string): Fact | undefined;
	rule(id: string): Rule | undefined;
	contracts: ReadonlySet<string>;
}

export class WorkflowLoadError extends Error {}

export interface EngineRegistryInput {
	definitions: readonly WorkflowDefinition[];
	operations: readonly Operation[];
	facts: readonly Fact[];
	rules: readonly Rule[];
	contracts: readonly string[];
}

function unique<T extends { id: string }>(
	kind: string,
	items: readonly T[],
	errors: string[],
): Map<string, T> {
	const byId = new Map<string, T>();
	for (const item of items) {
		if (byId.has(item.id)) errors.push(`${kind} "${item.id}" is registered twice`);
		byId.set(item.id, item);
	}
	return byId;
}

export function workflowRevision(definition: WorkflowDefinition): string {
	return agentTemplateRevision(definition);
}

export function createEngineRegistry(input: EngineRegistryInput): EngineRegistry {
	const errors: string[] = [];
	const operations = unique("operation", input.operations, errors);
	const facts = unique("fact", input.facts, errors);
	const rules = unique("rule", input.rules, errors);
	const definitions = unique("workflow", input.definitions, errors);
	const contracts = new Set(input.contracts);
	const known = {
		operation: (id: string) => operations.get(id),
		rules: new Set(rules.keys()),
		facts: new Set(facts.keys()),
		contracts,
		workflows: definitions,
	};
	for (const definition of definitions.values())
		errors.push(...validateWorkflow(definition, known));
	if (errors.length)
		throw new WorkflowLoadError(`Workflow definitions failed to load:\n${errors.join("\n")}`);
	const entries = new Map(
		[...definitions].map(([id, definition]) => [
			id,
			{ definition, revision: workflowRevision(definition) },
		]),
	);
	return {
		get: (id) => entries.get(id),
		definitions: () => [...definitions.values()],
		operation: (id) => operations.get(id),
		fact: (id) => facts.get(id),
		rule: (id) => rules.get(id),
		contracts,
	};
}
