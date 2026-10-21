import { defineRule } from "vite-plus/lint/plugins";

import {
	classifyWideningTarget,
	createTypeEnvironment,
	isKnownEvidenceExpression,
	type TypeEnvironment,
	type WideningTarget,
	type WideningTargetKind,
} from "../shared/dictionary-types.ts";

import type { ESTree, Scope, SourceCode, Variable } from "vite-plus/lint/plugins";

type FunctionExpression = ESTree.ArrowFunctionExpression | ESTree.Function;

function unwrapExpression(expression: ESTree.Expression): ESTree.Expression {
	let current = expression;
	while (
		current.type === "ParenthesizedExpression" ||
		current.type === "TSAsExpression" ||
		current.type === "TSSatisfiesExpression" ||
		current.type === "TSTypeAssertion" ||
		current.type === "TSNonNullExpression"
	) {
		current = current.expression;
	}
	return current;
}

function resolveVariable(
	sourceCode: SourceCode,
	identifier: ESTree.IdentifierReference,
): Variable | null {
	let scope: Scope | null = sourceCode.getScope(identifier);
	while (scope !== null) {
		const variable = scope.set.get(identifier.name);
		if (variable !== undefined) return variable;
		scope = scope.upper;
	}
	return null;
}

function variableDeclarator(variable: Variable): ESTree.VariableDeclarator | null {
	if (variable.defs.length !== 1) return null;
	const [definition] = variable.defs;
	return definition?.type === "Variable" && definition.node.type === "VariableDeclarator"
		? definition.node
		: null;
}

function isStableConstVariable(variable: Variable, declarator: ESTree.VariableDeclarator): boolean {
	return (
		declarator.parent.type === "VariableDeclaration" &&
		declarator.parent.kind === "const" &&
		variable.references.every((reference) => reference.init || !reference.isWrite())
	);
}

function hasKnownEvidence(
	sourceCode: SourceCode,
	expression: ESTree.Expression,
	visitedVariables = new Set<Variable>(),
): boolean {
	if (isKnownEvidenceExpression(expression)) return true;
	const unwrapped = unwrapExpression(expression);
	if (unwrapped.type !== "Identifier") return false;
	const variable = resolveVariable(sourceCode, unwrapped);
	if (variable === null || visitedVariables.has(variable)) return false;
	const declarator = variableDeclarator(variable);
	if (
		declarator === null ||
		declarator.init === null ||
		!isStableConstVariable(variable, declarator)
	) {
		return false;
	}
	visitedVariables.add(variable);
	return hasKnownEvidence(sourceCode, declarator.init, visitedVariables);
}

function annotationTarget(
	annotation: ESTree.TSTypeAnnotation | null | undefined,
	environment: TypeEnvironment,
): WideningTarget | null {
	return annotation === null || annotation === undefined
		? null
		: classifyWideningTarget(annotation.typeAnnotation, environment);
}

function enclosingFunction(node: ESTree.Node): FunctionExpression | null {
	let current: ESTree.Node | null = node.parent;
	while (current !== null && current.type !== "Program") {
		if (
			current.type === "ArrowFunctionExpression" ||
			current.type === "FunctionDeclaration" ||
			current.type === "FunctionExpression"
		) {
			return current;
		}
		current = current.parent;
	}
	return null;
}

function sourceKeyName(sourceCode: SourceCode, key: ESTree.PropertyKey): string {
	if (key.type === "Identifier" || key.type === "PrivateIdentifier") return key.name;
	if (key.type === "Literal") return String(key.value);
	return sourceCode.getText(key);
}

function functionName(sourceCode: SourceCode, owner: FunctionExpression | null): string {
	if (owner === null) return "anonymous function";
	if (owner.id !== null) return owner.id.name;
	const parent = owner.parent;
	if (parent.type === "VariableDeclarator" && parent.id.type === "Identifier")
		return parent.id.name;
	if (parent.type === "MethodDefinition") return sourceKeyName(sourceCode, parent.key);
	return "anonymous function";
}

function isEmptyObjectExpression(expression: ESTree.Expression): boolean {
	const unwrapped = unwrapExpression(expression);
	return unwrapped.type === "ObjectExpression" && unwrapped.properties.length === 0;
}

function isDictionaryAccumulatorTarget(destination: WideningTarget): boolean {
	return destination.kind === "open dictionary" || destination.kind === "generic container";
}

function hasParentAssertion(node: ESTree.Node): boolean {
	return node.parent?.type === "TSAsExpression" || node.parent?.type === "TSTypeAssertion";
}

/**
 * Where a widened value sits, as distinct from what it was widened INTO.
 *
 * Split out because the two axes carry different true-positive rates and,
 * separately, live in different places: `open dictionary` measures ~11% genuine
 * on a binding against ~43% on a return, and 17 of its 20 assertion findings are
 * in tests while 39 of its 43 binding findings are in source. One rule id over
 * both axes can only carry one severity, so it would force one disposition
 * across all of that.
 */
export type WideningPosition = "assertion" | "binding" | "property" | "return";

/** Detect sound syntactic cases where a known value is explicitly widened and loses evidence. */
function createWideningRule(target: WideningTargetKind, position: WideningPosition) {
	return defineRule({
		meta: {
			type: "problem",
			docs: {
				description: `Disallow syntactically established values from flowing into an explicit ${target} type on a ${position}, which discards useful evidence.`,
			},
			messages: {
				widening:
					"The explicit {{target}} type on {{subject}} discards known type evidence. Keep inference, validate with `satisfies`, or use a named owner contract.",
			},
		},
		createOnce(context) {
			let environment: TypeEnvironment | null = null;

			const reportFlow = (
				expression: ESTree.Expression,
				destination: WideningTarget | null,
				subject: string,
				at: WideningPosition,
			) => {
				if (destination === null) return;
				if (destination.kind !== target || at !== position) return;
				if (
					isDictionaryAccumulatorTarget(destination) &&
					isEmptyObjectExpression(expression)
				) {
					return;
				}
				if (!hasKnownEvidence(context.sourceCode, expression)) return;
				context.report({
					node: expression,
					messageId: "widening",
					data: { subject, target: destination.kind },
				});
			};

		const targetFromAnnotation = (annotation: ESTree.TSTypeAnnotation | null | undefined) =>
			environment === null ? null : annotationTarget(annotation, environment);

		return {
			Program(node) {
				environment = createTypeEnvironment(node);
			},
			VariableDeclarator(node) {
				if (node.init === null || node.id.type !== "Identifier") return;
				reportFlow(
					node.init,
					targetFromAnnotation(node.id.typeAnnotation),
					`binding \`${node.id.name}\``,
					"binding",
				);
			},
			PropertyDefinition(node) {
				if (node.value === null) return;
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
					"property",
				);
			},
			AccessorProperty(node) {
				if (node.value === null) return;
				reportFlow(
					node.value,
					targetFromAnnotation(node.typeAnnotation),
					`property \`${sourceKeyName(context.sourceCode, node.key)}\``,
					"property",
				);
			},
			AssignmentExpression(node) {
				if (node.operator !== "=" || node.left.type !== "Identifier") return;
				const variable = resolveVariable(context.sourceCode, node.left);
				if (variable === null) return;
				const declarator = variableDeclarator(variable);
				if (declarator === null || declarator.id.type !== "Identifier") return;
				reportFlow(
					node.right,
					targetFromAnnotation(declarator.id.typeAnnotation),
					`binding \`${declarator.id.name}\``,
					"binding",
				);
			},
			ReturnStatement(node) {
				if (node.argument === null) return;
				const owner = enclosingFunction(node);
				reportFlow(
					node.argument,
					targetFromAnnotation(owner?.returnType),
					`return value of \`${functionName(context.sourceCode, owner)}\``,
					"return",
				);
			},
			ArrowFunctionExpression(node) {
				if (node.body.type === "BlockStatement") return;
				reportFlow(
					node.body,
					targetFromAnnotation(node.returnType),
					`return value of \`${functionName(context.sourceCode, node)}\``,
					"return",
				);
			},
			TSAsExpression(node) {
				if (environment === null || hasParentAssertion(node)) return;
				reportFlow(
					node.expression,
					classifyWideningTarget(node.typeAnnotation, environment),
					"assertion",
					"assertion",
				);
			},
			TSTypeAssertion(node) {
				if (environment === null || hasParentAssertion(node)) return;
				reportFlow(
					node.expression,
					classifyWideningTarget(node.typeAnnotation, environment),
					"assertion",
					"assertion",
				);
			},
		};
	},
	});
}

const TARGET_SLUGS = {
	"anonymous object": "anonymous-object",
	"generic container": "generic-container",
	object: "object",
	"open dictionary": "open-dictionary",
	unknown: "unknown",
} as const satisfies Record<WideningTargetKind, string>;

const POSITIONS = ["assertion", "binding", "property", "return"] as const;

/**
 * One rule per target-and-position pair, sharing the detection above.
 *
 * Every pair gets an id, not only the pairs with findings today: a plugin rule
 * that is not registered is a construct nothing checks, and the combination
 * currently at zero is the one most likely to be introduced unnoticed.
 */
export const wideningRules = Object.fromEntries(
	Object.entries(TARGET_SLUGS).flatMap(([target, slug]) =>
		POSITIONS.map((position) => [
			`no-widening-${slug}-${position}`,
			createWideningRule(target as WideningTargetKind, position),
		]),
	),
);
