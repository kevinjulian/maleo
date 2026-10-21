import { expect, test } from "bun:test";
import { promptTemplates } from "../../../../../lib/prompts/registry.ts";
import { PLANNING_OPERATIONS } from "./operations.ts";
import { PLANNING_FACTS, PLANNING_RULES } from "./projections.ts";

const byId = new Map(PLANNING_OPERATIONS.map((operation) => [operation.id, operation]));

test("operation, fact and rule ids are unique", () => {
	expect(byId.size).toBe(PLANNING_OPERATIONS.length);
	expect(new Set(PLANNING_FACTS.map((fact) => fact.id)).size).toBe(PLANNING_FACTS.length);
	expect(new Set(PLANNING_RULES.map((rule) => rule.id)).size).toBe(PLANNING_RULES.length);
});

test("every declared prompt is a registered model request, and a prompt implies llm:text", () => {
	for (const operation of PLANNING_OPERATIONS) {
		for (const prompt of operation.prompts)
			expect(promptTemplates.get(prompt)?.response, `${operation.id} ${prompt}`).toBeDefined();
		if (operation.prompts.length) expect(operation.capabilities).toContain("llm:text");
		expect(operation.capabilities).not.toContain("media:generate");
	}
	expect(byId.get("plan.research")?.tools).toEqual(["research_topic"]);
});

test("inputs and outputs are checked against explicit schemas", () => {
	const setup = {
		brief: "b",
		clarification: "",
		targetSec: 60,
		structure: "beat",
		sectionCount: 4,
		wordsPerSec: 2.5,
	};
	expect(byId.get("plan.setup")!.input.safeParse({ args: { brief: "b" } }).success).toBe(true);
	expect(byId.get("plan.setup")!.input.safeParse({}).success).toBe(false);
	expect(byId.get("plan.setup")!.output.safeParse(setup).success).toBe(true);
	expect(
		byId.get("plan.setup")!.output.safeParse({ ...setup, structure: "chapters" }).success,
	).toBe(false);
	expect(
		byId
			.get("plan.hold")!
			.output.safeParse({ researchKey: null, sourceCount: 0, clarification: null }).success,
	).toBe(true);
	expect(byId.get("plan.hold")!.output.safeParse({ researchKey: null }).success).toBe(false);
	expect(byId.get("plan.draft")!.output.safeParse({ plan: { sections: [] } }).success).toBe(false);
	expect(
		byId.get("plan.draft")!.output.safeParse({
			plan: { sections: [{ title: "t", narration: "n", visualPrompt: "v" }], planKind: "story" },
		}).success,
	).toBe(true);
	expect(byId.get("evidence.decide")!.output.safeParse({ kind: "maybe" }).success).toBe(false);
	expect(
		byId.get("guard.answerReplacement")!.output.safeParse({ decision: "reject" }).success,
	).toBe(true);
	expect(byId.get("plan.persist")!.output.safeParse({ ok: true, note: "Planned." }).success).toBe(
		true,
	);
});
