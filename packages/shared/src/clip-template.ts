import { z } from "zod";
import type { TemplateParams } from "./timeline-model.ts";

// A user-authored clip template shown in the Motion / Text / Data sidebar menus
// alongside the built-in (code-defined) items. A custom template is a saved,
// configured variant of an existing base renderer:
//   - kind "text": a base TextPreset id + default field params
//   - kind "data": a base infographic type + a default payload
// The base id selects the renderer; `config` holds the default content the
// built-in field/payload editors read and write.
//   - kind "composition": a saved bundle of timeline overlays (Motion Studio
//     "save selection as motion") — config.overlays holds each overlay's
//     preset/content/params/style/layout/anim + relative timing; placing it
//     expands the bundle back into ordinary editable overlays at the playhead.
export const CLIP_TEMPLATE_KINDS = ["text", "data", "composition"] as const;
export const CLIP_TEMPLATE_CATEGORIES = ["data", "text", "intro", "logo"] as const;

/** One overlay inside a saved composition, as it is stored.
 *
 *  `preset` is a `TextPreset` id in every composition this app writes but is
 *  declared `string`: stored compositions carry `preset: ""`, which
 *  `overlaysFromComposition` defaults to "title", and tightening it would make
 *  the schema disagree with the data. `style`, `layout` and `anim` stay
 *  `unknown` for the same reason the interface they mirror does — they are
 *  passed through to the renderer, not read here. */
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

const compositionOverlaySchema = z.object({
	relStart: z.number(),
	dur: z.number(),
	preset: z.string(),
	content: z.string(),
	track: z.number().optional(),
	params: templateParamsSchema.optional(),
	style: z.unknown().optional(),
	layout: z.unknown().optional(),
	anim: z.unknown().optional(),
});

/** A saved bundle of timeline overlays, written by Motion Studio's "save
 *  selection as motion". This is the one config shape with a contract worth
 *  stating: placing a composition expands `overlays` back onto the timeline, so
 *  every consumer reads these fields by name. */
export const compositionConfigSchema = z.object({
	overlays: z.array(compositionOverlaySchema).default([]),
	spanSec: z.number().default(0),
});

const clipTemplateBase = {
	label: z.string().trim().min(1).max(80),
	intent: z.string().trim().max(160).default(""),
	category: z.enum(CLIP_TEMPLATE_CATEGORIES),
	/** Base renderer id: a TextPreset id (kind "text") or infographic type (kind "data"). */
	base: z.string().trim().min(1).max(120),
};

/* Discriminated on `kind`, because the three kinds hold three unrelated
 * configs and a single `Record<string, unknown>` made every consumer assert
 * which one it had.
 *
 * Only the composition arm is narrowed. The other two are left open on purpose
 * and NOT because nobody got to them: `text` holds a per-preset params bag
 * whose keys depend on the preset id in `base`, and `data` holds an
 * `InfographicPayload`, a twelve-variant union with no schema and — as of this
 * change — no stored row anywhere to check a stricter one against. Writing
 * either from the type alone would be a parse verified by nothing. */
export const clipTemplateInputSchema = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("text"),
			...clipTemplateBase,
			/** Field params for the preset named by `base`. */
			config: templateParamsSchema.default({}),
		})
		.strict(),
	z
		.object({
			kind: z.literal("data"),
			...clipTemplateBase,
			/** An `InfographicPayload` for the infographic type named by `base`. It is
			 *  JSON like every other config here; which SHAPE of JSON is decided by
			 *  `base`, and typing that is the twelve-variant union this change leaves
			 *  to a reader with stored rows to check it against. */
			config: templateParamsSchema.default({}),
		})
		.strict(),
	z
		.object({
			kind: z.literal("composition"),
			...clipTemplateBase,
			config: compositionConfigSchema.default({ overlays: [], spanSec: 0 }),
		})
		.strict(),
]);

const clipTemplateIdentity = {
	id: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
};

/* `.extend` is not available on a discriminated union, so the identity fields
 * are added per arm. */
export const clipTemplateSchema = z.discriminatedUnion("kind", [
	clipTemplateInputSchema.options[0].extend(clipTemplateIdentity),
	clipTemplateInputSchema.options[1].extend(clipTemplateIdentity),
	clipTemplateInputSchema.options[2].extend(clipTemplateIdentity),
]);

export type CompositionConfig = z.infer<typeof compositionConfigSchema>;
export type CompositionOverlayJson = z.infer<typeof compositionOverlaySchema>;

export type ClipTemplateKind = (typeof CLIP_TEMPLATE_KINDS)[number];
export type ClipTemplateCategory = (typeof CLIP_TEMPLATE_CATEGORIES)[number];
export type ClipTemplateInput = z.infer<typeof clipTemplateInputSchema>;
export type ClipTemplate = z.infer<typeof clipTemplateSchema>;
