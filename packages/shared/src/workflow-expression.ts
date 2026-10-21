/* Conditions as data, shared by workflow definitions and prompt templates.
 *
 * An expression reads named values through a scope and nothing else: the scope
 * decides what a path means (workflow input, flow state, a registered fact, a
 * template's input). Evaluation has no side effect and cannot call code except a
 * named rule the scope registered. That is what lets a definition be inspected,
 * stored and later edited without its conditions becoming a back door into the
 * run record.
 *
 * The first operand of `eq` and `in` is always a path and the second always a
 * literal, so no string has to be guessed as one or the other. */

export type ExpressionLiteral = string | number | boolean | null;

export type Expression =
	| { readonly eq: readonly [string, ExpressionLiteral] }
	| { readonly in: readonly [string, readonly ExpressionLiteral[]] }
	| { readonly exists: string }
	| { readonly empty: string }
	| { readonly and: readonly Expression[] }
	| { readonly or: readonly Expression[] }
	| { readonly not: Expression }
	| { readonly rule: string }
	| { readonly fact: string };

export interface ExpressionScope {
	read(path: string): unknown;
	rule?(id: string): boolean;
	fact?(id: string): unknown;
}

export const EXPRESSION_OPERATORS = [
	"eq",
	"in",
	"exists",
	"empty",
	"and",
	"or",
	"not",
	"rule",
	"fact",
] as const;

/** Absent, false, zero, a blank string or an empty list: what the replaced
 *  builders tested with `?.trim()` and truthiness. */
export function isEmptyValue(value: unknown): boolean {
	if (value === undefined || value === null || value === false || value === 0) return true;
	if (typeof value === "string") return value.trim() === "";
	if (Array.isArray(value)) return value.length === 0;
	return false;
}

/** One own property of a plain data value; nothing inherited, no getters run.
 *  Anything that is not an object has no properties. */
export function ownValue(value: unknown, key: string): unknown {
	return value !== null && typeof value === "object"
		? Object.getOwnPropertyDescriptor(value, key)?.value
		: undefined;
}

/** Read a dotted path from a plain value. Missing segments read as undefined. */
export function readPath(root: unknown, path: string): unknown {
	let current = root;
	for (const segment of path.split(".")) {
		if (current === null || typeof current !== "object") return undefined;
		current = ownValue(current, segment);
	}
	return current;
}

function operatorOf(expression: Expression): (typeof EXPRESSION_OPERATORS)[number] | undefined {
	const keys = Object.keys(expression);
	if (keys.length !== 1) return undefined;
	return EXPRESSION_OPERATORS.find((operator) => operator === keys[0]);
}

export function evaluateExpression(expression: Expression, scope: ExpressionScope): boolean {
	if ("eq" in expression) return scope.read(expression.eq[0]) === expression.eq[1];
	if ("in" in expression) {
		const value = scope.read(expression.in[0]);
		return expression.in[1].some((candidate) => candidate === value);
	}
	if ("exists" in expression) {
		const value = scope.read(expression.exists);
		return value !== undefined && value !== null;
	}
	if ("empty" in expression) return isEmptyValue(scope.read(expression.empty));
	if ("and" in expression) return expression.and.every((child) => evaluateExpression(child, scope));
	if ("or" in expression) return expression.or.some((child) => evaluateExpression(child, scope));
	if ("not" in expression) return !evaluateExpression(expression.not, scope);
	if ("rule" in expression) {
		if (!scope.rule) throw new Error(`rule "${expression.rule}" is not available here`);
		return scope.rule(expression.rule);
	}
	if (!scope.fact) throw new Error(`fact "${expression.fact}" is not available here`);
	return !isEmptyValue(scope.fact(expression.fact));
}

export interface ExpressionReferences {
	paths: string[];
	rules: string[];
	facts: string[];
}

/** Every path, rule and fact an expression names, for validation and inspection. */
export function expressionReferences(expression: Expression): ExpressionReferences {
	const found: ExpressionReferences = { paths: [], rules: [], facts: [] };
	const visit = (node: Expression): void => {
		if ("eq" in node) found.paths.push(node.eq[0]);
		else if ("in" in node) found.paths.push(node.in[0]);
		else if ("exists" in node) found.paths.push(node.exists);
		else if ("empty" in node) found.paths.push(node.empty);
		else if ("and" in node) node.and.forEach(visit);
		else if ("or" in node) node.or.forEach(visit);
		else if ("not" in node) visit(node.not);
		else if ("rule" in node) found.rules.push(node.rule);
		else found.facts.push(node.fact);
	};
	visit(expression);
	return found;
}

const isLiteral = (value: unknown): value is ExpressionLiteral =>
	value === null || ["string", "number", "boolean"].includes(typeof value);

/** Structural problems in an expression that arrived as data. */
export function expressionShapeErrors(expression: unknown, where: string): string[] {
	if (!expression || typeof expression !== "object" || Array.isArray(expression))
		return [`${where}: expression must be an object`];
	// SAFETY: checked to be a non-array object above; its single key is validated next.
	const node = expression as Expression;
	const operator = operatorOf(node);
	if (!operator)
		return [`${where}: expression must have exactly one of ${EXPRESSION_OPERATORS.join(", ")}`];
	const value = ownValue(node, operator);
	switch (operator) {
		case "eq":
			return Array.isArray(value) &&
				value.length === 2 &&
				typeof value[0] === "string" &&
				isLiteral(value[1])
				? []
				: [`${where}: eq takes [path, literal]`];
		case "in":
			return Array.isArray(value) &&
				value.length === 2 &&
				typeof value[0] === "string" &&
				Array.isArray(value[1]) &&
				value[1].every(isLiteral)
				? []
				: [`${where}: in takes [path, [literals]]`];
		case "exists":
		case "empty":
		case "rule":
		case "fact":
			return typeof value === "string" && value.length > 0
				? []
				: [`${where}: ${operator} takes an identifier`];
		case "and":
		case "or":
			return Array.isArray(value) && value.length > 0
				? value.flatMap((child, index) =>
						expressionShapeErrors(child, `${where}.${operator}[${index}]`),
					)
				: [`${where}: ${operator} takes a non-empty list`];
		case "not":
			return expressionShapeErrors(value, `${where}.not`);
	}
}

/** JavaScript truthiness of a path, for templates matching a builder's `x ? … : …`
 *  exactly (a blank string is truthy here, unlike `empty`). Authoring helper. */
export function truthy(path: string): Expression {
	return { and: [{ exists: path }, { not: { in: [path, ["", 0, false]] } }] };
}
