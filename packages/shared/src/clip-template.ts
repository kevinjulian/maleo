import { z } from "zod";
import type { TemplateParams } from "./timeline-model.ts";
import { compositionConfigSchema, compositionOverlaySchema } from "./composition-schema.ts";
import { isVisualPrimitive } from "./visual-primitives.ts";
export { compositionConfigSchema, compositionParams } from "./composition-schema.ts";
export type { CompositionConfig, CompositionOverlayJson } from "./composition-schema.ts";

// A user-authored clip template shown in the Elements menu alongside the
// built-in (code-defined) items. A custom template is a saved, configured
// variant of an existing base renderer:
//   - kind "text": a base TextPreset id + default field params
// The base id selects the renderer; `config` holds the default content the
// built-in field editors read and write.
//   - kind "composition": a saved bundle of timeline overlays (Motion Studio
//     "save selection as motion") — config.overlays holds each overlay's
//     preset/content/params/style/layout/anim + relative timing; placing it
//     expands the bundle back into ordinary editable overlays at the playhead.
export const CLIP_TEMPLATE_KINDS = ["text", "composition"] as const;
export const CLIP_TEMPLATE_CATEGORIES = ["text", "shape", "motion"] as const;

/** A template parameter value, matching `TemplateParamValue` in the timeline
 *  model. The keys stay open — each preset names its own fields — but the value
 *  side is what a `TemplateField` declares, so it is not unknown. */
const templateParamValueSchema: z.ZodType<TemplateParams[string]> = z.union([
	z.string(),
	z.number(),
	z.boolean(),
	z.array(z.record(z.union([z.string(), z.number(), z.boolean()]))),
]);
const templateParamsSchema = z.record(templateParamValueSchema);

const clipTemplateBase = {
	label: z.string().trim().min(1).max(80),
	intent: z.string().trim().max(160).default(""),
	category: z.enum(CLIP_TEMPLATE_CATEGORIES),
	/** Base renderer id: a TextPreset id (kind "text"). */
	base: z.string().trim().min(1).max(120),
};

/* The kind selects the config schema; retained primitive parameters are
 * validated against their base after the discriminated union is parsed. */
const clipTemplateVariants = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("text"),
			...clipTemplateBase,
			base: clipTemplateBase.base.refine(
				isVisualPrimitive,
				"Unsupported visual primitive. Reload or repair this template.",
			),
			/** Field params for the preset named by `base`. */
			config: templateParamsSchema.default({}),
		})
		.strict(),
	z
		.object({
			kind: z.literal("composition"),
			...clipTemplateBase,
			config: compositionConfigSchema,
		})
		.strict(),
]);

function validatePrimitiveConfig(
	input: z.infer<typeof clipTemplateVariants>,
	ctx: z.RefinementCtx,
) {
	if (input.kind !== "text" || !isVisualPrimitive(input.base)) return;
	const parsed = compositionOverlaySchema.safeParse({
		preset: input.base,
		params: input.config,
		content: "",
		relStart: 0,
		dur: 1,
	});
	if (!parsed.success)
		for (const issue of parsed.error.issues)
			ctx.addIssue({ ...issue, path: ["config", ...issue.path.slice(1)] });
}
export const clipTemplateInputSchema = clipTemplateVariants.superRefine(validatePrimitiveConfig);

const clipTemplateIdentity = {
	id: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
};

/* `.extend` is not available on a discriminated union, so the identity fields
 * are added per arm. */
export const clipTemplateSchema = z
	.discriminatedUnion("kind", [
		clipTemplateVariants.options[0].extend(clipTemplateIdentity),
		clipTemplateVariants.options[1].extend(clipTemplateIdentity),
	])
	.superRefine(validatePrimitiveConfig);

export type ClipTemplateKind = (typeof CLIP_TEMPLATE_KINDS)[number];
export type ClipTemplateCategory = (typeof CLIP_TEMPLATE_CATEGORIES)[number];
export type ClipTemplateInput = z.infer<typeof clipTemplateInputSchema>;
export type ClipTemplate = z.infer<typeof clipTemplateSchema>;
