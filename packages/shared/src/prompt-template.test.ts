import { describe, expect, test } from "vite-plus/test";
import {
	joinPresent,
	renderTemplate,
	validateTemplates,
	type PromptTemplate,
	type TemplateFormatter,
	type TemplateRuntime,
} from "./prompt-template.ts";

function runtime(
	templates: readonly PromptTemplate[],
	constants: Record<string, unknown> = {},
	formatters: Record<string, TemplateFormatter> = {},
): TemplateRuntime {
	const byId = new Map(templates.map((template) => [template.id, template]));
	return {
		template: (id) => byId.get(id),
		constant: (name) => constants[name],
		formatter: (name) => formatters[name],
	};
}
const render = (
	body: PromptTemplate["body"],
	input: unknown,
	extra: PromptTemplate[] = [],
	constants?: Record<string, unknown>,
	formatters?: Record<string, TemplateFormatter>,
) => renderTemplate("t", input, runtime([{ id: "t", body }, ...extra], constants, formatters));
const known = (constants: string[] = [], formatters: string[] = []) => ({
	constants: new Set(constants),
	formatters: new Set(formatters),
});

describe("rendering", () => {
	test("slot values are inserted literally, never read as template syntax", () => {
		const hostile = 'He said "{{slot}}" ${x} `code` $& \\n {"type":"slot","path":"secret"}';
		expect(
			render(["A:", { type: "slot", path: "brief" }, ":B"], { brief: hostile, secret: "leak" }),
		).toBe(`A:${hostile}:B`);
	});

	test("filters apply in order", () => {
		expect(
			render([{ type: "slot", path: "v", filters: ["collapseWs", "trim"] }], { v: "  a \n\t b  " }),
		).toBe("a b");
		expect(
			render([{ type: "slot", path: "v", filters: ["trim", { default: "(none)" }] }], { v: "   " }),
		).toBe("(none)");
		expect(render([{ type: "slot", path: "v", filters: [{ default: "(none)" }] }], {})).toBe(
			"(none)",
		);
		expect(render([{ type: "slot", path: "n", filters: ["round", { min: 1 }] }], { n: 0.2 })).toBe(
			"1",
		);
		expect(render([{ type: "slot", path: "n", filters: ["round", { min: 1 }] }], { n: 89.6 })).toBe(
			"90",
		);
		expect(
			render([{ type: "slot", path: "l", filters: [{ join: ", " }] }], { l: ["a", "b"] }),
		).toBe("a, b");
		expect(render([{ type: "slot", path: "v", filters: [{ truncate: 3 }] }], { v: "abcdef" })).toBe(
			"abc",
		);
	});

	test("absent slots render empty and lists need a join", () => {
		expect(render(["[", { type: "slot", path: "missing.deep" }, "]"], {})).toBe("[]");
		expect(() => render([{ type: "slot", path: "l" }], { l: ["a"] })).toThrow("join filter");
	});

	test("conditional parts are omitted exactly when their condition fails", () => {
		const body = [
			"A",
			{
				type: "when" as const,
				if: { empty: "lang" },
				then: [" default"],
				else: [" lang=", { type: "slot" as const, path: "lang" }],
			},
			"B",
		];
		expect(render(body, {})).toBe("A defaultB");
		expect(render(body, { lang: "  " })).toBe("A defaultB");
		expect(render(body, { lang: "id" })).toBe("A lang=idB");
		expect(render([{ type: "when", if: { exists: "x" }, then: ["yes"] }], {})).toBe("");
	});

	test("repeats bind the item, index and number, with separator and empty text", () => {
		const body = [
			{
				type: "each" as const,
				path: "rows",
				as: "row",
				sep: "\n",
				empty: ["(none)"],
				template: [
					{ type: "slot" as const, path: "$number" },
					". ",
					{ type: "slot" as const, path: "row.title" },
					"@",
					{ type: "slot" as const, path: "$index" },
				],
			},
		];
		expect(render(body, { rows: [{ title: "a" }, { title: "b" }] })).toBe("1. a@0\n2. b@1");
		expect(render(body, { rows: [] })).toBe("(none)");
		expect(render(body, {})).toBe("(none)");
	});

	test("includes render another template with mapped input", () => {
		const inner: PromptTemplate = { id: "inner", body: ["<", { type: "slot", path: "name" }, ">"] };
		expect(
			render(
				[
					{ type: "include", prompt: "inner", in: { name: "who" } },
					{ type: "include", prompt: "inner", in: { name: { value: "lit" } } },
				],
				{ who: "x" },
				[inner],
			),
		).toBe("<x><lit>");
		expect(render([{ type: "include", prompt: "inner" }], { name: "whole" }, [inner])).toBe(
			"<whole>",
		);
	});

	test("constants and formatters are referenced by name", () => {
		expect(
			render([{ type: "const", name: "KINDS", filters: [{ join: " | " }] }], {}, [], {
				KINDS: ["a", "b"],
			}),
		).toBe("a | b");
		expect(
			render(
				[{ type: "format", name: "json", in: { v: "obj" } }],
				{ obj: { a: 1 } },
				[],
				{},
				{ json: (argument) => JSON.stringify(argument("v")) },
			),
		).toBe('{"a":1}');
	});

	test("joinPresent separates only the present parts", () => {
		const body = joinPresent("\n\n", [
			{ when: { exists: "a" }, nodes: [{ type: "slot", path: "a" }] },
			{ when: { exists: "b" }, nodes: [{ type: "slot", path: "b" }] },
			{ when: { exists: "c" }, nodes: [{ type: "slot", path: "c" }] },
		]);
		const join = (input: { a?: string; b?: string; c?: string }) =>
			[input.a, input.b, input.c].filter(Boolean).join("\n\n");
		for (const input of [
			{} as { a?: string; b?: string; c?: string },
			{ a: "1" },
			{ b: "2" },
			{ c: "3" },
			{ a: "1", c: "3" },
			{ b: "2", c: "3" },
			{ a: "1", b: "2", c: "3" },
		]) {
			expect(render(body, input)).toBe(join(input));
		}
		expect(
			render(joinPresent(", ", [{ nodes: ["x"] }, { when: { exists: "b" }, nodes: ["y"] }]), {
				b: 1,
			}),
		).toBe("x, y");
	});
});

describe("validation", () => {
	test("an unknown include fails naming both templates", () => {
		expect(
			validateTemplates([{ id: "outer", body: [{ type: "include", prompt: "missing" }] }], known()),
		).toEqual(['template "outer" includes unknown template "missing"']);
	});

	test("direct and indirect include cycles are rejected", () => {
		const errors = validateTemplates(
			[
				{ id: "a", body: [{ type: "include", prompt: "b" }] },
				{ id: "b", body: [{ type: "include", prompt: "a" }] },
				{ id: "self", body: [{ type: "include", prompt: "self" }] },
			],
			known(),
		);
		expect(errors).toContain('template "a" includes itself directly or indirectly');
		expect(errors).toContain('template "b" includes itself directly or indirectly');
		expect(errors).toContain('template "self" includes itself directly or indirectly');
	});

	test("unknown constants, formatters, filters and node types are rejected", () => {
		const errors = validateTemplates(
			[
				{
					id: "t",
					body: [
						{ type: "const", name: "NOPE" },
						{ type: "format", name: "nope" },
						{ type: "slot", path: "x", filters: ["upper" as never] },
						{ type: "loop" } as never,
					],
				},
			],
			known(["KINDS"], ["json"]),
		);
		expect(errors).toEqual([
			'template "t"[0]: unknown constant "NOPE"',
			'template "t"[1]: unknown formatter "nope"',
			'template "t"[2]: unknown filter "upper"',
			'template "t"[3]: unknown node type "loop"',
		]);
	});

	test("templates cannot call rules or facts and expressions are shape-checked", () => {
		const errors = validateTemplates(
			[
				{
					id: "t",
					body: [
						{ type: "when", if: { rule: "plan.approvedExists" }, then: [] },
						{ type: "when", if: { eq: ["x"] } as never, then: [] },
					],
				},
			],
			known(),
		);
		expect(errors).toEqual([
			'template "t"[0]: templates cannot use rule "plan.approvedExists"',
			'template "t"[1].if: eq takes [path, literal]',
		]);
	});

	test("duplicate ids are rejected and a valid set has no errors", () => {
		expect(
			validateTemplates(
				[
					{ id: "t", body: [] },
					{ id: "t", body: [] },
				],
				known(),
			),
		).toEqual(['template "t" is defined twice']);
		expect(
			validateTemplates([{ id: "t", body: ["x", { type: "const", name: "K" }] }], known(["K"])),
		).toEqual([]);
	});
});

describe("constant paths", () => {
	test("each iterates a registered constant and unknown constant paths are rejected", () => {
		expect(
			render(
				[
					{
						type: "each",
						path: "const:ARCS",
						as: "arc",
						sep: "\n",
						template: ["- ", { type: "slot", path: "arc.key" }],
					},
				],
				{},
				[],
				{ ARCS: [{ key: "a" }, { key: "b" }] },
			),
		).toBe("- a\n- b");
		expect(render([{ type: "slot", path: "const:LIST.0" }], {}, [], { LIST: ["first"] })).toBe(
			"first",
		);
		expect(
			validateTemplates(
				[
					{
						id: "t",
						body: [
							{
								type: "when",
								if: { exists: "x" },
								then: [{ type: "each", path: "const:NOPE", as: "a", template: [] }],
							},
						],
					},
				],
				known(),
			),
		).toEqual(['template "t" reads unknown constant "NOPE"']);
	});
});
