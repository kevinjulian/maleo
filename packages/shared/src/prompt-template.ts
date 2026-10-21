/* Prompts as data: the template format, its validator and its one compiler.
 *
 * A template is a list of nodes rendered in order and concatenated. Slot values
 * are inserted literally — the output is never re-read as a template, so text that
 * looks like template syntax in a brief or a source excerpt stays text. Anything
 * the vocabulary cannot say is a constant or a formatter the host registers by
 * name; the template names it and never copies it.
 *
 * Pure: templates, constants and formatters arrive through a runtime the caller
 * supplies, so the API renders with its registries and the web explorer can render
 * the same data with its own. */
import {
	evaluateExpression,
	expressionReferences,
	expressionShapeErrors,
	ownValue,
	readPath,
	type Expression,
} from "./workflow-expression.ts";

export type TemplateFilter =
	| "trim"
	| "collapseWs"
	| "round"
	| { readonly min: number }
	| { readonly join: string }
	| { readonly default: string }
	| { readonly truncate: number };

/** A path into the current input, or a literal. */
export type TemplateBinding = string | { readonly value: unknown };

export type TemplateNode =
	| string
	| { readonly type: "text"; readonly text: string }
	| { readonly type: "slot"; readonly path: string; readonly filters?: readonly TemplateFilter[] }
	| { readonly type: "const"; readonly name: string; readonly filters?: readonly TemplateFilter[] }
	| {
			readonly type: "when";
			readonly if: Expression;
			readonly then: readonly TemplateNode[];
			readonly else?: readonly TemplateNode[];
	  }
	| {
			readonly type: "each";
			readonly path: string;
			readonly as: string;
			readonly template: readonly TemplateNode[];
			readonly sep?: string;
			readonly empty?: readonly TemplateNode[];
	  }
	| {
			readonly type: "include";
			readonly prompt: string;
			readonly in?: Readonly<Record<string, TemplateBinding>>;
	  }
	| {
			readonly type: "format";
			readonly name: string;
			readonly in?: Readonly<Record<string, TemplateBinding>>;
			readonly filters?: readonly TemplateFilter[];
	  };

/** Registered code that parses and accepts a model reply. Referenced, never run here. */
export interface ResponseContract {
	readonly parser: string;
	readonly schema: string;
	readonly policy: string;
}

export interface PromptTemplate {
	readonly id: string;
	readonly description?: string;
	readonly body: readonly TemplateNode[];
	/** Present on a template sent as a model request; absent on a composition fragment. */
	readonly response?: ResponseContract;
}

/** A registered formatter reads the arguments its node binds, by name. */
export type TemplateFormatter = (argument: (name: string) => unknown) => string;

export interface TemplateRuntime {
	template(id: string): PromptTemplate | undefined;
	constant(name: string): unknown;
	formatter(name: string): TemplateFormatter | undefined;
}

export interface TemplateKnown {
	constants: ReadonlySet<string>;
	formatters: ReadonlySet<string>;
}

export const TEMPLATE_FILTERS = [
	"trim",
	"collapseWs",
	"round",
	"min",
	"join",
	"default",
	"truncate",
] as const;
const BARE_FILTERS: readonly string[] = ["trim", "collapseWs", "round"];

export class TemplateRenderError extends Error {}

/* ── rendering ── */

interface Frame {
	input: unknown;
	locals: ReadonlyMap<string, unknown>;
	runtime: TemplateRuntime;
}

/** `const:NAME` reads a registered constant; anything else reads locals, then input. */
const CONST_PATH = "const:";

function read(frame: Frame, path: string): unknown {
	if (path.startsWith(CONST_PATH)) {
		const [name, ...rest] = path.slice(CONST_PATH.length).split(".");
		const value = frame.runtime.constant(name!);
		return rest.length ? readPath(value, rest.join(".")) : value;
	}
	const [head, ...rest] = path.split(".");
	if (head !== undefined && frame.locals.has(head)) {
		const local = frame.locals.get(head);
		return rest.length ? readPath(local, rest.join(".")) : local;
	}
	return readPath(frame.input, path);
}

function stringify(value: unknown, where: string): string {
	if (value === undefined || value === null) return "";
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	throw new TemplateRenderError(
		`${where}: a ${Array.isArray(value) ? "list" : "object"} needs a join filter or a formatter`,
	);
}

function applyFilter(value: unknown, filter: TemplateFilter, where: string): unknown {
	if (filter === "trim") return stringify(value, where).trim();
	if (filter === "collapseWs") return stringify(value, where).replace(/\s+/g, " ");
	if (filter === "round") return Math.round(Number(value));
	if ("min" in filter) return Math.max(filter.min, Number(value));
	if ("join" in filter) {
		if (!Array.isArray(value)) throw new TemplateRenderError(`${where}: join needs a list`);
		return value.map((item) => stringify(item, where)).join(filter.join);
	}
	if ("default" in filter)
		return value === undefined || value === null || value === "" ? filter.default : value;
	return stringify(value, where).slice(0, filter.truncate);
}

function filtered(
	value: unknown,
	filters: readonly TemplateFilter[] | undefined,
	where: string,
): string {
	return stringify(
		(filters ?? []).reduce((current, filter) => applyFilter(current, filter, where), value),
		where,
	);
}

function bindings(frame: Frame, entries: Readonly<Record<string, TemplateBinding>>) {
	return Object.fromEntries(
		Object.entries(entries).map(([name, binding]) => [
			name,
			typeof binding === "string" ? read(frame, binding) : binding.value,
		]),
	);
}

function renderNodes(
	nodes: readonly TemplateNode[],
	frame: Frame,
	runtime: TemplateRuntime,
	where: string,
): string {
	let out = "";
	for (const node of nodes) out += renderNode(node, frame, runtime, where);
	return out;
}

function renderNode(
	node: TemplateNode,
	frame: Frame,
	runtime: TemplateRuntime,
	where: string,
): string {
	if (typeof node === "string") return node;
	switch (node.type) {
		case "text":
			return node.text;
		case "slot":
			return filtered(read(frame, node.path), node.filters, `${where} slot ${node.path}`);
		case "const":
			return filtered(runtime.constant(node.name), node.filters, `${where} const ${node.name}`);
		case "when":
			return evaluateExpression(node.if, { read: (path) => read(frame, path) })
				? renderNodes(node.then, frame, runtime, where)
				: renderNodes(node.else ?? [], frame, runtime, where);
		case "each": {
			const items = read(frame, node.path);
			if (items !== undefined && items !== null && !Array.isArray(items))
				throw new TemplateRenderError(`${where} each ${node.path}: not a list`);
			const list: readonly unknown[] = items ?? [];
			if (!list.length) return renderNodes(node.empty ?? [], frame, runtime, where);
			return list
				.map((item, index) => {
					const locals = new Map(frame.locals);
					locals.set(node.as, item);
					locals.set("$index", index);
					locals.set("$number", index + 1);
					return renderNodes(
						node.template,
						{ input: frame.input, locals, runtime },
						runtime,
						where,
					);
				})
				.join(node.sep ?? "");
		}
		case "include": {
			const input = node.in ? bindings(frame, node.in) : frame.input;
			return renderTemplate(node.prompt, input, runtime);
		}
		case "format": {
			const formatter = runtime.formatter(node.name);
			if (!formatter) throw new TemplateRenderError(`${where}: unknown formatter "${node.name}"`);
			const bound = new Map(Object.entries(node.in ? bindings(frame, node.in) : {}));
			return filtered(
				formatter((name) => bound.get(name)),
				node.filters,
				`${where} format ${node.name}`,
			);
		}
	}
}

/** Render one registered template against its input. */
export function renderTemplate(id: string, input: unknown, runtime: TemplateRuntime): string {
	const template = runtime.template(id);
	if (!template) throw new TemplateRenderError(`unknown template "${id}"`);
	return renderNodes(
		template.body,
		{ input, locals: new Map(), runtime },
		runtime,
		`template "${id}"`,
	);
}

/* ── validation ── */

/** What a template references, for validation and for the catalog. */
export interface TemplateReferences {
	includes: string[];
	constants: string[];
	/** Constants read through `const:` paths (also listed in `constants`). */
	constPaths?: string[];
	formatters: string[];
	paths: string[];
}

export function templateReferences(template: PromptTemplate): TemplateReferences {
	const found: TemplateReferences = { includes: [], constants: [], formatters: [], paths: [] };
	const visit = (nodes: readonly TemplateNode[]): void => {
		for (const node of nodes) {
			if (typeof node === "string") continue;
			switch (node.type) {
				case "slot":
					found.paths.push(node.path);
					break;
				case "const":
					found.constants.push(node.name);
					break;
				case "when":
					found.paths.push(...expressionReferences(node.if).paths);
					visit(node.then);
					visit(node.else ?? []);
					break;
				case "each":
					found.paths.push(node.path);
					visit(node.template);
					visit(node.empty ?? []);
					break;
				case "include":
					found.includes.push(node.prompt);
					break;
				case "format":
					found.formatters.push(node.name);
					break;
				case "text":
					break;
			}
		}
	};
	visit(template.body);
	const constPaths = found.paths
		.filter((path) => path.startsWith(CONST_PATH))
		.map((path) => path.slice(CONST_PATH.length).split(".")[0]!);
	return {
		...found,
		constants: [...found.constants, ...constPaths],
		constPaths,
		paths: found.paths.filter((path) => !path.startsWith(CONST_PATH)),
	};
}

function filterErrors(filters: readonly TemplateFilter[] | undefined, where: string): string[] {
	return (filters ?? []).flatMap((filter) => {
		if (typeof filter === "string")
			return BARE_FILTERS.includes(filter) ? [] : [`${where}: unknown filter "${filter}"`];
		const keys = Object.keys(filter);
		return keys.length === 1 && ["min", "join", "default", "truncate"].includes(keys[0]!)
			? []
			: [`${where}: unknown filter ${JSON.stringify(filter)}`];
	});
}

function nodeErrors(nodes: readonly TemplateNode[], where: string, known: TemplateKnown): string[] {
	return nodes.flatMap((node, index): string[] => {
		const at = `${where}[${index}]`;
		if (typeof node === "string") return [];
		switch (node.type) {
			case "text":
				return typeof node.text === "string" ? [] : [`${at}: text must be a string`];
			case "slot":
				return [
					...(node.path ? [] : [`${at}: slot needs a path`]),
					...filterErrors(node.filters, at),
				];
			case "const":
				return [
					...(known.constants.has(node.name) ? [] : [`${at}: unknown constant "${node.name}"`]),
					...filterErrors(node.filters, at),
				];
			case "when": {
				const shape = expressionShapeErrors(node.if, `${at}.if`);
				const refs = shape.length ? { rules: [], facts: [] } : expressionReferences(node.if);
				return [
					...shape,
					...refs.rules.map((rule) => `${at}: templates cannot use rule "${rule}"`),
					...refs.facts.map((fact) => `${at}: templates cannot use fact "${fact}"`),
					...nodeErrors(node.then, `${at}.then`, known),
					...nodeErrors(node.else ?? [], `${at}.else`, known),
				];
			}
			case "each":
				return [
					...(node.path && node.as ? [] : [`${at}: each needs a path and an item name`]),
					...nodeErrors(node.template, `${at}.template`, known),
					...nodeErrors(node.empty ?? [], `${at}.empty`, known),
				];
			case "include":
				return node.prompt ? [] : [`${at}: include needs a template id`];
			case "format":
				return [
					...(known.formatters.has(node.name) ? [] : [`${at}: unknown formatter "${node.name}"`]),
					...filterErrors(node.filters, at),
				];
			default:
				return [`${at}: unknown node type ${JSON.stringify(ownValue(node, "type"))}`];
		}
	});
}

/** Every problem in a set of templates, checked before any is rendered. */
export function validateTemplates(
	templates: readonly PromptTemplate[],
	known: TemplateKnown,
): string[] {
	const errors: string[] = [];
	const byId = new Map<string, PromptTemplate>();
	for (const template of templates) {
		if (byId.has(template.id)) errors.push(`template "${template.id}" is defined twice`);
		byId.set(template.id, template);
	}
	for (const template of templates) {
		errors.push(...nodeErrors(template.body, `template "${template.id}"`, known));
		// `const` nodes are checked in place above; `const:` paths are checked here.
		for (const name of new Set(templateReferences(template).constPaths)) {
			if (!known.constants.has(name))
				errors.push(`template "${template.id}" reads unknown constant "${name}"`);
		}
		for (const target of templateReferences(template).includes) {
			if (!byId.has(target))
				errors.push(`template "${template.id}" includes unknown template "${target}"`);
		}
	}
	// Include cycles, reported once per template that reaches itself.
	const reaches = (from: string, target: string, seen: Set<string>): boolean => {
		const template = byId.get(from);
		if (!template) return false;
		for (const next of templateReferences(template).includes) {
			if (next === target) return true;
			if (seen.has(next)) continue;
			seen.add(next);
			if (reaches(next, target, seen)) return true;
		}
		return false;
	};
	for (const template of templates) {
		if (reaches(template.id, template.id, new Set()))
			errors.push(`template "${template.id}" includes itself directly or indirectly`);
	}
	return errors;
}

/* ── authoring ── */

/** One part of `joinPresent`: rendered when `when` holds (always, when absent). */
export interface PresentPart {
	readonly when?: Expression;
	readonly nodes: readonly TemplateNode[];
}

/** The nodes for "these parts, the present ones, joined by `sep`" — what builders
 *  wrote as `[a, b].filter(Boolean).join(sep)`. Runs when a template is authored;
 *  its result is plain data, with each separator guarded by the parts around it. */
export function joinPresent(sep: string, parts: readonly PresentPart[]): TemplateNode[] {
	const nodes: TemplateNode[] = [];
	parts.forEach((part, index) => {
		const earlier = parts.slice(0, index);
		const alwaysEarlier = earlier.some((candidate) => !candidate.when);
		const separator: TemplateNode[] =
			index === 0
				? []
				: alwaysEarlier
					? [sep]
					: [
							{
								type: "when",
								if:
									earlier.length === 1
										? earlier[0]!.when!
										: { or: earlier.map((candidate) => candidate.when!) },
								then: [sep],
							},
						];
		const body = [...separator, ...part.nodes];
		nodes.push(...(part.when ? [{ type: "when" as const, if: part.when, then: body }] : body));
	});
	return nodes;
}
