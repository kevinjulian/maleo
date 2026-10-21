import { expect, test } from "bun:test";
import { agentTemplateCatalog } from "./template-catalog.ts";
import { AGENT_WORKFLOWS } from "./runtime/workflows/index.ts";
import { TOOLS } from "./registry.ts";
import { PROMPT_MODULES } from "./prompt-definitions.ts";
import { PROMPT_TEMPLATE_MODULES } from "../../../lib/prompts/templates/index.ts";
import { workflowCatalog } from "./engine/catalog.ts";
import { planningRegistry } from "./engine/planning/registry.ts";
import { workflowRevision } from "./engine/registry.ts";

test("catalog derives the deployed workflows and all tool/profile identities", () => {
	const catalog = agentTemplateCatalog();
	expect(catalog.schemaVersion).toBe(2);
	expect(
		catalog.definitions.filter((item) => item.kind === "workflow").map((item) => item.id),
	).toEqual([
		...Object.keys(AGENT_WORKFLOWS).map((name) => `workflow:${name}`),
		"workflow:plan_story",
		"workflow:plan_story_core",
		"workflow:create_story_video",
	]);
	expect(catalog.definitions.filter((item) => item.kind === "tool").map((item) => item.id)).toEqual(
		TOOLS.map((item) => `tool:${item.name}`),
	);
	expect(
		catalog.definitions.filter((item) => item.kind === "profile").map((item) => item.id),
	).toEqual(["profile:storyPlan", "profile:storyGenerate", "profile:edit"]);
	const planning = catalog.definitions.find((item) => item.id === "workflow:plan_story");
	expect(planning?.entryPoint).toBe("workflow-plan_story");
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "workflow:plan_story",
			to: "prompt:instructions:VIDEO",
			kind: "uses_prompt",
		}),
	);
});

/* Image and text projects are retired: nothing of their carousel or thread AI may
 * reappear in what the explorer shows. */
test("retired carousel and thread definitions are absent", () => {
	const catalog = agentTemplateCatalog();
	const ids = [
		...catalog.definitions.map((item) => item.id),
		...catalog.relationships.flatMap((item) => [item.from, item.to]),
	];
	expect(
		ids.filter((id) =>
			/carousel|thread|slide|_post\b|post_|build_text|instructions:(IMAGE|TEXT)/.test(id),
		),
	).toEqual([]);
	expect(
		catalog.definitions.filter((item) => item.kind === "workflow").map((item) => item.id),
	).toEqual([
		"workflow:generate_story_assets",
		"workflow:plan_story",
		"workflow:plan_story_core",
		"workflow:create_story_video",
	]);
});

test("catalog distinguishes aliases, coercion and optional helpers", () => {
	const catalog = agentTemplateCatalog();
	expect(catalog.definitions.find((item) => item.id === "tool:add_scene")?.aliases).toContain(
		"add_beat",
	);
	expect(
		catalog.definitions.find((item) => item.id === "tool:update_scene")?.conditions.join(" "),
	).toContain("coerced to number");
	expect(
		catalog.definitions.find((item) => item.id === "tool:update_section")?.conditions.join(" "),
	).toContain("sectionId or legacy index is required");
	expect(
		catalog.relationships.some(
			(item) => item.to === "tool:view_timeline" && item.kind === "available",
		),
	).toBe(true);
	expect(
		catalog.relationships.some((item) => item.to === "tool:view_timeline" && item.kind === "next"),
	).toBe(false);
});

test("inspection distinguishes measured per-beat work and review-only duration additions", () => {
	const catalog = agentTemplateCatalog();
	expect(
		catalog.definitions.find((item) => item.id === "operation:assets:visuals")?.repeat,
	).toContain("measured visual beat");
	expect(
		catalog.definitions.find((item) => item.id === "operation:assets:extend")?.conditions.join(" "),
	).toContain("without generation");
	expect(catalog.definitions.find((item) => item.id === "tool:generate_voice")?.promptMode).toBe(
		"passthrough",
	);
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "tool:generate_story_assets",
			to: "operation:assets:measure",
			kind: "contains",
			provenance: expect.objectContaining({ kind: "declared" }),
		}),
	);
	expect(
		catalog.definitions.find((item) => item.id === "operation:plan.frame")?.contentTypes,
	).toEqual(["video"]);
	expect(
		catalog.definitions.find((item) => item.id === "prompt:content:storyFramePrompt")?.contentTypes,
	).toEqual(["video"]);
});

test("catalog content revisions remain stable and change with deployed descriptions", () => {
	const first = agentTemplateCatalog();
	expect(agentTemplateCatalog().revision).toBe(first.revision);
	const tool = TOOLS[0]!;
	const description = tool.description;
	try {
		tool.description = `${description} Changed for this test.`;
		expect(agentTemplateCatalog().revision).not.toBe(first.revision);
	} finally {
		tool.description = description;
	}
});

test("missing workflow metadata fails inspection rather than publishing partial definitions", () => {
	const workflow = AGENT_WORKFLOWS.generate_story_assets;
	const metadata = workflow.metadata;
	try {
		workflow.metadata = undefined;
		expect(() => agentTemplateCatalog()).toThrow();
	} finally {
		workflow.metadata = metadata;
	}
});

test("a generation tool without inspection coverage fails the catalog", () => {
	const tool = TOOLS.find((item) => item.kind === "generate")!;
	const inspection = tool.inspection;
	try {
		tool.inspection = undefined;
		expect(() => agentTemplateCatalog()).toThrow("Missing generation inspection");
	} finally {
		tool.inspection = inspection;
	}
});

test("fixed text changes revisions; declared metadata cannot replace a migrated recipe", () => {
	const first = agentTemplateCatalog();
	const module = PROMPT_MODULES.find((item) => item.id === "instructions")!;
	const fragments = module.fragments;
	const fragment = Object.entries(fragments)[0]!;
	try {
		module.fragments = {
			...fragments,
			[fragment[0]]: {
				...fragment[1],
				parts: fragment[1].parts.map((part, index) =>
					index === 0 ? `${part} Changed fixed text.` : part,
				),
			},
		};
		const changed = agentTemplateCatalog();
		expect(changed.revision).not.toBe(first.revision);
		expect(
			changed.definitions.find((item) => item.id === "prompt:instructions:COMMON")?.revision,
		).not.toBe(
			first.definitions.find((item) => item.id === "prompt:instructions:COMMON")?.revision,
		);
	} finally {
		module.fragments = fragments;
	}
	const owner = PROMPT_TEMPLATE_MODULES.find((item) =>
		item.templates.some((template) => template.id === "prompt:content:storyFramePrompt"),
	)!;
	const templates = owner.templates;
	try {
		owner.templates = templates.map((template) =>
			template.id === "prompt:content:storyFramePrompt"
				? { ...template, body: ["Changed fixed text. ", ...template.body] }
				: template,
		);
		const changed = agentTemplateCatalog();
		const id = "prompt:content:storyFramePrompt";
		expect(changed.definitions.find((item) => item.id === id)?.instructions?.[0]).toStartWith(
			"Changed fixed text. ",
		);
		expect(changed.definitions.find((item) => item.id === id)?.revision).not.toBe(
			first.definitions.find((item) => item.id === id)?.revision,
		);
		expect(
			changed.definitions.find((item) => item.id === "prompt:content:storyDraftPrompt")?.revision,
		).toBe(
			first.definitions.find((item) => item.id === "prompt:content:storyDraftPrompt")?.revision,
		);
	} finally {
		owner.templates = templates;
	}
});

test("planning is projected from its definitions: nodes, conditions, prompt and tool references, the shared core", () => {
	const catalog = agentTemplateCatalog();
	const byId = (id: string) => catalog.definitions.find((entry) => entry.id === id);
	const plan = byId("workflow:plan_story")!;
	expect(plan.execution?.kind).toBe("sequence");
	expect(plan.provenance?.["*"]).toMatchObject({
		kind: "derived",
		source: "apps/api/src/modules/agents/core/engine/planning/definitions.ts",
	});
	const routing = plan.predicates?.find(
		(predicate) => predicate.id === "condition:plan_story:route-direction",
	);
	expect(routing?.expression).toBe('{"rule":"direction.needsRouting"}');
	expect(routing?.resolution).toBe("unresolved");
	expect(routing?.boundaries).toContainEqual(
		expect.objectContaining({ symbol: "rule:direction.needsRouting" }),
	);
	const core = byId("workflow:plan_story_core")!;
	expect(
		core.predicates?.find(
			(predicate) => predicate.id === "condition:plan_story_core:review-evidence",
		)?.expression,
	).toContain("fact:clarification.bypass");
	// The research step is reached only on the grounding branch, and the edge says so.
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "workflow:plan_story_core",
			to: "operation:plan.research",
			kind: "conditional",
			conditions: [{ id: "condition:plan_story_core:needs-research", outcome: true }],
		}),
	);
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "operation:plan.frame",
			to: "prompt:content:storyFramePrompt",
			kind: "uses_prompt",
		}),
	);
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "operation:plan.research",
			to: "tool:research_topic",
			kind: "uses_tool",
		}),
	);
	// Operations are opaque code with their declared contracts.
	expect(byId("operation:plan.frame")?.provenance?.["*"]?.kind).toBe("opaque");
	expect(byId("operation:plan.frame")?.capabilities).toEqual(["llm:text"]);
	expect(byId("operation:plan.frame")?.input).toBeDefined();
	expect(byId("node:plan_story_core:ask-evidence")?.conditions[0]).toContain("Can suspend");
	expect(byId("node:plan_story_core:not-re-planning")?.description).toContain("produced nothing");
	// Both planning tools reach the same core.
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({ from: "workflow:plan_story", to: "workflow:plan_story_core" }),
	);
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({ from: "workflow:create_story_video", to: "workflow:plan_story" }),
	);
	expect(byId("workflow:create_story_video")?.entryPoint).toBe("create_story_video");
	expect(byId("operation:story.generate")?.conditions[0]).toContain(
		"outside capability enforcement",
	);
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "workflow:plan_story",
			to: "tool:view_timeline",
			kind: "available",
		}),
	);
});

test("a changed planning node changes the projected structure and the definition revision", () => {
	const registry = planningRegistry();
	const original = registry.get("plan_story_core")!;
	const root = original.definition.root;
	if (root.type !== "sequence") throw new Error("core root is a sequence");
	const changed = {
		...original.definition,
		root: { ...root, steps: root.steps.filter((step) => step.id !== "bible") },
	};
	const project = (definition: typeof original.definition) =>
		workflowCatalog(registry, [{ definition, source: "s" }]).definitions.find(
			(entry) => entry.id === "workflow:plan_story_core",
		);
	expect(project(changed)?.execution).not.toEqual(project(original.definition)?.execution);
	expect(workflowRevision(changed)).not.toBe(original.revision);
});

test("template inspection shows text, inputs, conditions, includes and response contracts", () => {
	const catalog = agentTemplateCatalog();
	const frame = catalog.definitions.find(
		(entry) => entry.id === "prompt:content:storyFramePrompt",
	)!;
	expect(frame.instructions?.[0]).toContain(
		'{{brief | collapseWs | trim | {"default":"(none given)"}}}',
	);
	expect(frame.instructions?.[0]).toContain('{{targetDurationSec | round | {"min":1}}}');
	expect(frame.instructions?.[0]).toContain("{{include:prompt:constraints:lockedConstraintBlock}}");
	expect(frame.variables?.map((entry) => entry.name)).toContain("opts.language");
	expect(frame.conditions.some((entry) => entry.includes("opts.language"))).toBe(true);
	expect(frame.output).toEqual([
		"Parser: json.fenced",
		"Schema: storyFrame",
		"Policy: frame.retryThenDegrade",
	]);
	expect(frame.provenance?.["*"]?.kind).toBe("derived");
	expect(frame.source).toBe("apps/api/src/lib/prompts/templates/story.ts");
	const evidence = catalog.definitions.find(
		(entry) => entry.id === "prompt:evidence:evidenceBlock",
	)!;
	expect(evidence.conditions).toContain("Repeat over sources");
	expect(evidence.output[0]).toContain("Composition fragment");
	expect(catalog.relationships).toContainEqual(
		expect.objectContaining({
			from: "prompt:evidence:evidenceDecisionPrompt",
			to: "prompt:evidence:priorBlock",
			kind: "uses_prompt",
		}),
	);
	expect(
		catalog.definitions.find((entry) => entry.id === "prompt:clarification:resolvedBlock")
			?.conditions[0],
	).toStartWith("When ");
});

test("display labels improve readability without changing canonical identities or instructions", () => {
	const catalog = agentTemplateCatalog();
	expect(catalog.definitions.find((item) => item.id === "workflow:plan_story")?.label).toBe(
		"Plan story",
	);
	expect(
		catalog.definitions.find((item) => item.id === "prompt:clarification:storyClarificationPrompt")
			?.label,
	).toBe("Story Clarification");
	expect(
		catalog.definitions
			.filter((item) => item.kind === "prompt")
			.every((item) => !item.label.includes("\n")),
	).toBe(true);
});

test("browse metadata is production-owned and changes revision without changing execution", () => {
	const before = agentTemplateCatalog();
	const planning = before.definitions.find((entry) => entry.id === "workflow:plan_story")!;
	expect(planning.summary).toBe("Create a durable story plan before generating media.");
	expect(
		before.definitions
			.filter((entry) => entry.kind === "tool")
			.every((entry) => entry.capabilities?.length),
	).toBe(true);
	expect(
		before.definitions.filter((entry) => entry.kind === "prompt").every((entry) => entry.purpose),
	).toBe(true);
	const module = PROMPT_TEMPLATE_MODULES.find((entry) =>
		entry.templates.some((template) => template.id === "prompt:content:directionRouterPrompt"),
	)!;
	const templates = module.templates;
	try {
		module.templates = templates.map((template) =>
			template.id === "prompt:content:directionRouterPrompt"
				? { ...template, description: "Updated presentation only." }
				: template,
		);
		const after = agentTemplateCatalog();
		expect(after.revision).not.toBe(before.revision);
		const id = "prompt:content:directionRouterPrompt";
		expect(after.definitions.find((entry) => entry.id === id)?.instructions).toEqual(
			before.definitions.find((entry) => entry.id === id)?.instructions,
		);
		expect(after.relationships).toEqual(before.relationships);
		expect(after.definitions.find((entry) => entry.id === planning.id)?.steps).toEqual(
			planning.steps,
		);
	} finally {
		module.templates = templates;
	}
});
