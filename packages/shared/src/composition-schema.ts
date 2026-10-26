import { z } from "zod";
import { KEYFRAME_EASINGS } from "./animation-properties.ts";
import { textAnimationSchema } from "./clip-animation.ts";
import { clipBlendModeSchema, clipColorSchema, clipMaskSchema } from "./clip-compositing.ts";
import { VISUAL_PRIMITIVE_IDS } from "./visual-primitives.ts";
import type { TemplateParams } from "./timeline-model.ts";

const finite = z.number().finite();
const nonnegative = finite.nonnegative();
const fraction = nonnegative.max(1);
const key = z
	.object({
		t: fraction,
		v: finite,
		easing: z.enum(KEYFRAME_EASINGS).optional(),
		easingRange: z
			.tuple([fraction, fraction])
			.refine(([a, b]) => b > a, "Easing range must increase")
			.optional(),
	})
	.strict();
const ordered = (keys: readonly { t: number }[]) =>
	keys.every((k, i) => i === 0 || k.t > keys[i - 1]!.t);
const numericTrack = (value = finite) =>
	z
		.array(key.extend({ v: value }))
		.refine(ordered, "Keyframe times must increase without duplicates");
const colorTrack = z
	.array(key.extend({ v: z.string().min(1).max(200) }))
	.refine(ordered, "Keyframe times must increase without duplicates");

/** Motion Studio's existing normalized tracks, separate from clip-local seconds. */
export const compositionAnimationSchema = z
	.object({
		tracks: z
			.object({
				x: numericTrack().optional(),
				y: numericTrack().optional(),
				scale: numericTrack(nonnegative).optional(),
				rotate: numericTrack().optional(),
				opacity: numericTrack(fraction).optional(),
				width: numericTrack(nonnegative).optional(),
				height: numericTrack(nonnegative).optional(),
				blur: numericTrack(nonnegative).optional(),
				bgOpacity: numericTrack(fraction).optional(),
				fontSize: numericTrack(nonnegative).optional(),
				letterSpacing: numericTrack().optional(),
				lineHeight: numericTrack(nonnegative).optional(),
			})
			.strict(),
		colorTracks: z
			.object({
				fill: colorTrack.optional(),
				bodyFill: colorTrack.optional(),
				accent: colorTrack.optional(),
				background: colorTrack.optional(),
			})
			.strict()
			.optional(),
	})
	.strict();

export const compositionStyleSchema = z
	.object({
		fontFamily: z.string(),
		fontSize: nonnegative,
		weight: nonnegative,
		fill: z.string(),
		background: z.string().optional(),
		accent: z.string().optional(),
		bodyFill: z.string().optional(),
		bgOpacity: fraction.optional(),
		scale: nonnegative.optional(),
		align: z.enum(["left", "center", "right"]),
		casing: z.enum(["none", "upper"]).optional(),
		lineHeight: nonnegative.optional(),
		letterSpacing: finite.optional(),
	})
	.strict();

export const compositionLayoutSchema = z
	.object({
		xPct: finite,
		yPct: finite,
		widthPct: nonnegative,
		heightPct: nonnegative.optional(),
		fit: z.enum(["contain", "cover", "stretch"]),
		rotationDeg: finite.optional(),
		aspectLocked: z.boolean().optional(),
		opacity: fraction.optional(),
		crop: z
			.object({ xPct: finite, yPct: finite, widthPct: nonnegative, heightPct: nonnegative })
			.strict()
			.optional(),
		flipX: z.boolean().optional(),
		flipY: z.boolean().optional(),
		mask: clipMaskSchema.nullable().optional(),
		color: clipColorSchema.optional(),
		blendMode: clipBlendModeSchema.optional(),
		animation: textAnimationSchema.optional(),
	})
	.strict();

const shapeNumber = (schema: z.ZodNumber) =>
	z.union([
		schema,
		z
			.string()
			.refine(
				(v) => v.trim() !== "" && schema.safeParse(Number(v)).success,
				"Expected a finite shape number",
			),
	]);
const shapeParamsSchema = z
	.object({
		fill: z.string().optional(),
		stroke: z.string().optional(),
		strokeWidth: shapeNumber(nonnegative).optional(),
		radius: shapeNumber(nonnegative).optional(),
		opacity: shapeNumber(fraction).optional(),
	})
	.strict();

export const compositionOverlaySchema = z
	.object({
		relStart: nonnegative,
		dur: finite.positive(),
		preset: z.enum(VISUAL_PRIMITIVE_IDS),
		content: z.string(),
		track: nonnegative.int().optional(),
		params: shapeParamsSchema.optional(),
		style: compositionStyleSchema.optional(),
		layout: compositionLayoutSchema.optional(),
		anim: compositionAnimationSchema.nullable().optional(),
	})
	.strict()
	.superRefine((layer, ctx) => {
		if (layer.anim && layer.layout?.animation)
			ctx.addIssue({
				code: "custom",
				path: ["layout", "animation"],
				message:
					"Composition layers use one animation source. Use normalized anim or local animation, not both.",
			});
		if (layer.preset === "plain" && Object.keys(layer.params ?? {}).length)
			ctx.addIssue({
				code: "custom",
				path: ["params"],
				message: "Plain text uses content and style, not shape parameters",
			});
		if (layer.preset !== "shape-rect" && layer.params?.radius !== undefined)
			ctx.addIssue({
				code: "custom",
				path: ["params", "radius"],
				message: "Corner radius applies only to Rectangle",
			});
		for (const [property, keys] of Object.entries(layer.layout?.animation?.tracks ?? {}))
			if (keys?.some((k) => k.t > layer.dur))
				ctx.addIssue({
					code: "custom",
					path: ["layout", "animation", "tracks", property],
					message: "Keyframe exceeds layer duration",
				});
	});

/** Missing version is the compatible legacy format. Parsing never strips fields. */
export const compositionConfigSchema = z
	.object({
		schemaVersion: z.literal(1).default(1),
		overlays: z.array(compositionOverlaySchema).min(1),
		spanSec: finite.positive(),
	})
	.strict()
	.superRefine((config, ctx) => {
		config.overlays.forEach((layer, i) => {
			if (layer.relStart + layer.dur > config.spanSec + 1e-6)
				ctx.addIssue({
					code: "custom",
					path: ["overlays", i, "dur"],
					message: "Layer exceeds composition span",
				});
		});
	});

export type CompositionConfig = z.infer<typeof compositionConfigSchema>;
export type CompositionOverlayJson = z.infer<typeof compositionOverlaySchema>;

/** The existing text-clip parameter slot stores a validated composition as JSON. */
export function compositionParams(config: CompositionConfig): TemplateParams {
	// SAFETY: strict composition schemas contain JSON fields only. Serialization
	// omits optional undefined values; animation interfaces otherwise lack an index signature.
	return JSON.parse(JSON.stringify(compositionConfigSchema.parse(config))) as TemplateParams;
}
