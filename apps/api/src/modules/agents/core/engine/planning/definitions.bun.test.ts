import { expect, test } from "bun:test";
import { workflowNodes } from "@maleo/shared";
import { planningRegistry } from "./registry.ts";

test("the planning definitions load and validate", () => {
	const registry = planningRegistry();
	expect(registry.get("plan_story")?.revision).toBeTruthy();
	expect(registry.get("plan_story_core")?.revision).toBeTruthy();
});

test("structure snapshot lists every node", () => {
	const ids = (id: string) =>
		workflowNodes(planningRegistry().get(id)!.definition.root).map(
			(node) => `${node.type}:${node.id}`,
		);
	expect(ids("plan_story")).toEqual([
		"sequence:plan_story",
		"step:duration",
		"branch:replace-approved",
		"sequence:replacement",
		"suspend:approve-replacement",
		"branch:replacement-rejected",
		"end:kept",
		"branch:route-direction",
		"step:direction",
		"step:bypass",
		"branch:bypassed",
		"step:record-bypass",
		"branch:clarification-eligible",
		"sequence:clarify",
		"step:questions",
		"branch:has-questions",
		"suspend:ask-questions",
		"step:questions-unavailable",
		"step:bind",
		"call:plan",
		"end:planned",
	]);
	expect(ids("plan_story_core")).toEqual([
		"sequence:plan_story_core",
		"step:setup",
		"branch:generated-work",
		"sequence:preserve-generated",
		"step:preserve",
		"end:not-re-planning",
		"step:brief",
		"step:frame",
		"branch:needs-research",
		"step:research",
		"step:hold",
		"branch:review-evidence",
		"sequence:evidence",
		"step:decide",
		"branch:evidence-fallback",
		"step:fallback",
		"branch:evidence-question",
		"suspend:ask-evidence",
		"step:draft",
		"step:materialize",
		"branch:no-style-image",
		"sequence:style",
		"step:load-style",
		"branch:missing-style",
		"step:generate-style",
		"branch:resolved-style",
		"step:save-style",
		"step:bible",
		"step:persist",
		"end:planned",
	]);
});
