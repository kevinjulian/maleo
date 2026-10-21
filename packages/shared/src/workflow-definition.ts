/* Workflows as data: the node vocabulary and its validator.
 *
 * A definition is plain JSON built from six node types. The engine (apps/api)
 * runs it exactly as written; the catalog and, later, the web explorer read the
 * same object. Everything a node may touch — an operation, a rule, a fact, a
 * prompt, a tool, another workflow — is named by id and must be registered, so a
 * definition that names something unknown is rejected before any run starts.
 *
 * Paths: `input` (the whole input) or `input.<name>` reads the workflow input, `state.<name>` the flow state,
 * `fact:<id>` a registered read-only fact. Nothing else is addressable. */
import {
	expressionReferences,
	expressionShapeErrors,
	type Expression,
} from "./workflow-expression.ts";

/** A path (`input.x`, `state.x`, `fact:<id>`), or a literal. */
export type WorkflowBinding = string | { readonly value: unknown };
export type WorkflowBindings = Readonly<Record<string, WorkflowBinding>>;

export interface StepNode {
	readonly type: "step";
	readonly id: string;
	readonly op: string;
	readonly in?: WorkflowBindings;
	/** The state path the operation's output is written to. */
	readonly out?: string;
	/** Must equal the operation's declared prompts and tools, so the definition shows them. */
	readonly prompts?: readonly string[];
	readonly tools?: readonly string[];
	/** Record a failure and continue with the output absent. */
	readonly onError?: "continue";
}

export interface SequenceNode {
	readonly type: "sequence";
	readonly id: string;
	readonly steps: readonly WorkflowNode[];
}

export interface BranchNode {
	readonly type: "branch";
	readonly id: string;
	readonly if: Expression;
	readonly then: WorkflowNode;
	readonly else?: WorkflowNode;
}

export interface SuspendNode {
	readonly type: "suspend";
	readonly id: string;
	readonly kind: "approval" | "questions";
	/** Records exactly one pending action and returns the question to suspend on. */
	readonly ask: string;
	/** Receives the accepted answer. */
	readonly onAnswer: string;
	readonly in?: WorkflowBindings;
	readonly out?: string;
	readonly skipIf?: Expression;
}

export interface CallNode {
	readonly type: "call";
	readonly id: string;
	readonly workflow: string;
	readonly in: WorkflowBindings;
	readonly out?: string;
	/** A stage contract the called workflow's writes are scoped and settled under. */
	readonly contract?: string;
}

export interface WorkflowOutcome {
	readonly ok: boolean;
	/** Literal text, or `$<path>` to read it. */
	readonly note: string;
}

export interface EndNode {
	readonly type: "end";
	readonly id: string;
	/** A stated outcome, or `from`: a state path holding one (a called workflow's). */
	readonly outcome?: WorkflowOutcome;
	readonly from?: string;
	/** The workflow deliberately produced nothing; a stage contract owes no outputs. */
	readonly unchanged?: true;
}

/** Reserved until loops and their bounds are implemented; the validator rejects it. */
export interface ForEachNode {
	readonly type: "forEach";
	readonly id: string;
}

export type WorkflowNode =
	| StepNode
	| SequenceNode
	| BranchNode
	| SuspendNode
	| CallNode
	| EndNode
	| ForEachNode;

export interface WorkflowDefinition {
	readonly id: string;
	/** What the workflow does, as its agent tool describes it. */
	readonly description?: string;
	/** One line for browsing. */
	readonly summary?: string;
	readonly root: WorkflowNode;
}

export const WORKFLOW_NODE_TYPES = [
	"step",
	"sequence",
	"branch",
	"suspend",
	"call",
	"end",
	"forEach",
] as const;

/** What a definition may reference, supplied by the host's registries. */
export interface WorkflowKnown {
	operation(id: string): { prompts: readonly string[]; tools: readonly string[] } | undefined;
	rules: ReadonlySet<string>;
	facts: ReadonlySet<string>;
	contracts: ReadonlySet<string>;
	/** Every definition loaded alongside, for call targets and cycles. */
	workflows: ReadonlyMap<string, WorkflowDefinition>;
}

/** Every node of a definition in depth-first order. */
export function workflowNodes(node: WorkflowNode): WorkflowNode[] {
	switch (node.type) {
		case "sequence":
			return [node, ...node.steps.flatMap(workflowNodes)];
		case "branch":
			return [node, ...workflowNodes(node.then), ...(node.else ? workflowNodes(node.else) : [])];
		case "step":
		case "call":
		case "forEach":
		case "suspend":
		case "end":
			return [node];
	}
}

const PATH = /^input$|^(input|state)\.[A-Za-z_$][\w$]*(\.[\w$]+)*$|^fact:[\w.:-]+$/;

function pathErrors(path: string, where: string, known: WorkflowKnown): string[] {
	if (!PATH.test(path)) return [`${where}: "${path}" is not an input., state. or fact: path`];
	if (path.startsWith("fact:") && !known.facts.has(path.slice("fact:".length)))
		return [`${where}: unknown fact "${path.slice("fact:".length)}"`];
	return [];
}

function bindingErrors(
	bindings: WorkflowBindings | undefined,
	where: string,
	known: WorkflowKnown,
): string[] {
	return Object.entries(bindings ?? {}).flatMap(([name, binding]) =>
		typeof binding === "string" ? pathErrors(binding, `${where} in.${name}`, known) : [],
	);
}

function stateTargetErrors(out: string | undefined, where: string): string[] {
	return out === undefined || /^state\.[\w$]+(\.[\w$]+)*$/.test(out)
		? []
		: [`${where}: out must be a state. path, got "${out}"`];
}

function expressionErrors(expression: Expression, where: string, known: WorkflowKnown): string[] {
	const shape = expressionShapeErrors(expression, where);
	if (shape.length) return shape;
	const references = expressionReferences(expression);
	return [
		...references.paths.flatMap((path) => pathErrors(path, where, known)),
		...references.rules
			.filter((rule) => !known.rules.has(rule))
			.map((rule) => `${where}: unknown rule "${rule}"`),
		...references.facts
			.filter((fact) => !known.facts.has(fact))
			.map((fact) => `${where}: unknown fact "${fact}"`),
	];
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]): boolean => {
	const left = [...new Set(a ?? [])].sort();
	const right = [...new Set(b)].sort();
	return left.length === right.length && left.every((value, index) => value === right[index]);
};

function nodeErrors(node: WorkflowNode, where: string, known: WorkflowKnown): string[] {
	const at = `${where} node "${node.id}"`;
	switch (node.type) {
		case "step": {
			const declared = known.operation(node.op);
			if (!declared) return [`${at}: unknown operation "${node.op}"`];
			return [
				...bindingErrors(node.in, at, known),
				...stateTargetErrors(node.out, at),
				...(sameList(node.prompts, declared.prompts)
					? []
					: [
							`${at}: prompts ${JSON.stringify(node.prompts ?? [])} do not match operation "${node.op}" ${JSON.stringify(declared.prompts)}`,
						]),
				...(sameList(node.tools, declared.tools)
					? []
					: [
							`${at}: tools ${JSON.stringify(node.tools ?? [])} do not match operation "${node.op}" ${JSON.stringify(declared.tools)}`,
						]),
			];
		}
		case "sequence":
			return node.steps.length ? [] : [`${at}: a sequence needs at least one node`];
		case "branch":
			return expressionErrors(node.if, `${at} if`, known);
		case "suspend":
			return [
				...(known.operation(node.ask) ? [] : [`${at}: unknown operation "${node.ask}"`]),
				...(known.operation(node.onAnswer) ? [] : [`${at}: unknown operation "${node.onAnswer}"`]),
				...bindingErrors(node.in, at, known),
				...stateTargetErrors(node.out, at),
				...(node.skipIf ? expressionErrors(node.skipIf, `${at} skipIf`, known) : []),
			];
		case "call":
			return [
				...(known.workflows.has(node.workflow)
					? []
					: [`${at}: unknown workflow "${node.workflow}"`]),
				...(node.contract && !known.contracts.has(node.contract)
					? [`${at}: unknown contract "${node.contract}"`]
					: []),
				...bindingErrors(node.in, at, known),
				...stateTargetErrors(node.out, at),
			];
		case "end":
			if (Boolean(node.outcome) === Boolean(node.from))
				return [`${at}: an end states an outcome or reads one from a path, not both`];
			if (node.from) return pathErrors(node.from, at, known);
			return node.outcome!.note.startsWith("$")
				? pathErrors(node.outcome!.note.slice(1), at, known)
				: [];
		case "forEach":
			return [`${at}: node type "forEach" is not yet supported`];
		default:
			return [
				`${at}: unknown node type ${JSON.stringify(Object.getOwnPropertyDescriptor(node, "type")?.value)}`,
			];
	}
}

/** The workflows a definition calls, directly. */
export function calledWorkflows(definition: WorkflowDefinition): string[] {
	return workflowNodes(definition.root).flatMap((node) =>
		node.type === "call" ? [node.workflow] : [],
	);
}

/** Every problem in one definition, checked before any run starts. */
export function validateWorkflow(definition: WorkflowDefinition, known: WorkflowKnown): string[] {
	const where = `workflow "${definition.id}"`;
	const nodes = workflowNodes(definition.root);
	const seen = new Set<string>();
	const errors: string[] = [];
	for (const node of nodes) {
		if (!node.id) errors.push(`${where}: every node needs an id`);
		else if (seen.has(node.id)) errors.push(`${where}: node id "${node.id}" is used twice`);
		seen.add(node.id);
		errors.push(...nodeErrors(node, where, known));
	}
	const visited = new Set<string>();
	const pending = calledWorkflows(definition);
	while (pending.length) {
		const next = pending.pop()!;
		if (next === definition.id) {
			errors.push(`${where}: calls itself directly or indirectly`);
			break;
		}
		if (visited.has(next)) continue;
		visited.add(next);
		const target = known.workflows.get(next);
		if (target) pending.push(...calledWorkflows(target));
	}
	return errors;
}
