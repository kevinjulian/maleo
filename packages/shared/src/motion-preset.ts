import { z } from "zod";

// A reusable, user-authored keyframe camera motion. Mirrors the render engine's
// keyframe model (packages/video/src/lib/motion-keyframes.ts) so a saved preset
// applies to a clip verbatim.
export const MOTION_EASINGS = ["linear", "in", "out", "in-out", "bezier"] as const;

export const motionKeyframeSchema = z
	.object({
		t: z.number().min(0).max(1),
		scale: z.number().min(0).max(10),
		x: z.number().min(-2000).max(2000),
		y: z.number().min(-2000).max(2000),
		rotate: z.number().min(-360).max(360).optional(),
		easing: z.enum(MOTION_EASINGS).optional(),
	})
	.strict();

export const motionPresetInputSchema = z
	.object({
		name: z.string().trim().min(1).max(80),
		keyframes: z.array(motionKeyframeSchema).min(2).max(24),
	})
	.strict();

export const motionPresetSchema = motionPresetInputSchema.extend({
	id: z.string().min(1),
	createdAt: z.number().int().nonnegative(),
	updatedAt: z.number().int().nonnegative(),
});

export type MotionEasing = (typeof MOTION_EASINGS)[number];
export type MotionKeyframeInput = z.infer<typeof motionKeyframeSchema>;
export type MotionPresetInput = z.infer<typeof motionPresetInputSchema>;
export type MotionPreset = z.infer<typeof motionPresetSchema>;
