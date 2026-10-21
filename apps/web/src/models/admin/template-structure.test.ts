import { expect, test } from "vite-plus/test";
import { agentTemplateCatalogSchema } from "@maleo/shared";
import fixture from "../../../visual/fixtures/agent-templates.json";
import {
	templateCallerOutcomes,
	templateExecutionRows,
	templateFact,
	templateRecipeRows,
} from "./template-structure.ts";

const catalog = agentTemplateCatalogSchema.parse(fixture);
test("execution rows preserve true/false ordering and scoped terminal returns", () => {
	const rows = templateExecutionRows({
		kind: "sequence",
		children: [
			{
				kind: "branch",
				conditionId: "choice",
				children: [
					{ kind: "call", operationId: "yes", children: [] },
					{ kind: "call", operationId: "no", children: [] },
				],
			},
			{
				kind: "scope",
				children: [{ kind: "call", operationId: "return", terminal: true, children: [] }],
			},
			{ kind: "call", operationId: "stop", terminal: true, children: [] },
		],
	});
	expect(rows.filter((row) => row.node.operationId).map((row) => row.node.operationId)).toEqual([
		"yes",
		"no",
		"return",
		"stop",
	]);
	expect(rows.find((row) => row.node.operationId === "no")?.conditions).toEqual([
		{ id: "choice", outcome: false },
	]);
	expect(rows.find((row) => row.node.operationId === "return")?.continuation).toBe(
		"Return to caller",
	);
	expect(rows.find((row) => row.node.operationId === "stop")?.continuation).toBe("Stop sequence");
});
test("fidelity is specific to each fact and caller gates retain negative outcomes", () => {
	const item = catalog.definitions.find((entry) => entry.id === "operation:plan_story:direction")!;
	expect(templateFact(item, "execution").kind).toBe("derived");
	expect(templateFact(item, "description").kind).toBe("declared");
	const start = catalog.definitions.find((entry) => entry.id === "operation:planning:stage-start")!;
	expect(templateCallerOutcomes(catalog, start, "condition:planning:stage-answer")).toEqual([
		false,
	]);
});
test("ordered recipe rows expose conditional and repeated bindings without values", () => {
	const recipe = catalog.definitions.find(
		(entry) => entry.id === "prompt:clarification:resolvedBlock",
	)!.recipe!;
	const rows = templateRecipeRows(recipe);
	expect(rows[0]?.node.kind).toBe("join");
	expect(rows[1]?.node.kind).toBe("choice");
	expect(rows[2]?.condition).toContain("When true");
	expect(rows[2]?.node.values.length).toBeGreaterThan(0);
	expect(
		rows.flatMap((row) => row.node.inputs).every((input) => input.resolution === "unresolved"),
	).toBe(true);
	expect(agentTemplateCatalogSchema.safeParse({ ...fixture, schemaVersion: 1 }).success).toBe(
		false,
	);
});
