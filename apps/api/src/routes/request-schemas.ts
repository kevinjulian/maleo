/* Request-body schemas for the standalone API routes.
 *
 * Same rule as the operations group: each mirrors the shape its handler already
 * declared, and each handler keeps its own semantic checks because their
 * messages are specific. `intent`, `scene` and the rest of the image
 * request are named here rather than asserted, so a caller sending a number
 * where the renderer expects a prompt is answered rather than obeyed.
 */
import { z } from "zod";
import { imagePromptIntentSchema } from "@maleo/shared";

export const generateImageBody = z
	.object({
		prompt: z.string(),
		workspace: z.string(),
		aspect: z.string(),
		reference_image_urls: z.array(z.string()),
	})
	.partial();

export const sceneImageBody = z
	.object({
		project_id: z.string(),
		source: z.enum(["clip", "reference", "agent"]),
		aspect: z.string(),
		scene: z
			.object({
				sceneName: z.string(),
				visualDesc: z.string(),
				actionDesc: z.string(),
				shotType: z.string(),
				movement: z.string(),
			})
			.partial(),
		creativeNotes: z
			.object({
				tone: z.string(),
				colors: z.string(),
				target: z.string(),
			})
			.partial(),
		product: z
			.object({
				name: z.string(),
				category: z.string(),
				description: z.string(),
			})
			.partial(),
		product_image_urls: z.array(z.string()),
		style_image_urls: z.array(z.string()),
		character_description: z.string(),
		intent: imagePromptIntentSchema,
	})
	.partial();

export const imageToVideoBody = z.object({
	imageUrl: z.string().min(1),
	prompt: z.string().max(20000).optional(),
	durationSec: z.number().finite().positive().max(60).optional(),
	project_id: z.string().min(1).optional(),
});

/* `render` carries a `VideoRenderRequest`, which has no schema; `product` and
 * `storyboard` are documents this system wrote and the client is handing back.
 * Declared `unknown` rather than described, because describing them here would
 * be a claim nothing checks. */
export const videoRenderBody = z
	.object({
		product: z.unknown(),
		storyboard: z.unknown(),
		render: z.unknown(),
		preset: z.string(),
		backend: z.enum(["local", "lambda"]),
	})
	.partial()
	.extend({ project_id: z.string().min(1) });

export const patchCatalogBody = z
	.object({
		active: z.boolean(),
		notes: z.string(),
	})
	.partial();

export const ttsBody = z
	.object({
		text: z.string(),
		voice: z.string(),
		provider: z.string(),
		/* Attribution, not content. `project_id` decides which tenant the row lands
		 * on — the workspace comes from the project, never from the body — and
		 * `source` names the producer. Both optional: a lab synthesis has neither a
		 * project nor anything but the default source. */
		project_id: z.string(),
		source: z.enum(["lab", "scene", "agent"]),
	})
	.partial();

export const createWorkspaceBody = z.object({ name: z.unknown() }).partial();

/* What an owner may edit. `name` is absent on purpose: it is the partition key
 * for nineteen tables and everything reachable through them, so renaming stops
 * at `display_name`.
 *
 * `description` accepts null explicitly — clearing a description is a thing an
 * operator does, and `.partial()` alone cannot tell "leave it alone" from "make
 * it empty". */
export const updateWorkspaceBody = z
	.object({
		display_name: z.string().min(1).max(120),
		description: z.string().max(2000).nullable(),
	})
	.partial();

/* Deletion names the workspace it is deleting.
 *
 * The confirmation is the payload, not a flag: a boolean is something a client
 * sets once and forgets, and this operation has no undo. */
export const deleteWorkspaceBody = z.object({ confirm_name: z.string() });

export const inviteMemberBody = z.object({ role: z.enum(["owner", "member"]) }).partial();
