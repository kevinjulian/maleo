import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
	agentTemplateCatalogSchema,
	agentTemplateDefinitionSchema,
	agentTemplateMetadataSchema,
	agentTemplateRevision,
	type AgentTemplateDefinition,
	type AgentTemplateRelationship,
} from "@maleo/shared";
import { AGENT_WORKFLOWS } from "./runtime/workflows/index.ts";
import { PIPELINE_NAMES, pipelineContracts, pipelineProfile } from "./pipeline-definitions.ts";
import { TOOL_GROUPS, TOOLS, TOOL_ALIAS_CANONICAL, RETIRED_TOOL_NAMES } from "./registry.ts";
import { RUNTIME_TOOL_NAMES } from "./runtime/tools/registry-tools.ts";
import { PROMPT_MODULES } from "./prompt-definitions.ts";
import { PROMPT_TEMPLATE_MODULES } from "../../../lib/prompts/templates/index.ts";
import { templateCatalogFacts } from "../../../lib/prompts/catalog.ts";
import { workflowCatalog } from "./engine/catalog.ts";
import { PLAN_STORY_TOOL } from "./runtime/tools/plan-story-tool.ts";
import { planningRegistry } from "./engine/planning/registry.ts";

const owner = "apps/api/src/modules/agents/core/";
const allContent = ["image", "text", "video"] as const;

function definition(input: z.input<typeof agentTemplateDefinitionSchema>): AgentTemplateDefinition {
	const label = /[\n(]/.test(input.label) ? input.id.split(":").at(-1)! : input.label;
	const readable = label
		.replace(/Prompt$/, "")
		.replace(/([a-z0-9])([A-Z])/g, "$1 $2")
		.replace(/[_-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const parsed = agentTemplateDefinitionSchema.parse({
		...input,
		label: readable ? readable[0]!.toUpperCase() + readable.slice(1) : label,
	});
	parsed.provenance ??= { "*": { kind: "declared", source: parsed.source } };
	const { revision: _revision, ...content } = parsed;
	return { ...content, revision: agentTemplateRevision(content) };
}

/** Preserve coercion and refinements alongside JSON Schema's field contract.
 *  Takes `unknown` because Zod 3 types a wrapper's inner schema as `any`; the
 *  `instanceof` below is what gives each step of the walk its type back. */
function validationNotes(schema: unknown, path = "input"): string[] {
	if (!(schema instanceof z.ZodType)) return [];
	if (schema instanceof z.ZodEffects)
		return [
			`${path}: ${schema.description ?? "Additional runtime refinement applies."}`,
			...validationNotes(schema.innerType(), path),
		];
	if (
		schema instanceof z.ZodOptional ||
		schema instanceof z.ZodNullable ||
		schema instanceof z.ZodDefault
	)
		return validationNotes(schema._def.innerType, path);
	if (schema instanceof z.ZodArray) return validationNotes(schema.element, `${path}[]`);
	if (schema instanceof z.ZodObject) {
		const shape: Record<string, unknown> = schema.shape;
		return Object.entries(shape).flatMap(([key, field]) =>
			validationNotes(field, `${path}.${key}`),
		);
	}
	if (
		(schema instanceof z.ZodNumber ||
			schema instanceof z.ZodString ||
			schema instanceof z.ZodBoolean) &&
		schema._def.coerce
	)
		return [
			`${path}: coerced to ${schema._def.typeName.replace("Zod", "").toLowerCase()} before validation.`,
		];
	return [];
}

export function agentTemplateCatalog() {
	const definitions: AgentTemplateDefinition[] = [];
	const relationships: AgentTemplateRelationship[] = [];
	const add = (value: z.input<typeof agentTemplateDefinitionSchema>) =>
		definitions.push(definition(value));
	const derived = (
		entry: AgentTemplateDefinition,
		fact: string,
		source = entry.source,
		detail?: string,
	) => {
		(entry.provenance ??= {})[fact] = { kind: "derived", source, ...(detail ? { detail } : {}) };
	};
	for (const module of PROMPT_MODULES) {
		const owners = [
			...new Set([
				...Object.values(module.fragments).map((fragment) => fragment.owner),
				...Object.keys(module.composition ?? {}),
			]),
		];
		for (const name of owners) {
			const fragments = Object.values(module.fragments).filter(
				(fragment) => fragment.owner === name,
			);
			add({
				id: `prompt:${module.id}:${name}`,
				kind: "prompt",
				label: module.labels?.[name] ?? name,
				purpose: module.purposes?.[name] ?? module.purpose,
				summary:
					module.summaries?.[name] ??
					`${module.purposes?.[name] ?? module.purpose} guidance. Open instructions for complete production text.`,
				description:
					"Production-owned fixed fragments in declaration order. Conditional fragments and interpolation expressions describe composition; these are templates, not submitted requests.",
				source: module.source,
				revision: "pending",
				contentTypes: [...allContent],
				instructions: fragments.map((fragment) =>
					fragment.parts
						.map((part, index) => {
							const variable = fragment.variables[index];
							return `${part}${variable ? (module.staticValues?.[variable.source] ?? `{{${variable.source}}}`) : ""}`;
						})
						.join(""),
				),
				variables: [
					...fragments.flatMap((fragment) => [...fragment.variables]),
					...(module.composition?.[name] ?? []).map((slot) => ({
						name: slot,
						type: "string",
						required: slot === "subject" || slot === "storyBrief" || slot === "sceneVisual",
						source: `${name}: ${slot} input layer; trim and omit empty guidance.`,
					})),
				],
				composition: [...(module.composition?.[name] ?? [])],
				conditions: [
					...new Set(
						fragments.flatMap((fragment) => (fragment.condition ? [fragment.condition] : [])),
					),
				],
				output: ["Output rules and response schemas appear in the fixed instruction fragments."],
			});
		}
	}
	// Template prompts: the definition is the data production renders.
	for (const module of PROMPT_TEMPLATE_MODULES)
		for (const template of module.templates) {
			const { includes, ...facts } = templateCatalogFacts(template);
			add({
				id: template.id,
				kind: "prompt",
				label: template.id.split(":").at(-1)!,
				purpose: module.purpose,
				summary: template.description,
				description:
					"Prompt template: the text production renders, with each input, constant, formatter, include and condition named where it applies.",
				source: module.source,
				revision: "pending",
				contentTypes: [...allContent],
				...facts,
			});
			const entry = definitions.at(-1)!;
			entry.provenance = { "*": { kind: "derived", source: module.source } };
			for (const included of includes)
				relationships.push({
					from: template.id,
					to: included,
					kind: "uses_prompt",
					provenance: { kind: "derived", source: module.source },
				});
		}

	for (const tool of TOOLS) {
		if (tool.kind === "generate" && !tool.inspection)
			throw new Error(`Missing generation inspection: ${tool.name}`);
		const aliases = Object.entries(TOOL_ALIAS_CANONICAL)
			.filter(([, name]) => name === tool.name)
			.map(([alias]) => alias);
		const retired = [...RETIRED_TOOL_NAMES]
			.filter(([, name]) => name === tool.name)
			.map(([alias]) => `Compatibility only: ${alias}`);
		add({
			id: `tool:${tool.name}`,
			kind: "tool",
			label: tool.name,
			description: tool.description,
			source: `${owner}registry.ts`,
			revision: "pending",
			summary:
				tool.description
					.split(" - ")
					.slice(1)
					.join(" - ")
					.split(/(?<=[.!?])\s/)[0] || undefined,
			capabilities: TOOL_GROUPS.filter((group) => group.tools.includes(tool)).map(
				(group) => group.capability,
			),
			contentTypes: tool.contentType ?? [...allContent],
			aliases: [...aliases, ...retired],
			effect: tool.kind,
			exposure: RUNTIME_TOOL_NAMES.has(tool.name)
				? "Runtime-owned control or internal workflow call; not a direct agent domain tool."
				: "Direct agent tool for the declared content types; subject to existing validation and approval.",
			input: zodToJsonSchema(tool.input, { target: "jsonSchema7", $refStrategy: "none" }),
			conditions: validationNotes(tool.input),
			output: [
				"Tool result note; optional media artifacts, editor commands, proposal, or suspension as declared by the handler.",
			],
			promptMode: tool.inspection?.promptMode ?? "none",
		});
		for (const fact of ["input", "exposure", "effect", "aliases"])
			derived(definitions.at(-1)!, fact, `${owner}registry.ts`);
		for (const operation of tool.inspection?.operations ?? []) {
			const { prompts = [], ...content } = operation;
			const existing = definitions.find((item) => item.id === operation.id);
			if (existing)
				existing.contentTypes = [
					...new Set([...existing.contentTypes, ...(tool.contentType ?? allContent)]),
				];
			else
				add({
					...content,
					kind: "operation",
					revision: "pending",
					contentTypes: tool.contentType ?? [...allContent],
				});
			relationships.push({ from: `tool:${tool.name}`, to: operation.id, kind: "contains" });
			for (const prompt of prompts)
				relationships.push({ from: operation.id, to: prompt, kind: "uses_prompt" });
		}
		for (const prompt of tool.inspection?.prompts ?? [])
			relationships.push({ from: `tool:${tool.name}`, to: prompt, kind: "uses_prompt" });
	}

	for (const profile of PIPELINE_NAMES) {
		const shape = pipelineProfile(profile);
		const contracts = pipelineContracts(profile);
		add({
			id: `profile:${profile}`,
			kind: "profile",
			label: profile,
			description:
				profile === "edit"
					? "Stage profile for individually approved edits; no agent-callable edit workflow."
					: "Stage-contract profile associated with executable workflows; not a separate agent entry point.",
			source: `${owner}pipeline-definitions.ts`,
			revision: "pending",
			contentTypes: profile === "edit" ? [...allContent] : [shape.contentType],
			input: { stages: contracts },
			output: contracts.flatMap(({ contract }) =>
				contract.produces.map(({ kind, optional }) => `${kind}${optional ? " (conditional)" : ""}`),
			),
		});
		if (profile === "edit")
			for (const tool of TOOLS.filter(
				(item) => item.intents.includes("edit_element") || item.intents.includes("restyle"),
			))
				relationships.push({
					from: "profile:edit",
					to: `tool:${tool.name}`,
					kind: "available",
					label: "Individually validated edit tool; not a callable edit workflow.",
				});
	}
	for (const [name, workflow] of Object.entries(AGENT_WORKFLOWS)) {
		const metadata = agentTemplateMetadataSchema.parse(workflow.metadata?.template);
		const id = `workflow:${name}`;
		const steps: string[] = [];
		for (const item of workflow.serializedStepGraph) {
			if (item.type !== "step")
				throw new Error(`Catalog needs inspection coverage for ${name}:${item.type}`);
			const step = item.step;
			const detail = agentTemplateMetadataSchema.parse(step.metadata?.template);
			const stepId = `operation:${name}:${step.id}`;
			steps.push(stepId);
			add({
				id: stepId,
				kind: "operation",
				label: step.id,
				description: step.description ?? step.id,
				summary: detail.summary ?? step.description,
				source: `${owner}${detail.source}`,
				revision: "pending",
				contentTypes: detail.contentTypes,
				conditions: [
					...detail.conditions,
					...(step.canSuspend ? ["Can suspend for human input and resume this step."] : []),
				],
				repeat: detail.repeat,
			});
			relationships.push({
				from: id,
				to: stepId,
				kind: "contains",
				provenance: { kind: "derived", source: `${owner}runtime/workflows/index.ts` },
			});
			for (const tool of detail.tools)
				relationships.push({ from: stepId, to: `tool:${tool}`, kind: "uses_tool" });
			for (const prompt of detail.prompts)
				relationships.push({ from: stepId, to: prompt, kind: "uses_prompt" });
			for (const operation of detail.operations)
				relationships.push({
					from: stepId,
					to: operation,
					kind: "conditional",
					label: "See this step's conditions before running this internal operation.",
				});
		}
		add({
			id,
			kind: "workflow",
			label: name,
			description: workflow.description ?? name,
			summary: metadata.summary ?? workflow.description?.split(/(?<=[.!?])\s/)[0],
			source: `${owner}${metadata.source}`,
			revision: "pending",
			contentTypes: metadata.contentTypes,
			steps,
			entryPoint: `workflow-${name}`,
			conditions: [
				...metadata.conditions,
				"The agent may also select workspace-allowlisted external MCP tools through runtime/tools/mcp-tools.ts. Server names, URLs, credentials, and tool lists are workspace-owned and excluded from this catalog.",
			],
			input: workflow.inputSchema["~standard"].jsonSchema.input({ target: "draft-07" }),
			output: ["Workflow outcome: ok and note; suspended steps retain their pending action."],
		});
		for (const fact of ["steps", "entryPoint", "input"]) derived(definitions.at(-1)!, fact);
		for (const [index, step] of steps.entries()) {
			const next = steps[index + 1];
			if (next)
				relationships.push({
					from: step,
					to: next,
					kind: "next",
					label: "Continue when previous step succeeds; inspect its conditions.",
					provenance: { kind: "derived", source: `${owner}runtime/workflows/index.ts` },
				});
		}
		for (const profile of metadata.profiles)
			relationships.push({ from: id, to: `profile:${profile}`, kind: "profile" });
		relationships.push({
			from: id,
			to: "prompt:instructions:VIDEO",
			kind: "uses_prompt",
			label: "Instructions for the agent that may choose this workflow.",
		});
		for (const tool of TOOLS.filter(
			(value) =>
				!RUNTIME_TOOL_NAMES.has(value.name) &&
				(!value.contentType ||
					metadata.contentTypes.some((type) => value.contentType?.includes(type))),
		)) {
			relationships.push({
				from: id,
				to: `tool:${tool.name}`,
				kind: "available",
				label: "Agent-selectable; not a required pipeline step.",
			});
		}
	}
	/* Workflow definitions on the engine: projected from the data it executes. */
	const registry = planningRegistry();
	const engineSource = `${owner}engine/planning/`;
	const projected = workflowCatalog(registry, [
		{
			definition: registry.get("plan_story")!.definition,
			source: `${engineSource}definitions.ts`,
			entryPoint: PLAN_STORY_TOOL,
		},
		{
			definition: registry.get("plan_story_core")!.definition,
			source: `${engineSource}definitions.ts`,
		},
		{
			definition: registry.get("create_story_video")!.definition,
			source: `${engineSource}one-shot.ts`,
			entryPoint: "create_story_video",
		},
	]);
	for (const entry of projected.definitions) add(entry);
	relationships.push(...projected.relationships);
	for (const id of ["workflow:plan_story", "workflow:create_story_video"]) {
		relationships.push({
			from: id,
			to: "prompt:instructions:VIDEO",
			kind: "uses_prompt",
			label: "Instructions for the agent that may choose this workflow.",
		});
		relationships.push({ from: id, to: "profile:storyPlan", kind: "profile" });
		for (const tool of TOOLS.filter(
			(value) =>
				!RUNTIME_TOOL_NAMES.has(value.name) &&
				(!value.contentType || value.contentType.includes("video")),
		)) {
			relationships.push({
				from: id,
				to: `tool:${tool.name}`,
				kind: "available",
				label: "Agent-selectable; not a required workflow step.",
			});
		}
	}
	relationships.push({
		from: "prompt:instructions:VIDEO",
		to: "prompt:instructions:COMMON",
		kind: "uses_prompt",
	});
	relationships.push({
		from: "prompt:materials:visualPromptLayers",
		to: "prompt:materials:RULES_PREFIX",
		kind: "uses_prompt",
	});
	const uniqueRelationships = [
		...new Map(
			relationships.map((relation) => [agentTemplateRevision(relation), relation]),
		).values(),
	];
	for (const relation of uniqueRelationships)
		relation.provenance ??= {
			kind: "declared",
			source: definitions.find((entry) => entry.id === relation.from)?.source ?? owner,
		};
	const byId = new Map(definitions.map((item) => [item.id, item]));
	for (const item of definitions) if (item.kind === "prompt") item.contentTypes = [];
	let changed = true;
	while (changed) {
		changed = false;
		for (const relation of uniqueRelationships.filter((item) => item.kind === "uses_prompt")) {
			const consumer = byId.get(relation.from)!;
			const prompt = byId.get(relation.to)!;
			const types = [...new Set([...prompt.contentTypes, ...consumer.contentTypes])];
			if (types.length > prompt.contentTypes.length) {
				prompt.contentTypes = types;
				changed = true;
			}
		}
	}
	for (const item of definitions) {
		const { revision: _revision, ...entry } = item;
		item.revision = agentTemplateRevision({
			entry,
			relationships: uniqueRelationships.filter((relation) => relation.from === item.id),
		});
	}
	const content = { schemaVersion: 2 as const, definitions, relationships: uniqueRelationships };
	return agentTemplateCatalogSchema.parse({ ...content, revision: agentTemplateRevision(content) });
}
