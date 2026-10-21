import { z } from "zod";
import { fingerprintValue } from "./entity-fingerprint.ts";

export const agentTemplateKindSchema = z.enum([
	"workflow",
	"profile",
	"tool",
	"operation",
	"prompt",
]);
const relationshipFieldsSchema = z
	.object({
		from: z.string().min(1),
		to: z.string().min(1),
		kind: z.enum([
			"next",
			"conditional",
			"contains",
			"uses_prompt",
			"available",
			"uses_tool",
			"profile",
		]),
		label: z.string().optional(),
	})
	.strict();

export const agentTemplateVariableSchema = z
	.object({
		name: z.string().min(1),
		type: z.string().min(1),
		required: z.boolean(),
		source: z.string(),
		default: z.string().optional(),
		condition: z.string().optional(),
	})
	.strict();

const definitionFieldsSchema = z
	.object({
		id: z.string().min(1),
		kind: agentTemplateKindSchema,
		label: z.string().min(1),
		description: z.string(),
		summary: z.string().optional(),
		capabilities: z.array(z.string().min(1)).optional(),
		purpose: z.string().optional(),
		source: z.string().min(1),
		revision: z.string().min(1),
		contentTypes: z.array(z.enum(["image", "text", "video"])),
		steps: z.array(z.string()).default([]),
		conditions: z.array(z.string()).default([]),
		composition: z.array(z.string()).default([]),
		aliases: z.array(z.string()).default([]),
		entryPoint: z.string().optional(),
		exposure: z.string().optional(),
		effect: z.string().optional(),
		repeat: z.string().optional(),
		input: z.record(z.unknown()).optional(),
		output: z.array(z.string()).default([]),
		instructions: z.array(z.string()).optional(),
		variables: z.array(agentTemplateVariableSchema).optional(),
		promptMode: z.enum(["none", "passthrough", "composed"]).optional(),
	})
	.strict();

export const agentTemplateFidelitySchema = z
	.object({
		kind: z.enum(["derived", "declared", "opaque"]),
		source: z.string().min(1),
		detail: z.string().optional(),
	})
	.strict();

export const agentTemplateBoundarySchema = z
	.object({
		source: z.string().min(1),
		symbol: z.string().min(1),
		reason: z.string().min(1),
	})
	.strict();

export interface AgentTemplateExecution {
	kind: "sequence" | "branch" | "call" | "scope";
	operationId?: string;
	conditionId?: string;
	terminal?: boolean;
	children: AgentTemplateExecution[];
}

export const agentTemplateExecutionSchema: z.ZodType<AgentTemplateExecution> = z.lazy(() =>
	z
		.object({
			kind: z.enum(["sequence", "branch", "call", "scope"]),
			operationId: z.string().min(1).optional(),
			conditionId: z.string().min(1).optional(),
			terminal: z.boolean().optional(),
			children: z.array(agentTemplateExecutionSchema),
		})
		.strict()
		.superRefine((node, ctx) => {
			if (
				(node.kind === "call" && (!node.operationId || node.children.length)) ||
				(node.kind === "branch" &&
					(!node.conditionId || node.children.length < 1 || node.children.length > 2)) ||
				(node.kind === "scope" && node.children.length !== 1)
			)
				ctx.addIssue({ code: "custom", message: `Invalid ${node.kind} execution structure` });
		}),
);

export const agentTemplateRecipeSlotSchema = z
	.object({
		name: z.string().min(1),
		type: z.string().min(1),
		source: z.string(),
		resolution: z.literal("unresolved"),
	})
	.strict();

export interface AgentTemplateRecipe {
	kind: "fragment" | "choice" | "join" | "repeat" | "reference";
	id: string;
	source: string;
	provenance: z.infer<typeof agentTemplateFidelitySchema>;
	definitionId?: string;
	parts?: string[];
	binding?: string;
	values: string[];
	when?: string;
	select?: string;
	separator?: string;
	omitEmpty?: boolean;
	empty?: string;
	inputs: z.infer<typeof agentTemplateRecipeSlotSchema>[];
	defaults: string[];
	transforms: string[];
	children: AgentTemplateRecipe[];
}

export const agentTemplateRecipeSchema: z.ZodType<AgentTemplateRecipe> = z.lazy(() =>
	z
		.object({
			kind: z.enum(["fragment", "choice", "join", "repeat", "reference"]),
			id: z.string().min(1),
			source: z.string().min(1),
			provenance: agentTemplateFidelitySchema,
			definitionId: z.string().min(1).optional(),
			parts: z.array(z.string()).optional(),
			binding: z.string().optional(),
			values: z.array(z.string()),
			when: z.string().optional(),
			select: z.string().optional(),
			separator: z.string().optional(),
			omitEmpty: z.boolean().optional(),
			empty: z.string().optional(),
			inputs: z.array(agentTemplateRecipeSlotSchema),
			defaults: z.array(z.string()),
			transforms: z.array(z.string()),
			children: z.array(agentTemplateRecipeSchema),
		})
		.strict()
		.superRefine((node, ctx) => {
			if (
				(node.kind === "fragment" && (!node.parts || !node.binding)) ||
				(node.kind === "choice" &&
					(!node.when || node.children.length < 1 || node.children.length > 2)) ||
				(node.kind === "repeat" &&
					(!node.select ||
						node.children.length !== 1 ||
						node.separator === undefined ||
						node.empty === undefined)) ||
				(node.kind === "join" && (node.separator === undefined || node.omitEmpty === undefined)) ||
				(node.kind === "reference" && (!node.definitionId || node.children.length))
			)
				ctx.addIssue({ code: "custom", message: `Invalid ${node.kind} recipe structure` });
		}),
);

export const agentTemplatePredicateSchema = z
	.object({
		id: z.string().min(1),
		source: z.string().min(1),
		expression: z.string().min(1),
		provenance: agentTemplateFidelitySchema,
		resolution: z.literal("unresolved"),
		boundaries: z.array(agentTemplateBoundarySchema),
	})
	.strict();

export const agentTemplateRelationshipSchema = relationshipFieldsSchema
	.extend({
		provenance: agentTemplateFidelitySchema.optional(),
		conditions: z
			.array(z.object({ id: z.string().min(1), outcome: z.boolean() }).strict())
			.optional(),
	})
	.strict();

export const agentTemplateDefinitionSchema = definitionFieldsSchema
	.extend({
		provenance: z.record(agentTemplateFidelitySchema).optional(),
		execution: agentTemplateExecutionSchema.optional(),
		predicates: z.array(agentTemplatePredicateSchema).optional(),
		recipe: agentTemplateRecipeSchema.optional(),
		boundaries: z.array(agentTemplateBoundarySchema).optional(),
	})
	.strict();

const catalogV2Schema = z
	.object({
		schemaVersion: z.literal(2),
		revision: z.string().min(1),
		definitions: z.array(agentTemplateDefinitionSchema),
		relationships: z.array(agentTemplateRelationshipSchema),
	})
	.strict()
	.superRefine((catalog, ctx) => {
		const ids = new Set<string>();
		const predicates = new Set(
			catalog.definitions.flatMap(
				(definition) => definition.predicates?.map((predicate) => predicate.id) ?? [],
			),
		);
		for (const [index, definition] of catalog.definitions.entries()) {
			if (!definition.provenance || !Object.keys(definition.provenance).length)
				ctx.addIssue({
					code: "custom",
					path: ["definitions", index, "provenance"],
					message: "Schema 2 needs fact provenance",
				});
			if (ids.has(definition.id))
				ctx.addIssue({
					code: "custom",
					path: ["definitions", index, "id"],
					message: `Duplicate definition: ${definition.id}`,
				});
			ids.add(definition.id);
		}
		for (const [index, definition] of catalog.definitions.entries()) {
			for (const step of definition.steps) {
				if (!ids.has(step))
					ctx.addIssue({
						code: "custom",
						path: ["definitions", index, "steps"],
						message: `Missing step: ${step}`,
					});
			}
			const execution = (node: AgentTemplateExecution): void => {
				if (node.operationId && !ids.has(node.operationId))
					ctx.addIssue({
						code: "custom",
						path: ["definitions", index, "execution"],
						message: `Missing operation: ${node.operationId}`,
					});
				if (node.conditionId && !predicates.has(node.conditionId))
					ctx.addIssue({
						code: "custom",
						path: ["definitions", index, "execution"],
						message: `Missing predicate: ${node.conditionId}`,
					});
				for (const child of node.children) execution(child);
			};
			const recipe = (node: AgentTemplateRecipe): void => {
				if (node.definitionId && !ids.has(node.definitionId))
					ctx.addIssue({
						code: "custom",
						path: ["definitions", index, "recipe"],
						message: `Missing recipe definition: ${node.definitionId}`,
					});
				for (const child of node.children) recipe(child);
			};
			if (definition.execution) execution(definition.execution);
			if (definition.recipe) recipe(definition.recipe);
		}
		for (const [index, relation] of catalog.relationships.entries()) {
			if (!relation.provenance)
				ctx.addIssue({
					code: "custom",
					path: ["relationships", index, "provenance"],
					message: "Schema 2 needs edge provenance",
				});
			for (const condition of relation.conditions ?? [])
				if (!predicates.has(condition.id))
					ctx.addIssue({
						code: "custom",
						path: ["relationships", index, "conditions"],
						message: `Missing predicate: ${condition.id}`,
					});
			for (const field of ["from", "to"] as const) {
				if (!ids.has(relation[field]))
					ctx.addIssue({
						code: "custom",
						path: ["relationships", index, field],
						message: `Missing definition: ${relation[field]}`,
					});
			}
		}
	});

/** Unsupported deployments fail explicitly; never retain a stale successful view. */
export const agentTemplateCatalogSchema = z.preprocess((value, ctx) => {
	const version =
		value && typeof value === "object" && "schemaVersion" in value
			? value.schemaVersion
			: undefined;
	if (version === 2) return value;
	ctx.addIssue({
		code: "custom",
		path: ["schemaVersion"],
		message: `Unsupported agent template catalog schema version: ${String(version)}`,
	});
	return z.NEVER;
}, catalogV2Schema);

export type AgentTemplateDefinition = z.infer<typeof agentTemplateDefinitionSchema>;
export type AgentTemplateRelationship = z.infer<typeof agentTemplateRelationshipSchema>;
export type AgentTemplateCatalog = z.infer<typeof agentTemplateCatalogSchema>;
export type AgentTemplateVariable = z.infer<typeof agentTemplateVariableSchema>;
export type AgentTemplateFidelity = z.infer<typeof agentTemplateFidelitySchema>;
export type AgentTemplateOperation = Pick<
	AgentTemplateDefinition,
	"id" | "label" | "description" | "source"
> &
	Partial<Pick<AgentTemplateDefinition, "conditions" | "repeat" | "output">> & {
		prompts?: string[];
	};

export const agentTemplateMetadataSchema = z
	.object({
		source: z.string().min(1),
		summary: z.string().optional(),
		contentTypes: z.array(z.enum(["image", "text", "video"])),
		conditions: z.array(z.string()).default([]),
		tools: z.array(z.string()).default([]),
		prompts: z.array(z.string()).default([]),
		profiles: z.array(z.string()).default([]),
		operations: z.array(z.string()).default([]),
		repeat: z.string().optional(),
	})
	.strict();

export function agentTemplateRevision(value: unknown): string {
	return fingerprintValue(value);
}
