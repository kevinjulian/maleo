/* Content project list/feed + CRUD + editor-state routes. */
import { projectMediaLibrary } from "@maleo/db/project-media-assets";
import { commandSeqOfVersion } from "@maleo/db/project-commands";
import type { Hono } from "hono";
import { listContentFeed, listContentProjects } from "@maleo/db/content-projects";
import { listContentOutputs } from "@maleo/db/outputs";
import {
	createContentProject,
	getContentProject,
	setContentEditorState,
	updateContentProject,
} from "@maleo/db/project-detail";
import { CONTENT_PROJECT_TYPE_LIST, CONTENT_PROJECT_STATUS_LIST } from "./constants.ts";
import { activeWorkspace } from "../../lib/active-workspace.ts";
import {
	toProjectNoteWires,
	toProjectSpeakerWires,
	toReferenceEntityWires,
} from "../../lib/wire/reference-entity.ts";
import {
	localMediaUrlIssues,
	retainedProjectVisuals,
	oneOf,
	readStoryboardDocument,
	PROJECT_FEED_SORTS,
} from "@maleo/shared";
import { createProjectBody, editorStateBody, patchProjectBody } from "./request-schemas.ts";
import { resolveLegacyStoryboardMedia } from "../../lib/legacy-storyboard-media.ts";

/* The roster a new project should start with.
 *
 * Two sources, and using either alone loses references. `reference_entity_ids`
 * is the creation form's own pool. The seed document's
 * `projectReferences.entityIds` is what a Project Preset selected — the preset
 * seeds the document, never the pool, so a project created from a preset
 * arrived with an empty roster and a lock naming references it had not
 * attached. That is the `Lidiman`/`Sketch Stickman` failure at its origin.
 *
 * Ids that do not resolve are dropped by `createContentProject`'s attach, which
 * validates workspace membership per id. */
function seededRosterIds(body: {
	reference_entity_ids?: unknown;
	seed_storyboard?: { storyboard_json?: unknown } | null;
}): string[] {
	const fromBody = Array.isArray(body.reference_entity_ids)
		? body.reference_entity_ids.filter(
				(id): id is string => typeof id === "string" && id.length > 0,
			)
		: [];
	const fromDocument = body.seed_storyboard?.storyboard_json
		? readStoryboardDocument(body.seed_storyboard.storyboard_json).doc.projectReferences.entityIds
		: [];
	return [...new Set([...fromBody, ...fromDocument])];
}

export function registerProjectRoutes(app: Hono): void {
	app.get("/projects", async (c) => {
		const rawType = c.req.query("type");
		const rawStatus = c.req.query("status");
		const type = oneOf(rawType, CONTENT_PROJECT_TYPE_LIST);
		const status = oneOf(rawStatus, CONTENT_PROJECT_STATUS_LIST);
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500));
		const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
		if (rawType && !type) return c.json({ error: "invalid project type" }, 400);
		if (rawStatus && !status) return c.json({ error: "invalid project status" }, 400);
		const items = await listContentProjects({
			workspace: activeWorkspace(c),
			type,
			status,
			limit,
			offset,
		});
		return c.json({ items, total: items.length, limit, offset });
	});

	// Project-centric, server-paginated content list. Drives the Content page so search,
	// filters, pagination, and the real total all resolve server-side.
	app.get("/content/feed", async (c) => {
		const rawSort = c.req.query("sort");
		const sort = oneOf(rawSort, PROJECT_FEED_SORTS);
		if (rawSort && !sort) return c.json({ error: "invalid project sort" }, 400);
		const rawType = c.req.query("type");
		const rawStatus = c.req.query("status");
		const type = oneOf(rawType, CONTENT_PROJECT_TYPE_LIST);
		const status = oneOf(rawStatus, CONTENT_PROJECT_STATUS_LIST);
		const platform = c.req.query("platform") ?? undefined;
		const campaign_id = c.req.query("campaign_id") ?? undefined;
		const search = c.req.query("search")?.trim() || undefined;
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "20", 10) || 20, 100));
		const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
		if (rawType && !type) return c.json({ error: "invalid project type" }, 400);
		if (rawStatus && !status) return c.json({ error: "invalid project status" }, 400);
		const { items, total, facets } = await listContentFeed({
			workspace: activeWorkspace(c),
			type,
			status,
			platform,
			campaign_id,
			search,
			sort,
			limit,
			offset,
		});
		return c.json({ items, total, limit, offset, facets });
	});

	app.get("/outputs", async (c) => {
		const campaign_id = c.req.query("campaign_id") ?? undefined;
		const project_id = c.req.query("project_id") ?? undefined;
		const status = c.req.query("status") ?? undefined;
		const limit = Math.max(1, Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500));
		const offset = Math.max(0, parseInt(c.req.query("offset") ?? "0", 10) || 0);
		const items = await listContentOutputs({
			workspace: activeWorkspace(c),
			campaign_id,
			project_id,
			status,
			limit,
			offset,
		});
		return c.json({ items, total: items.length, limit, offset });
	});

	app.post("/projects", async (c) => {
		const parsed = createProjectBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.title?.trim()) return c.json({ error: "title required" }, 400);
		if (body.seed_storyboard?.storyboard_json) {
			try {
				body.seed_storyboard.storyboard_json = retainedProjectVisuals(
					body.seed_storyboard.storyboard_json,
				);
			} catch (error) {
				return c.json(
					{
						error: "invalid_visual_contract",
						message: error instanceof Error ? error.message : "Repair imported visual elements.",
					},
					409,
				);
			}
		}
		const seedOutputs = Array.isArray(body.seed_outputs)
			? body.seed_outputs
					.map((output) => ({
						channel: typeof output.channel === "string" ? output.channel : null,
						platform: typeof output.platform === "string" ? output.platform : null,
						kind: typeof output.kind === "string" ? output.kind : "draft",
						title: typeof output.title === "string" ? output.title : "",
						status: typeof output.status === "string" ? output.status : "draft",
						notes: typeof output.notes === "string" ? output.notes : null,
						content_json: output.content_json ?? null,
					}))
					.filter((output) => output.title.trim().length > 0)
			: [];
		const project = await createContentProject({
			// The tenant comes from the resolver, never from the body: one place
			// names a workspace per request, and the project it creates belongs to
			// the workspace the operator is actually in.
			workspace: activeWorkspace(c),
			title: body.title.trim(),
			type: body.type ?? "video",
			status: body.status ?? "brief",
			target_platform: body.target_platform ?? null,
			target_audience: body.target_audience ?? null,
			target_duration_sec:
				typeof body.target_duration_sec === "number" && Number.isFinite(body.target_duration_sec)
					? body.target_duration_sec
					: null,
			target_format: body.target_format ?? null,
			language: body.language ?? null,
			campaign_id: body.campaign_id ?? null,
			reference_notes: body.reference_notes ?? null,
			brief_json: body.brief_json ?? null,
			editor_state:
				body.editor_state && typeof body.editor_state === "object" ? body.editor_state : null,
			speakers: Array.isArray(body.speakers)
				? body.speakers
						.map((speaker) => ({
							voice_key: typeof speaker.voice_key === "string" ? speaker.voice_key : "",
							name: typeof speaker.name === "string" ? speaker.name : "",
							hue:
								typeof speaker.hue === "number" && Number.isFinite(speaker.hue)
									? speaker.hue
									: null,
							is_default: speaker.is_default === true,
						}))
						.filter((speaker) => speaker.voice_key && speaker.name)
				: [],
			reference_entity_ids: seededRosterIds(body),
			lead_entity_id:
				typeof body.lead_entity_id === "string" && body.lead_entity_id ? body.lead_entity_id : null,
			seed_storyboard: body.seed_storyboard?.storyboard_json
				? {
						source_prompt: body.seed_storyboard.source_prompt ?? null,
						reference_notes: body.seed_storyboard.reference_notes ?? null,
						status: body.seed_storyboard.status ?? "draft",
						storyboard_json: body.seed_storyboard.storyboard_json,
					}
				: undefined,
			seed_outputs: seedOutputs,
		});
		return c.json({ ok: true, project }, 201);
	});

	app.get("/projects/:id", async (c) => {
		const detail = await getContentProject(c.req.param("id"));
		if (!detail) return c.json({ error: "project_not_found" }, 404);
		// The project's children cross as domain objects, not rows: the client should
		// never see `is_primary: 0`, `tags_json`, `canonical_image_url`, or an
		// integer standing in for a boolean.
		return c.json({
			...detail,
			storyboards: await Promise.all(
				detail.storyboards.map(async (storyboard) => ({
					...storyboard,
					storyboard_json: await resolveLegacyStoryboardMedia(
						storyboard.storyboard_json,
						detail.project.workspace,
					),
				})),
			),
			entities: toReferenceEntityWires(detail.entities),
			notes: toProjectNoteWires(detail.notes),
			speakers: toProjectSpeakerWires(detail.speakers),
			/* The project's media library: its rows, never the editor state's list. */
			mediaAssets: await projectMediaLibrary(detail.project.id),
			/* Where the editor's command log reading starts: the entry that wrote the
			 * version it loads, so a write landing after this read is delivered. */
			commandSeq: detail.storyboards[0]
				? await commandSeqOfVersion(detail.project.id, detail.storyboards[0].version)
				: 0,
		});
	});

	// Mutable editor state (chat log + media library), separate from versioned
	// storyboard snapshots so it isn't duplicated into every version or lost on a
	// partial storyboard save.
	app.put("/projects/:id/editor-state", async (c) => {
		const parsed = editorStateBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (!body.editor_state || typeof body.editor_state !== "object") {
			return c.json({ error: "editor_state required" }, 400);
		}
		const localUrls = localMediaUrlIssues(body.editor_state);
		if (localUrls.length) return c.json({ error: "local_media_url", issues: localUrls }, 400);
		const ok = await setContentEditorState(c.req.param("id"), body.editor_state);
		if (!ok) return c.json({ error: "project_not_found" }, 404);
		return c.json({ ok: true });
	});

	app.put("/projects/:id", async (c) => {
		const parsed = patchProjectBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		if (body.title !== undefined && !body.title.trim())
			return c.json({ error: "title cannot be empty" }, 400);
		const project = await updateContentProject(c.req.param("id"), {
			...(body.title !== undefined ? { title: body.title.trim() } : {}),
			...(body.type !== undefined ? { type: body.type } : {}),
			...(body.status !== undefined ? { status: body.status } : {}),
			...(body.target_platform !== undefined ? { target_platform: body.target_platform } : {}),
			...(body.target_audience !== undefined ? { target_audience: body.target_audience } : {}),
			...(body.target_duration_sec !== undefined
				? {
						target_duration_sec:
							typeof body.target_duration_sec === "number" &&
							Number.isFinite(body.target_duration_sec)
								? body.target_duration_sec
								: null,
					}
				: {}),
			...(body.target_format !== undefined ? { target_format: body.target_format } : {}),
			...(body.language !== undefined ? { language: body.language } : {}),
			...(body.campaign_id !== undefined ? { campaign_id: body.campaign_id } : {}),
			...(body.reference_notes !== undefined ? { reference_notes: body.reference_notes } : {}),
			...(body.brief_json !== undefined ? { brief_json: body.brief_json } : {}),
		});
		if (!project) return c.json({ error: "project_not_found" }, 404);
		// `updateContentProject` already returns the re-read detail; asking for it
		// again made this handler read the aggregate three times for one write.
		return c.json({ ok: true, project });
	});
}
