import { z } from "zod";
import { REFERENCE_USES, ROLES } from "./generation-cast.ts";

export const imagePromptReferenceSchema = z
	.object({
		url: z.string().min(1),
		role: z.enum(ROLES),
		entityId: z.string().min(1).optional(),
		label: z.string().min(1).optional(),
		description: z.string().optional(),
		primary: z.boolean().optional(),
		referenceUse: z.enum(REFERENCE_USES).optional(),
	})
	.strict();

export type ImagePromptReference = z.infer<typeof imagePromptReferenceSchema>;

export const imageSubjectLockSourceSchema = z.enum(["user", "material", "reference"]);
export type ImageSubjectLockSource = z.infer<typeof imageSubjectLockSourceSchema>;

export const imageSubjectLockSchema = z
	.object({
		source: imageSubjectLockSourceSchema,
		role: z.enum(ROLES).optional(),
		label: z.string().min(1),
		descriptors: z.array(z.string()).default([]),
		mustAvoid: z.array(z.string()).default([]),
		referenceId: z.string().min(1).optional(),
	})
	.strict();

export type ImageSubjectLock = z.infer<typeof imageSubjectLockSchema>;

export const imagePromptIntentSchema = z
	.object({
		output: z
			.object({
				kind: z.literal("single-image").default("single-image"),
				aspect: z.string().optional(),
				fullFrame: z.boolean().default(true),
			})
			.strict(),
		subjectLocks: z.array(imageSubjectLockSchema).default([]),
		scene: z
			.object({
				visualMoment: z.string().min(1),
				action: z.string().optional(),
				endState: z.string().optional(),
			})
			.strict(),
		composition: z
			.object({
				shotType: z.string().optional(),
				cameraAngle: z.string().optional(),
				framing: z.string().optional(),
				movement: z.string().optional(),
			})
			.strict()
			.optional(),
		style: z
			.object({
				medium: z.string().optional(),
				realism: z.string().optional(),
				visualTreatment: z.string().optional(),
			})
			.strict()
			.optional(),
		lightingColor: z
			.object({
				lighting: z.string().optional(),
				palette: z.string().optional(),
				mood: z.string().optional(),
			})
			.strict()
			.optional(),
		constraints: z
			.object({
				mustInclude: z.array(z.string()).default([]),
				mustAvoid: z.array(z.string()).default([]),
			})
			.strict()
			.default({}),
		negative: z.array(z.string()).default([]),
		references: z.array(imagePromptReferenceSchema).default([]),
	})
	.strict();

export type ImagePromptIntent = z.infer<typeof imagePromptIntentSchema>;
