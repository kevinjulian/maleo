import { expect, test } from "bun:test";
import ts from "typescript";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import manifest from "./__tests__/support/prompt-coverage.json";
import callCoverage from "./__tests__/support/prompt-call-coverage.json";
import { PROMPT_MODULES } from "./prompt-definitions.ts";
import { agentTemplateCatalog } from "./template-catalog.ts";

const root = resolve(import.meta.dir, "../../../../../..");

test("every reviewed prompt owner exports production-consumed fixed fragments", () => {
	for (const entry of manifest) {
		const module = PROMPT_MODULES.find((item) => item.source === entry.source);
		expect(module, entry.source).toBeDefined();
		const source = readFileSync(resolve(root, entry.source), "utf8");
		expect(source).toContain("PROMPT_FRAGMENTS");
		expect(new Set(Object.values(module!.fragments).map((fragment) => fragment.owner))).toEqual(
			new Set(entry.owners),
		);
		for (const fragment of Object.values(module!.fragments))
			expect(fragment.parts.length).toBe(fragment.variables.length + 1);
	}
});

test("new unreviewed text-prompt call sites fail coverage", async () => {
	const actual: Record<string, number> = {};
	for await (const path of new Bun.Glob("**/*.ts").scan({ cwd: resolve(root, "apps/api/src") })) {
		if (
			path.includes(".test.") ||
			path.includes("__tests__/") ||
			path.includes("-prompt-definitions")
		)
			continue;
		const text = readFileSync(resolve(root, "apps/api/src", path), "utf8");
		const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
		let count = 0;
		const visit = (node: ts.Node) => {
			if (
				ts.isCallExpression(node) &&
				ts.isIdentifier(node.expression) &&
				node.expression.text === "runPrompt"
			)
				count++;
			ts.forEachChild(node, visit);
		};
		visit(sf);
		if (count) actual[`apps/api/src/${path}`] = count;
	}
	expect(actual).toEqual(callCoverage);
});

test("interpolation metadata agrees with expressions the production builders evaluate", () => {
	const printer = ts.createPrinter();
	for (const entry of manifest) {
		const module = PROMPT_MODULES.find((item) => item.source === entry.source)!;
		const fragments = module.fragments;
		const keyFor = (node: ts.Node): string | undefined => {
			if (!ts.isPropertyAccessExpression(node) || node.name.text !== "parts") return;
			const parent = node.expression;
			if (
				ts.isPropertyAccessExpression(parent) &&
				ts.isIdentifier(parent.expression) &&
				parent.expression.text === "PROMPT_FRAGMENTS"
			)
				return parent.name.text;
		};
		const canonical = (expression: ts.Expression, sf: ts.SourceFile): string => {
			const result = ts.transform(expression, [
				(context) => {
					const visit: ts.Visitor = (node) => {
						if (ts.isStringLiteral(node)) return ts.factory.createStringLiteral(node.text);
						if (ts.isTemplateHead(node)) return ts.factory.createTemplateHead(node.text);
						if (ts.isTemplateMiddle(node)) return ts.factory.createTemplateMiddle(node.text);
						if (ts.isTemplateTail(node)) return ts.factory.createTemplateTail(node.text);
						if (ts.isNoSubstitutionTemplateLiteral(node))
							return ts.factory.createStringLiteral(node.text);
						if (
							ts.isElementAccessExpression(node) &&
							node.argumentExpression?.getText(sf) === "0"
						) {
							const key = keyFor(node.expression);
							if (key && fragments[key])
								return ts.factory.createStringLiteral(fragments[key]!.parts[0]!);
						}
						if (
							ts.isCallExpression(node) &&
							ts.isIdentifier(node.expression) &&
							node.expression.text === "renderPromptParts"
						) {
							const key = node.arguments[0] && keyFor(node.arguments[0]);
							const values = node.arguments[1];
							if (key && fragments[key] && values && ts.isArrayLiteralExpression(values)) {
								const fragment = fragments[key]!;
								return ts.factory.createTemplateExpression(
									ts.factory.createTemplateHead(fragment.parts[0]!),
									values.elements.map((value, index) => {
										const expanded = ts.visitNode(value, visit);
										if (!expanded || !ts.isExpression(expanded))
											throw new Error("Expected prompt expression");
										const part = fragment.parts[index + 1]!;
										return ts.factory.createTemplateSpan(
											expanded,
											index === values.elements.length - 1
												? ts.factory.createTemplateTail(part)
												: ts.factory.createTemplateMiddle(part),
										);
									}),
								);
							}
						}
						return ts.visitEachChild(node, visit, context);
					};
					return (node) => ts.visitNode(node, visit, ts.isExpression)!;
				},
			]);
			const text = printer.printNode(ts.EmitHint.Expression, result.transformed[0]!, sf);
			result.dispose();
			// Compare tokens, not layout: the printer keeps source line breaks, and a
			// formatter may wrap either side. String and template contents stay exact.
			const printed = ts.createSourceFile("canonical.ts", text, ts.ScriptTarget.Latest, true);
			const tokens = (node: ts.Node): string[] =>
				node.getChildCount(printed) === 0
					? [node.getText(printed)]
					: node.getChildren(printed).flatMap(tokens);
			return tokens(printed).join(" ");
		};
		for (const path of [entry.source, entry.definition]) {
			const sf = ts.createSourceFile(
				path,
				readFileSync(resolve(root, path), "utf8"),
				ts.ScriptTarget.Latest,
				true,
			);
			const visit = (node: ts.Node) => {
				if (
					ts.isCallExpression(node) &&
					ts.isIdentifier(node.expression) &&
					node.expression.text === "renderPromptParts"
				) {
					const key = node.arguments[0] && keyFor(node.arguments[0]);
					const args = node.arguments[1];
					if (key && args && ts.isArrayLiteralExpression(args)) {
						const fragment = fragments[key];
						expect(fragment, `${entry.source}:${key}`).toBeDefined();
						expect(args.elements.length).toBe(fragment!.variables.length);
						for (const [index, expression] of args.elements.entries()) {
							const expectedSource = ts.createSourceFile(
								"expression.ts",
								`const value = (${fragment!.variables[index]!.source});`,
								ts.ScriptTarget.Latest,
								true,
							);
							const statement = expectedSource.statements[0];
							if (!statement || !ts.isVariableStatement(statement))
								throw new Error("Expected variable source");
							const initializer = statement.declarationList.declarations[0]!.initializer!;
							const expected = ts.isParenthesizedExpression(initializer)
								? initializer.expression
								: initializer;
							expect(canonical(expression, sf), `${entry.source}:${key}:${index}`).toBe(
								canonical(expected, expectedSource),
							);
						}
					}
				}
				ts.forEachChild(node, visit);
			};
			visit(sf);
		}
	}
});

test("prompts are linked to consumers and fixed agent constants are resolved", () => {
	const catalog = agentTemplateCatalog();
	const linked = new Set(
		catalog.relationships
			.filter((relation) => relation.kind === "uses_prompt")
			.map((relation) => relation.to),
	);
	for (const item of catalog.definitions.filter((definition) => definition.kind === "prompt"))
		expect(linked.has(item.id), item.id).toBe(true);
	expect(
		catalog.definitions
			.find((item) => item.id === "prompt:instructions:VIDEO")
			?.instructions?.join("\n"),
	).toContain("ASK ONLY WHEN TRULY AMBIGUOUS");
	expect(
		catalog.definitions.find((item) => item.id === "prompt:image:compileImagePrompt")?.composition,
	).toEqual([
		"output",
		"subject",
		"referenceText",
		"scene",
		"composition",
		"style",
		"lightingColor",
		"include",
		"avoid",
		"negative",
	]);
});
