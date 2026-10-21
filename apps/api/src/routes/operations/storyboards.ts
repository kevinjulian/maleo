/* Storyboard version save and authoring routes. */
import type { Hono } from "hono";
import { getContentProject } from "@maleo/db/project-detail";
import { syncProjectReferenceLock } from "@maleo/db/references";
import { addContentStoryboard, StoryboardRevisionConflict } from "@maleo/db/storyboards";
import {
	clipControlBlockers,
	CaptionClipSchema,
	CaptionSetSchema,
	captionStateFingerprint,
	localMediaUrlIssues,
	readStoryboardDocument,
	readStoryboardPosts,
	readStoryboardSlides,
	writeStoryboardDocument,
	writeStoryboardPosts,
	writeStoryboardSlides,
} from "@maleo/shared";
import {
	approveStoryboard,
	commandStoryboard,
	readStoryboardAuthoring,
} from "../../lib/storyboard-authoring.ts";

import {
	createStoryboardBody,
	storyboardApprovalBody,
	storyboardCommandBody,
} from "./request-schemas.ts";

export function registerStoryboardRoutes(app: Hono): void {
	app.get("/projects/:id/storyboard-authoring", async (c) => {
		const snapshot = await readStoryboardAuthoring(c.req.param("id"));
		return snapshot ? c.json(snapshot) : c.json({ error: "project_not_found" }, 404);
	});

	app.post("/projects/:id/storyboard-authoring/commands", async (c) => {
		const parsed = storyboardCommandBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await commandStoryboard(
			c.req.param("id"),
			parsed.data.expectedRevisionId,
			parsed.data.command,
		);
		if (result.ok) return c.json(result, 201);
		const status = result.reason === "not_found" ? 404 : result.reason === "conflict" ? 409 : 422;
		return c.json(result, status);
	});

	app.post("/projects/:id/storyboard-authoring/approve", async (c) => {
		const parsed = storyboardApprovalBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const result = await approveStoryboard(
			c.req.param("id"),
			parsed.data.expectedRevisionId,
			parsed.data.extensionPolicy,
		);
		if (result.ok) return c.json(result, 201);
		const status = result.reason === "not_found" ? 404 : result.reason === "conflict" ? 409 : 422;
		return c.json(result, status);
	});

	app.post("/projects/:id/storyboards", async (c) => {
		const parsed = createStoryboardBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.storyboard_json || typeof body.storyboard_json !== "object") {
			return c.json({ error: "storyboard_json required" }, 400);
		}
		const localUrls = localMediaUrlIssues(body.storyboard_json);
		if (localUrls.length) return c.json({ error: "local_media_url", issues: localUrls }, 400);
		const keyIssues = clipControlBlockers(body.storyboard_json);
		if (keyIssues.length)
			return c.json({ error: "invalid_clip_animation", issues: keyIssues }, 400);
		const projectId = c.req.param("id");
		/* Artifacts and the unit lifecycle are agent-owned and never authored by the
		 * client: the editor's autosave serializes clips and markers and does not carry
		 * them. So this route is a writer that lacks a field, and it does what every
		 * such writer does under the document contract — reads them from the prior
		 * document and supplies them explicitly.
		 *
		 * It used to do that as a special case: an `if` over an untyped blob that
		 * re-attached one hand-named key when the incoming array was empty. The
		 * behaviour is the same; what changed is that it goes through the typed
		 * document, so a field added to the contract flows through here without anyone
		 * remembering to extend a list.
		 *
		 * Deleting this outright — as this change first proposed — would drop a longform
		 * plan on any autosave between planning and approval. That was checked rather
		 * than assumed: the editor's payload still carries no `artifacts` key, because
		 * the editor genuinely does not own one. */
		const ownsCaptions = Object.hasOwn(body.storyboard_json, "captionSet");
		if (ownsCaptions && !CaptionSetSchema.safeParse(body.storyboard_json.captionSet).success)
			return c.json({ error: "invalid_caption_set" }, 400);
		const rawClips = body.storyboard_json.clips;
		if (
			Array.isArray(rawClips) &&
			rawClips.some(
				(clip) =>
					clip?.type === "caption" && (!ownsCaptions || !CaptionClipSchema.safeParse(clip).success),
			)
		)
			return c.json({ error: "invalid_caption_clip" }, 400);
		const incoming = readStoryboardDocument(body.storyboard_json).doc;
		const latest = (await getContentProject(projectId))?.storyboards?.[0];
		const prior = readStoryboardDocument(latest?.storyboard_json).doc;
		if (
			ownsCaptions &&
			body.expectedCaptionState !== captionStateFingerprint(prior) &&
			captionStateFingerprint(incoming) !== captionStateFingerprint(prior)
		)
			return c.json(
				{ error: "caption_conflict", message: "Captions changed; reload and retry." },
				409,
			);
		/* A carousel or a thread is saved as its slides or posts, which the timeline
		 * document does not carry; they are decoded and written through the same
		 * writers the agent uses, so an autosave keeps them. */
		const slides = readStoryboardSlides(body.storyboard_json);
		const posts = readStoryboardPosts(body.storyboard_json);
		const storyboard_json = {
			...writeStoryboardDocument({
				...incoming,
				...(!ownsCaptions && prior.captionSet
					? {
							captionSet: prior.captionSet,
							captions: prior.captions,
							clips: [
								...incoming.clips.filter((clip) => clip.type !== "caption"),
								...prior.clips.filter((clip) => clip.type === "caption"),
							],
						}
					: {}),
				artifacts: incoming.artifacts.length ? incoming.artifacts : prior.artifacts,
				unitLifecycle: incoming.unitLifecycle ?? prior.unitLifecycle,
			}),
			...(slides.length ? { slides: writeStoryboardSlides(slides) } : {}),
			...(posts.length ? { posts: writeStoryboardPosts(posts) } : {}),
		};
		let storyboard;
		try {
			storyboard = await addContentStoryboard({
				project_id: projectId,
				expectedRevisionId: latest?.id ?? null,
				source_prompt: body.source_prompt ?? null,
				reference_notes: body.reference_notes ?? null,
				status: body.status ?? "draft",
				storyboard_json,
			});
		} catch (error) {
			if (error instanceof StoryboardRevisionConflict)
				return c.json({ error: "storyboard_conflict", message: error.message }, 409);
			throw error;
		}
		if (!storyboard) return c.json({ error: "project_not_found" }, 404);
		/* The lock and the roster are written together, here, because this is the
		 * one route that persists the lock.
		 *
		 * Preset application is a client-side computation that ends in this save,
		 * and it wrote `projectReferences.entityIds` alone — so a preset selecting
		 * `Sketch Stickman` produced a document naming it and a roster without it,
		 * and generation resolved nothing. Doing the attach in the preset code
		 * would have fixed that one caller and left every other writer of the
		 * document free to drift again.
		 *
		 * `syncProjectReferenceLock` validates workspace membership and is
		 * idempotent, so a repeated autosave neither duplicates roster rows nor
		 * lets a foreign entity in. Ids it could not attach are reported, not
		 * swallowed: the client marks them unresolved and generation blocks. */
		const lock = await syncProjectReferenceLock({
			project_id: projectId,
			entity_ids: readStoryboardDocument(storyboard_json).doc.projectReferences.entityIds,
		});
		return c.json({ ok: true, storyboard, references: lock }, 201);
	});
}
