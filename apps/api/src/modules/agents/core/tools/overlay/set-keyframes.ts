import { z } from "zod";
import {
	isNumericAnimationProperty,
	KEYFRAME_EASINGS,
	type NumericAnimationProperty,
} from "@maleo/shared";
import { clipKeyError, setKeys } from "@maleo/shared/editor";
import { defineTool } from "../../types.ts";
import { clipAt, executeEdit, runDocument } from "../../edit-document.ts";

export const setKeyframesArgs = z
	.object({
		target: z.enum(["scene", "video", "text"]),
		index: z.coerce.number().int().min(0),
		property: z.custom<NumericAnimationProperty>(
			(value) => typeof value === "string" && isNumericAnimationProperty(value),
			"unknown animatable property",
		),
		keys: z
			.array(
				z
					.object({ t: z.number(), v: z.number(), easing: z.enum(KEYFRAME_EASINGS).optional() })
					.strict(),
			)
			.max(48),
	})
	.strict();

/* Writes one property track as ordinary keyframes the timeline shows and the
 * user can then adjust (keyframe-animation): the `clip.setKeys` command the
 * editor's key lanes commit, which resolves where the clip keeps its animation
 * (a scene's primary visual, an overlay's layout) and refuses keys it cannot hold. */
export const setKeyframes = defineTool({
	name: "set_keyframes",
	kind: "mutate",
	edits: true,
	contentType: ["video"],
	intents: ["edit_element"],
	input: setKeyframesArgs,
	description:
		'set_keyframes { target: "scene"|"video"|"text", index, property: "xPct"|"yPct"|"scale"|"rotationDeg"|"opacity"|"volume"|"widthPct"|"heightPct"|"blur"|"fontSize"|..., keys: [{ t, v, easing? }] } - animate one property with keyframes; t is seconds from the clip\'s own start, v in the property\'s units (scale 1 = 100%, opacity 0..1, positions % of frame); easing linear|in|out|in-out|hold; keys [] removes the animation. e.g. slow zoom over 2-5s: property "scale", keys [{t:2,v:1},{t:5,v:1.25,easing:"in-out"}]',
	handler: async (ctx, args) => {
		const label =
			args.target === "text" ? "text overlay" : args.target === "video" ? "overlay clip" : "scene";
		const keys = [...args.keys].sort((a, b) => a.t - b.t);
		/* A refusal is reported, not thrown: the model reads it and can correct the
		 * keys, and nothing about the run is wrong. */
		try {
			const doc = runDocument(ctx.job);
			const clip = clipAt(doc, args.target, args.index);
			const invalid = clipKeyError(doc, clip.id, args.property, keys);
			if (invalid) return { note: `Refused: ${invalid}` };
			const outcome = executeEdit(ctx.job, setKeys(clip.id, args.property, keys));
			if (!outcome.ok) return { note: `Refused: ${outcome.error}` };
		} catch (error) {
			return { note: `Refused: ${error instanceof Error ? error.message : String(error)}` };
		}
		return {
			note: keys.length
				? `Keyed ${args.property} on ${label} ${args.index + 1} at ${keys.map((k) => `${k.t}s`).join(", ")}`
				: `Removed ${args.property} animation from ${label} ${args.index + 1}`,
		};
	},
});
