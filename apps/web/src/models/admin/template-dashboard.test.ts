import { expect, test } from "vite-plus/test";
import { agentTemplateCatalogSchema, type AgentTemplateCatalog } from "@maleo/shared";
import fixture from "../../../visual/fixtures/agent-templates.json";
import {
	scopedTemplates,
	templateUsage,
	searchTemplates,
	filterTemplates,
	templateStagePipeline,
	dependencyReferences,
	EMPTY_TEMPLATE_FILTERS,
} from "./template-dashboard.ts";
const catalog = agentTemplateCatalogSchema.parse(fixture);
const scope = "workflow:plan_story";
test("pipeline scope follows actual dependency closure and optional tools stay separate", () => {
	const scoped = scopedTemplates(catalog, scope);
	expect(scoped.definitions.some((item) => item.id === "operation:plan_story:clarify")).toBe(true);
	expect(
		scoped.definitions.some((item) => item.id === "prompt:clarification:storyClarificationPrompt"),
	).toBe(true);
	expect(scoped.relationships.some((edge) => edge.kind === "available")).toBe(false);
	const onlyAvailable = catalog.relationships.find(
		(edge) =>
			edge.from === scope &&
			edge.kind === "available" &&
			!scoped.definitions.some((item) => item.id === edge.to),
	)!;
	expect(
		scopedTemplates(catalog, scope, true).definitions.some((item) => item.id === onlyAvailable.to),
	).toBe(true);
	expect(scopedTemplates(catalog, "missing").definitions).toHaveLength(0);
});
test("usage traversal handles cycles and excludes availability/profile links from impact", () => {
	const edges = [
		{ from: "workflow:w", to: "operation:a", kind: "contains" },
		{ from: "operation:a", to: "prompt:p", kind: "uses_prompt" },
		{ from: "prompt:p", to: "operation:a", kind: "conditional" },
		{ from: "workflow:optional", to: "prompt:p", kind: "available" },
		{ from: "workflow:profile", to: "prompt:p", kind: "profile" },
	] as const;
	const synthetic: AgentTemplateCatalog = {
		...catalog,
		definitions: [
			"workflow:w",
			"workflow:optional",
			"workflow:profile",
			"operation:a",
			"prompt:p",
		].map((id) => ({
			...catalog.definitions[0]!,
			id,
			kind: id.startsWith("workflow")
				? "workflow"
				: id.startsWith("operation")
					? "operation"
					: "prompt",
		})),
		relationships: [...edges],
	};
	const usage = templateUsage(synthetic, "prompt:p");
	expect(usage.pipelines.map((item) => item.id)).toEqual(["workflow:w"]);
	expect(usage.optional).toHaveLength(1);
	expect(usage.ids.size).toBe(3);
	const references = dependencyReferences(synthetic, "workflow:w");
	expect(references.map((entry) => entry.item.id)).toEqual(["operation:a", "prompt:p"]);
	expect(
		references.find((entry) => entry.item.id === "prompt:p")?.via.map((entry) => entry.id),
	).toEqual(["operation:a"]);
	expect(dependencyReferences(synthetic, "workflow:optional")).toEqual([]);
});
test("ranked search includes aliases/IDs/source and optional prompt body with snippets", () => {
	const exact = searchTemplates(catalog, catalog.definitions, "plan_story", false);
	expect(exact[0]?.item.id).toBe(scope);
	const prompt = catalog.definitions.find(
		(item) => item.kind === "prompt" && item.instructions?.some((text) => text.includes("story")),
	)!;
	const unique = "unique-body-only-maintenance-phrase";
	const modified = { ...prompt, instructions: [unique] };
	expect(searchTemplates(catalog, [modified], unique, false)).toHaveLength(0);
	expect(searchTemplates(catalog, [modified], unique, true)[0]?.snippet).toContain(unique);
	expect(searchTemplates(catalog, [prompt], prompt.source, false)).toHaveLength(1);
	const bodyMatch = {
		...prompt,
		description: "These are templates",
		instructions: ["You are a maintenance assistant."],
	};
	expect(searchTemplates(catalog, [bodyMatch], "You are", true)[0]?.snippet).toContain(
		"You are a maintenance assistant",
	);
});
test("metadata facets and local expansion preserve definition identity", () => {
	const workflow = catalog.definitions.find((item) => item.id === scope)!;
	const stages = templateStagePipeline(catalog, workflow, EMPTY_TEMPLATE_FILTERS);
	expect(stages.map((stage) => stage.item.id)).toEqual(workflow.steps);
	expect(stages.slice(0, -1).every((stage) => stage.connection?.kind === "next")).toBe(true);
	expect(stages.at(-1)?.connection).toBeUndefined();
	const filteredStages = templateStagePipeline(catalog, workflow, {
		...EMPTY_TEMPLATE_FILTERS,
		source: "missing",
	});
	expect(filteredStages.map((stage) => stage.item.id)).toEqual(workflow.steps);
	expect(filteredStages.every((stage) => !stage.matches)).toBe(true);
	const prompt = catalog.definitions.find(
		(item) => item.id === "prompt:clarification:storyClarificationPrompt",
	)!;
	const sourceMatch = templateStagePipeline(catalog, workflow, {
		...EMPTY_TEMPLATE_FILTERS,
		source: prompt.source,
	});
	expect(sourceMatch.map((stage) => stage.item.id)).toEqual(workflow.steps);
	expect(sourceMatch.some((stage) => stage.matches && stage.referenceIds.has(prompt.id))).toBe(
		true,
	);
	const filters = {
		...EMPTY_TEMPLATE_FILTERS,
		kind: "tool",
		effect: "generate",
		prompt: "composed",
	};
	expect(
		filterTemplates(catalog.definitions, filters).every(
			(item) =>
				item.kind === "tool" && item.effect === "generate" && item.promptMode === "composed",
		),
	).toBe(true);
	expect(
		filterTemplates(catalog.definitions, { ...EMPTY_TEMPLATE_FILTERS, repeats: true }).every(
			(item) => !!item.repeat,
		),
	).toBe(true);
});
