import { expect, test } from "vite-plus/test";
import { agentTemplateCatalogSchema, type AgentTemplateCatalog } from "@maleo/shared";
import fixture from "../../../visual/fixtures/agent-templates.json";
import {
	workflowFacts,
	workflowStages,
	consumerContexts,
	normalizeDiscovery,
	inspectSelection,
	workflowCoverage,
	templateParent,
} from "./template-discovery.ts";
const catalog = agentTemplateCatalogSchema.parse(fixture);
const workflow = catalog.definitions.find((item) => item.id === "workflow:plan_story")!;
const prompt = catalog.definitions.find(
	(item) => item.id === "prompt:clarification:storyClarificationPrompt",
)!;

test("overview maps published facts and explicitly lacks runtime host without guessing", () => {
	const facts = workflowFacts(workflow);
	expect(facts).toHaveLength(6);
	expect(facts.find((fact) => fact.name === "Runtime authority")?.value).toContain(
		"Runtime host not exposed",
	);
	expect(facts.find((fact) => fact.name === "Trigger / entry point")?.value).toContain(
		workflow.entryPoint!,
	);
	const missing = workflowFacts({
		...workflow,
		entryPoint: undefined,
		input: undefined,
		output: [],
	});
	expect(missing.filter((fact) => fact.fidelity === "not exposed")).toHaveLength(3);
	expect(facts.every((fact) => fact.fidelity !== "verified")).toBe(true);
});
test("nested contextual match preserves stage order and canonical dependencies", () => {
	const stages = workflowStages(catalog, workflow, undefined, prompt.id);
	expect(stages.map((stage) => stage.item.id)).toEqual(workflow.steps);
	const matches = stages.filter((stage) => stage.matches);
	expect(matches.length).toBeGreaterThan(0);
	expect(matches.some((stage) => stage.matchingIds.has(prompt.id))).toBe(true);
	expect(matches.some((stage) => stage.pathIds.has("operation:planning:generate-questions"))).toBe(
		true,
	);
	expect(
		matches
			.flatMap((stage) => stage.definitions)
			.filter((item) => item.id === prompt.id)
			.every((item) => item === prompt),
	).toBe(true);
	expect(
		workflowStages(catalog, workflow, undefined, "absent-in-all-definitions").every(
			(stage) => !stage.matches,
		),
	).toBe(true);
});
test("normalization prunes foreign stages/trails and retains unavailable selections", () => {
	const first = workflow.steps[0]!;
	const state = normalizeDiscovery(catalog, {
		section: "workflows",
		workflow: workflow.id,
		stage: "foreign",
		open: ["foreign", first, first],
		inspect: "removed:prompt",
		trail: [{ id: "removed" }, { id: prompt.id, workflow: "foreign" }],
	});
	expect(state.open).toBeUndefined();
	expect(state.stage).toBe("foreign");
	expect(state.inspect).toBeUndefined();
	expect(state.peek).toBe("removed:prompt");
	expect(state.trail).toBeUndefined();
	expect(
		normalizeDiscovery(catalog, {
			section: "workflows",
			workflow: workflow.id,
			stage: first,
			inspect: workflow.id,
		}).stage,
	).toBe(first);
	const missing = normalizeDiscovery(catalog, {
		section: "workflows",
		workflow: "removed",
		open: [first],
	});
	expect(missing.workflow).toBe("removed");
	expect(missing.open).toBeUndefined();
});
test("inspector trails remain bounded and consumer context change is deliberate", () => {
	const state = inspectSelection(
		{
			section: "workflows",
			workflow: workflow.id,
			peek: prompt.id,
			trail: Array.from({ length: 16 }, () => ({ id: prompt.id })),
		},
		workflow,
	);
	expect(state.trail).toHaveLength(16);
	expect(state.omitted).toBe(true);
	expect(state.trail?.at(-1)?.id).toBe(prompt.id);
	expect(
		consumerContexts(catalog, prompt.id).some(
			(context) => context.workflow.id === workflow.id && context.stage,
		),
	).toBe(true);
	expect(consumerContexts(catalog, "missing")).toEqual([]);
});
test("shared consumer paths and cycles never duplicate catalog entities or promote availability", () => {
	const other = { ...workflow, id: "workflow:other", steps: ["operation:other:stage"] };
	const stage = {
		...catalog.definitions.find((item) => item.id === workflow.steps[0])!,
		id: other.steps[0]!,
	};
	const synthetic: AgentTemplateCatalog = {
		...catalog,
		definitions: [...catalog.definitions, other, stage],
		relationships: [
			...catalog.relationships,
			{ from: other.id, to: stage.id, kind: "contains" },
			{ from: stage.id, to: prompt.id, kind: "uses_prompt" },
			{ from: prompt.id, to: stage.id, kind: "conditional" },
		],
	};
	const contexts = consumerContexts(synthetic, prompt.id);
	expect(
		contexts.some((context) => context.workflow.id === other.id && context.stage?.id === stage.id),
	).toBe(true);
	expect(contexts.some((context) => context.workflow.id === workflow.id)).toBe(true);
	const rows = workflowStages(synthetic, other);
	expect(rows[0]?.definitions.filter((item) => item.id === prompt.id)).toEqual([prompt]);
	expect(rows[0]?.connection).toBeUndefined();
	expect(workflowCoverage(synthetic, other).every((row) => row.fidelity !== "verified")).toBe(true);
});

test("drawer Back and direct-link parent need no synthetic browser history", () => {
	const stage = workflow.steps[1]!;
	const state = inspectSelection({ section: "workflows", workflow: workflow.id, stage }, prompt);
	expect(state).toMatchObject({ stage, peek: prompt.id });
	expect(state.trail).toBeUndefined();
	const nested = inspectSelection(state, workflow);
	expect(nested.trail).toEqual([{ id: prompt.id }]);
	expect(templateParent(nested)).toMatchObject({ stage, peek: prompt.id, trail: [] });
	expect(templateParent(state)).toMatchObject({
		workflow: workflow.id,
		stage,
		peek: undefined,
		trail: undefined,
	});
	expect(
		normalizeDiscovery(catalog, {
			section: "workflows",
			workflow: workflow.id,
			stage,
			inspect: prompt.id,
		}),
	).toMatchObject({ stage, inspect: undefined, peek: prompt.id });
	expect(templateParent({ section: "workflows", workflow: workflow.id, stage })).toEqual({
		section: "workflows",
		workflow: workflow.id,
		stage: undefined,
		implementation: undefined,
	});
	expect(templateParent({ section: "instructions", inspect: prompt.id }).inspect).toBeUndefined();
	expect(
		normalizeDiscovery(catalog, { section: "profiles", inspect: "profile:edit" }),
	).toMatchObject({ section: "workflows", inspect: "profile:edit" });
	expect(normalizeDiscovery(catalog, { section: "prompts", inspect: prompt.id })).toMatchObject({
		section: "instructions",
		inspect: prompt.id,
	});
});

test("stage totals count unique dependency IDs, excluding availability and next stages", () => {
	const stage = workflow.steps[1]!;
	const tool = catalog.definitions.find((item) => item.kind === "tool")!;
	const next = workflow.steps[2]!;
	const changed: AgentTemplateCatalog = {
		...catalog,
		relationships: [
			...catalog.relationships,
			{ from: stage, to: tool.id, kind: "uses_tool" },
			{ from: stage, to: tool.id, kind: "uses_tool" },
			{ from: stage, to: prompt.id, kind: "available" },
			{ from: stage, to: next, kind: "next" },
		],
	};
	const original = workflowStages(catalog, workflow)[1]!;
	const result = workflowStages(changed, workflow)[1]!;
	expect(original.toolCount).toBe(0);
	expect(original.instructionCount).toBe(1);
	expect(result.toolCount).toBe(1);
	expect(result.instructionCount).toBe(original.instructionCount);
});
