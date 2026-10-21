/* Workflow definitions as catalog entries: a direct walk of the data the engine
 * executes. Nodes become the execution tree, branch conditions are shown as the
 * expressions they are, and registered operations, rules and facts appear as
 * opaque code identified by id with their declared schemas, prompts, tools and
 * capabilities. Nothing here is derived from TypeScript source. */
import { zodToJsonSchema } from "zod-to-json-schema";
import {
	expressionReferences,
	type AgentTemplateExecution,
	type Expression,
	type WorkflowDefinition,
	type WorkflowNode,
} from "@maleo/shared";
import type { EngineRegistry } from "./registry.ts";

type Fidelity = { kind: "derived" | "declared" | "opaque"; source: string; detail?: string };

export interface CatalogDefinitionInput {
	id: string;
	kind: "workflow" | "operation";
	label: string;
	description: string;
	summary?: string;
	source: string;
	revision: string;
	contentTypes: ("image" | "text" | "video")[];
	conditions?: string[];
	capabilities?: string[];
	entryPoint?: string;
	exposure?: string;
	input?: Record<string, unknown>;
	output?: string[];
	execution?: AgentTemplateExecution;
	predicates?: Array<{
		id: string;
		source: string;
		expression: string;
		provenance: Fidelity;
		resolution: "unresolved";
		boundaries: Array<{ source: string; symbol: string; reason: string }>;
	}>;
	provenance?: Record<string, Fidelity>;
}

export interface CatalogRelationshipInput {
	from: string;
	to: string;
	kind: "next" | "conditional" | "contains" | "uses_prompt" | "available" | "uses_tool" | "profile";
	label?: string;
	provenance?: Fidelity;
	conditions?: Array<{ id: string; outcome: boolean }>;
}

export interface WorkflowCatalogSource {
	definition: WorkflowDefinition;
	/** The module the definition is declared in. */
	source: string;
	/** The agent tool name, when the workflow is offered to the agent. */
	entryPoint?: string;
}

const OPERATIONS_SOURCE = "apps/api/src/modules/agents/core/engine/planning/";
const VIDEO = ["video" as const];

const nodeId = (workflow: string, node: string) => `node:${workflow}:${node}`;
const conditionId = (workflow: string, node: string) => `condition:${workflow}:${node}`;

function expressionText(expression: Expression): string {
	return JSON.stringify(expression);
}

function boundariesOf(expression: Expression, source: string) {
	const references = expressionReferences(expression);
	return [
		...references.rules.map((rule) => ({
			source,
			symbol: `rule:${rule}`,
			reason: "Registered rule; its code is opaque to inspection.",
		})),
		...[
			...references.facts,
			...references.paths
				.filter((path) => path.startsWith("fact:"))
				.map((path) => path.slice("fact:".length)),
		].map((fact) => ({ source, symbol: `fact:${fact}`, reason: "Registered read-only fact." })),
	];
}

/** Catalog entries and edges for every workflow definition and the operations it names. */
export interface WorkflowCatalogEntries {
	definitions: CatalogDefinitionInput[];
	relationships: CatalogRelationshipInput[];
}

export function workflowCatalog(
	registry: EngineRegistry,
	workflows: readonly WorkflowCatalogSource[],
): WorkflowCatalogEntries {
	const definitions: CatalogDefinitionInput[] = [];
	const relationships: CatalogRelationshipInput[] = [];
	const operations = new Set<string>();

	for (const { definition, source, entryPoint } of workflows) {
		const workflowId = `workflow:${definition.id}`;
		const derived: Fidelity = { kind: "derived", source };
		const predicates: NonNullable<CatalogDefinitionInput["predicates"]> = [];
		const visit = (
			node: WorkflowNode,
			conditions: Array<{ id: string; outcome: boolean }>,
		): AgentTemplateExecution => {
			const edge = (to: string) =>
				relationships.push({
					from: workflowId,
					to,
					kind: conditions.length ? "conditional" : "contains",
					provenance: derived,
					conditions: [...conditions],
				});
			switch (node.type) {
				case "sequence":
					return {
						kind: "sequence",
						children: node.steps.map((child) => visit(child, conditions)),
					};
				case "branch": {
					const id = conditionId(definition.id, node.id);
					predicates.push({
						id,
						source,
						expression: expressionText(node.if),
						provenance: derived,
						resolution: "unresolved",
						boundaries: boundariesOf(node.if, source),
					});
					return {
						kind: "branch",
						conditionId: id,
						children: [
							visit(node.then, [...conditions, { id, outcome: true }]),
							...(node.else ? [visit(node.else, [...conditions, { id, outcome: false }])] : []),
						],
					};
				}
				case "step": {
					operations.add(node.op);
					edge(`operation:${node.op}`);
					if (node.onError === "continue")
						definitions.push({
							id: nodeId(definition.id, node.id),
							kind: "operation",
							label: node.id,
							description: `Best-effort step: a failure of ${node.op} is recorded and the workflow continues without its output.`,
							source,
							revision: "pending",
							contentTypes: VIDEO,
							provenance: { "*": derived },
						});
					return { kind: "call", operationId: `operation:${node.op}`, children: [] };
				}
				case "suspend": {
					operations.add(node.ask);
					operations.add(node.onAnswer);
					const id = nodeId(definition.id, node.id);
					definitions.push({
						id,
						kind: "operation",
						label: node.id,
						description: `Suspends for the user's ${node.kind === "approval" ? "approval" : "answers"}: ${node.ask} records one pending action; the accepted answer goes to ${node.onAnswer}.`,
						source,
						revision: "pending",
						contentTypes: VIDEO,
						conditions: [
							"Can suspend for human input and resume at this node.",
							...(node.skipIf
								? [`Skipped without asking when ${expressionText(node.skipIf)}`]
								: []),
						],
						provenance: { "*": derived },
					});
					relationships.push({
						from: id,
						to: `operation:${node.ask}`,
						kind: "contains",
						provenance: derived,
					});
					relationships.push({
						from: id,
						to: `operation:${node.onAnswer}`,
						kind: "contains",
						provenance: derived,
					});
					edge(id);
					return { kind: "call", operationId: id, children: [] };
				}
				case "call": {
					edge(`workflow:${node.workflow}`);
					return { kind: "call", operationId: `workflow:${node.workflow}`, children: [] };
				}
				case "end": {
					const id = nodeId(definition.id, node.id);
					const outcome = node.from
						? `the outcome held at ${node.from}`
						: `ok=${String(node.outcome!.ok)}, "${node.outcome!.note}"`;
					definitions.push({
						id,
						kind: "operation",
						label: node.id,
						description: `Ends ${definition.id} with ${outcome}${node.unchanged ? "; produced nothing, so a stage contract owes no outputs" : ""}.`,
						source,
						revision: "pending",
						contentTypes: VIDEO,
						provenance: { "*": derived },
					});
					edge(id);
					return { kind: "call", operationId: id, terminal: true, children: [] };
				}
				case "forEach":
					throw new Error(`workflow "${definition.id}": forEach is not supported`);
			}
		};
		const execution = visit(definition.root, []);
		const entry = registry.get(definition.id);
		definitions.push({
			id: workflowId,
			kind: "workflow",
			label: definition.id,
			description: definition.description ?? definition.id,
			summary: definition.summary ?? definition.description?.split(/(?<=[.!?])\s/)[0],
			source,
			revision: entry?.revision ?? "pending",
			contentTypes: VIDEO,
			...(entryPoint
				? { entryPoint, exposure: "Agent tool running this workflow definition on the engine." }
				: { exposure: "Called by other workflow definitions; not offered to the agent." }),
			execution,
			predicates,
			provenance: { "*": derived },
		});
	}

	for (const id of operations) {
		const operation = registry.operation(id);
		if (!operation) throw new Error(`catalog: unknown operation "${id}"`);
		const opaque: Fidelity = {
			kind: "opaque",
			source: OPERATIONS_SOURCE,
			detail: "Registered code; its body is not derived structure.",
		};
		definitions.push({
			id: `operation:${id}`,
			kind: "operation",
			label: id,
			description: operation.description,
			source: OPERATIONS_SOURCE,
			revision: "pending",
			contentTypes: VIDEO,
			capabilities: [...operation.capabilities],
			input: zodToJsonSchema(operation.input, { target: "jsonSchema7", $refStrategy: "none" }),
			output: [
				`Output schema: ${JSON.stringify(zodToJsonSchema(operation.output, { target: "jsonSchema7", $refStrategy: "none" }))}`,
			],
			conditions: operation.unscoped
				? [`Runs outside capability enforcement: ${operation.unscoped}`]
				: [],
			provenance: { "*": opaque },
		});
		for (const prompt of [...operation.prompts, ...(operation.renders ?? [])])
			relationships.push({
				from: `operation:${id}`,
				to: prompt,
				kind: "uses_prompt",
				provenance: opaque,
			});
		for (const tool of operation.tools)
			relationships.push({
				from: `operation:${id}`,
				to: `tool:${tool}`,
				kind: "uses_tool",
				provenance: opaque,
			});
	}
	return { definitions, relationships };
}
