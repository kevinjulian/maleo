import { expect, test } from "vite-plus/test";
import {
	evaluateExpression,
	expressionReferences,
	expressionShapeErrors,
	isEmptyValue,
	readPath,
	type Expression,
} from "./workflow-expression.ts";

const values: Record<string, unknown> = {
	kind: "batch",
	n: 0,
	list: [],
	name: " x ",
	blank: "  ",
	nested: { flag: true },
};
const scope = {
	read: (path: string) => readPath(values, path),
	rule: (id: string) => id === "yes",
	fact: (id: string) => (id === "set" ? "one_shot" : undefined),
};
const ev = (expression: Expression) => evaluateExpression(expression, scope);

test("every operator evaluates against the scope", () => {
	expect(ev({ eq: ["kind", "batch"] })).toBe(true);
	expect(ev({ eq: ["kind", "none"] })).toBe(false);
	expect(ev({ in: ["kind", ["none", "batch"]] })).toBe(true);
	expect(ev({ in: ["kind", ["none"]] })).toBe(false);
	expect(ev({ exists: "n" })).toBe(true);
	expect(ev({ exists: "missing" })).toBe(false);
	expect(ev({ empty: "list" })).toBe(true);
	expect(ev({ empty: "blank" })).toBe(true);
	expect(ev({ empty: "name" })).toBe(false);
	expect(ev({ empty: "nested.flag" })).toBe(false);
	expect(ev({ and: [{ exists: "kind" }, { empty: "n" }] })).toBe(true);
	expect(ev({ and: [{ exists: "kind" }, { exists: "missing" }] })).toBe(false);
	expect(ev({ or: [{ exists: "missing" }, { eq: ["kind", "batch"] }] })).toBe(true);
	expect(ev({ not: { exists: "missing" } })).toBe(true);
	expect(ev({ rule: "yes" })).toBe(true);
	expect(ev({ rule: "no" })).toBe(false);
	expect(ev({ fact: "set" })).toBe(true);
	expect(ev({ fact: "unset" })).toBe(false);
});

test("rules and facts need a scope that provides them", () => {
	expect(() => evaluateExpression({ rule: "x" }, { read: () => undefined })).toThrow(
		'rule "x" is not available here',
	);
	expect(() => evaluateExpression({ fact: "x" }, { read: () => undefined })).toThrow(
		'fact "x" is not available here',
	);
});

test("emptiness follows the builders' truthiness", () => {
	for (const value of [undefined, null, false, 0, "", "  ", []])
		expect(isEmptyValue(value)).toBe(true);
	for (const value of [true, 1, "a", [0], {}]) expect(isEmptyValue(value)).toBe(false);
});

test("references and shape errors", () => {
	expect(
		expressionReferences({
			and: [{ eq: ["a", 1] }, { not: { rule: "r" } }, { fact: "f" }, { in: ["b", []] }],
		}),
	).toEqual({ paths: ["a", "b"], rules: ["r"], facts: ["f"] });
	expect(expressionShapeErrors({ eq: ["a", 1] }, "x")).toEqual([]);
	expect(expressionShapeErrors({ eq: ["a", 1], not: {} }, "x")).toHaveLength(1);
	expect(expressionShapeErrors({ and: [] }, "x")).toEqual(["x: and takes a non-empty list"]);
	expect(expressionShapeErrors({ in: ["a", "b"] }, "x")).toEqual([
		"x: in takes [path, [literals]]",
	]);
	expect(expressionShapeErrors({ not: { exists: 3 } }, "x")).toEqual([
		"x.not: exists takes an identifier",
	]);
	expect(expressionShapeErrors("nope", "x")).toEqual(["x: expression must be an object"]);
});
