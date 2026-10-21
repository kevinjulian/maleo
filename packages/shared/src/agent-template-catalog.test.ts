import { describe, expect, test } from "vite-plus/test";
import { agentTemplateCatalogSchema, agentTemplateRevision } from "./agent-template-catalog.ts";

const provenance = { kind: "declared", source: "example.ts" };
const definition = {
	id: "tool:example",
	kind: "tool",
	label: "Example",
	description: "Inspect",
	source: "example.ts",
	revision: "1",
	contentTypes: ["video"],
	provenance: { "*": provenance },
};
const catalog = { schemaVersion: 2, revision: "1", definitions: [definition], relationships: [] };

describe("agent template catalog", () => {
	test("accepts definitions and resolving relationships", () => {
		expect(
			agentTemplateCatalogSchema.parse({
				...catalog,
				relationships: [{ from: definition.id, to: definition.id, kind: "available", provenance }],
			}).definitions[0]?.steps,
		).toEqual([]);
	});
	test("rejects duplicate identities and missing relationship or step targets", () => {
		expect(
			agentTemplateCatalogSchema.safeParse({ ...catalog, definitions: [definition, definition] })
				.success,
		).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...catalog,
				relationships: [{ from: definition.id, to: "missing", kind: "next" }],
			}).success,
		).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...catalog,
				definitions: [{ ...definition, steps: ["missing"] }],
			}).success,
		).toBe(false);
	});
	test("rejects invalid kinds and private extra fields", () => {
		expect(
			agentTemplateCatalogSchema.safeParse({
				...catalog,
				relationships: [{ from: definition.id, to: definition.id, kind: "execute" }],
			}).success,
		).toBe(false);
		expect(agentTemplateCatalogSchema.safeParse({ ...catalog, project: "private" }).success).toBe(
			false,
		);
	});
	test("revisions track content, not object insertion order", () => {
		expect(agentTemplateRevision({ text: "fixed", defaults: { count: 4 } })).toBe(
			agentTemplateRevision({ defaults: { count: 4 }, text: "fixed" }),
		);
		expect(agentTemplateRevision({ text: "fixed" })).not.toBe(
			agentTemplateRevision({ text: "changed" }),
		);
		expect(agentTemplateRevision({ defaults: { count: 4 } })).not.toBe(
			agentTemplateRevision({ defaults: { count: 5 } }),
		);
	});
	test("unsupported versions report a compatibility error", () => {
		for (const schemaVersion of [0, 1, 3, "2", undefined]) {
			const parsed = agentTemplateCatalogSchema.safeParse({ ...catalog, schemaVersion });
			expect(parsed.success).toBe(false);
			if (!parsed.success)
				expect(parsed.error.message).toContain("Unsupported agent template catalog schema version");
		}
	});
	test("schema 2 carries fact fidelity separately from unresolved input", () => {
		const normalized = agentTemplateCatalogSchema.parse(catalog);
		const fidelity = { kind: "derived", source: "example.ts" };
		const predicate = {
			id: "condition:test",
			source: "example.ts",
			expression: "(input) => input.enabled",
			provenance: fidelity,
			resolution: "unresolved",
			boundaries: [{ source: "helper.ts", symbol: "helper", reason: "Shared formatter" }],
		};
		const recipe = {
			id: "prompt:example",
			source: "example.ts",
			provenance: fidelity,
			kind: "fragment",
			parts: ["Before ", " after"],
			binding: "(input) => [input.brief]",
			values: ["input.brief"],
			inputs: [
				{ name: "input.brief", type: "string", source: "input.brief", resolution: "unresolved" },
			],
			defaults: [],
			transforms: [],
			children: [],
		};
		const current = {
			...normalized,
			definitions: [
				{
					...normalized.definitions[0]!,
					predicates: [predicate],
					recipe,
					provenance: {
						recipe: { kind: "derived", source: "example.ts" },
						output: { kind: "opaque", source: "helper.ts" },
					},
					execution: {
						kind: "branch",
						conditionId: predicate.id,
						children: [{ kind: "call", operationId: definition.id, children: [], terminal: true }],
					},
				},
			],
			relationships: [
				{
					from: definition.id,
					to: definition.id,
					kind: "conditional",
					provenance: { kind: "derived", source: "example.ts" },
					conditions: [{ id: predicate.id, outcome: false }],
				},
			],
		};
		const parsed = agentTemplateCatalogSchema.parse(current);
		expect(parsed.definitions[0]?.recipe?.inputs[0]?.resolution).toBe("unresolved");
		expect(parsed.definitions[0]?.provenance?.recipe?.kind).toBe("derived");
		expect(parsed.definitions[0]?.provenance?.output?.kind).toBe("opaque");
		expect(parsed.relationships[0]?.conditions?.[0]?.outcome).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...current,
				definitions: [
					{
						...current.definitions[0],
						execution: { kind: "call", operationId: "missing", children: [] },
					},
				],
			}).success,
		).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...current,
				definitions: [
					{
						...current.definitions[0],
						recipe: { ...recipe, inputs: [{ ...recipe.inputs[0], value: "PRIVATE" }] },
					},
				],
			}).success,
		).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...current,
				relationships: [
					{ ...current.relationships[0], conditions: [{ id: "missing", outcome: true }] },
				],
			}).success,
		).toBe(false);
	});
	test("schema 2 rejects missing provenance and malformed control structure", () => {
		expect(
			agentTemplateCatalogSchema.safeParse({
				...catalog,
				definitions: [{ ...definition, provenance: undefined }],
			}).success,
		).toBe(false);
		const normalized = agentTemplateCatalogSchema.parse(catalog);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...normalized,
				definitions: [{ ...normalized.definitions[0], execution: { kind: "scope", children: [] } }],
			}).success,
		).toBe(false);
		expect(
			agentTemplateCatalogSchema.safeParse({
				...normalized,
				relationships: [{ from: definition.id, to: definition.id, kind: "next" }],
			}).success,
		).toBe(false);
	});
});

test("optional presentation metadata remains compatible and contributes to content revisions", () => {
	const original = agentTemplateCatalogSchema.parse(catalog).definitions[0]!;
	const next = agentTemplateCatalogSchema.parse({
		...catalog,
		definitions: [
			{
				...definition,
				summary: "Inspect a project.",
				capabilities: ["Project inspection"],
				purpose: "Agent behavior",
			},
		],
	}).definitions[0]!;
	expect(original.summary).toBeUndefined();
	expect(next.capabilities).toEqual(["Project inspection"]);
	expect(agentTemplateRevision(next)).not.toBe(agentTemplateRevision(original));
	expect(next.id).toBe(original.id);
});
