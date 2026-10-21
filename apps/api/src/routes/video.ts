import { captionOutputBlockers } from "@maleo/shared";
import { Hono } from "hono";
import { fieldOf } from "@maleo/shared";
import {
	cancelRender,
	fetchJobFile,
	getJob,
	listPresets,
	listTemplates,
	retryRender,
	submitRender,
} from "../lib/video-client.ts";
import { getImageGenBaseUrl } from "../lib/image-gen-client.ts";
import {
	buildRenderStoryboardFromDoc,
	type BrandKit,
	type CaptionConfig,
	type Config,
	type InfographicStyle,
	type PacingDevices,
	type RefsState,
	type TimelineDoc,
	type TrackFlags,
} from "@maleo/shared";
import { imageToVideoBody, videoRenderBody } from "./request-schemas.ts";
import { getContentProject } from "@maleo/db/project-detail";
import { legacyRenderWorkspace } from "@maleo/db/renders";
import { activeWorkspace, workspaceScope } from "../lib/active-workspace.ts";
import { discoverProjectExports, listVideoExports } from "../lib/video-exports.ts";
import { renderJobStatusSchema } from "../lib/video-response-schemas.ts";
import { unknownWorkspaceRefusal } from "../lib/active-workspace.ts";
import { activeCaller } from "../lib/active-workspace.ts";
import { isWorkspaceMember } from "@maleo/db/workspace-members";
import { getMediaObject } from "@maleo/db/media-objects";
import { generateVideo } from "../lib/generation/video-generator.ts";
import { QuotaExceededError } from "../lib/metering/meter.ts";
import { resolveRenderMedia } from "../lib/video-media.ts";
import { serveMedia } from "./media.ts";
import type { RenderJob } from "../lib/video-client.ts";
import { renderMediaBlockers } from "../lib/render-media-preflight.ts";

// Clip-native render request: the client posts the canonical document + the
// projection inputs; the route runs the SHARED projection server-side so the
// render path consumes clips[] (the client no longer projects a storyboard).
interface VideoRenderRequest {
	doc: TimelineDoc;
	config: Config;
	refs: RefsState;
	trackFlags?: TrackFlags;
	captions?: CaptionConfig;
	pacingDevices?: PacingDevices;
	infographicStyle?: InfographicStyle;
	brand?: BrandKit;
	backgroundFill?: string;
}

// Scene images from the editor are dashboard-relative URLs
// (/api/image-gen/files/x.png) that the separate video service can't fetch.
// Rewrite them to absolute image-service URLs so the render worker can load
// them. No-op when the image service isn't configured.
function absolutizeStoryboardImages(storyboard: unknown): unknown {
	const base = getImageGenBaseUrl();
	if (!base || !storyboard || typeof storyboard !== "object") return storyboard;
	const root = base.replace(/\/$/, "");
	const abs = (u: unknown): unknown =>
		typeof u === "string" && u.startsWith("/api/image-gen/files/")
			? `${root}${u.replace("/api/image-gen", "")}`
			: u;
	const scenes = fieldOf(storyboard, "scenes");
	const videoOverlays = fieldOf(storyboard, "videoOverlays");
	return {
		...storyboard,
		scenes: Array.isArray(scenes)
			? scenes.map((scene: unknown) => ({
					...spreadable(scene),
					image: abs(fieldOf(scene, "image")),
				}))
			: scenes,
		// B-roll overlay media from the image service also needs absolute URLs.
		videoOverlays: Array.isArray(videoOverlays)
			? videoOverlays.map((overlay: unknown) => ({
					...spreadable(overlay),
					url: abs(fieldOf(overlay, "url")),
					thumb: abs(fieldOf(overlay, "thumb")),
				}))
			: videoOverlays,
	};
}

/** An array element as spread input: its own fields, or none when it is not an object. */
const spreadable = (value: unknown): object =>
	value !== null && typeof value === "object" ? value : {};

export function videoRoutes(): Hono {
	const app = new Hono();
	const mayRead = async (job: RenderJob, userId: string): Promise<boolean> => {
		const workspace =
			job.workspace ?? (await legacyRenderWorkspace(job.id, job.project_id ?? null));
		return Boolean(workspace && (await isWorkspaceMember(workspace, userId)));
	};

	app.get("/presets", async (c) => {
		try {
			const items = await listPresets();
			return c.json({ count: items.length, items });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.get("/templates", async (c) => {
		try {
			const items = await listTemplates();
			return c.json({ count: items.length, items });
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.get("/jobs", workspaceScope(), async (c) => {
		const limit = Number(c.req.query("limit") ?? 60);
		const offset = Number(c.req.query("offset") ?? 0);
		const status = c.req.query("status");
		if (
			!Number.isInteger(limit) ||
			limit < 1 ||
			limit > 500 ||
			!Number.isInteger(offset) ||
			offset < 0 ||
			(status && !renderJobStatusSchema.safeParse(status).success)
		)
			return c.json({ error: "invalid_query" }, 400);
		try {
			return c.json(
				await listVideoExports(activeWorkspace(c), {
					limit,
					offset,
					search: c.req.query("search"),
					project: c.req.query("project"),
					status: status ? renderJobStatusSchema.parse(status) : undefined,
				}),
			);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});
	app.get("/projects/:id/exports", workspaceScope(), async (c) => {
		try {
			const result = await discoverProjectExports(activeWorkspace(c), c.req.param("id"));
			return result ? c.json(result) : c.json({ error: "not_found" }, 404);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.post("/animate", async (c) => {
		const parsed = imageToVideoBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const sourceId = /^\/api\/media\/([0-9a-f-]{36})$/.exec(body.imageUrl)?.[1];
		let workspace: string;
		if (body.project_id) {
			const detail = await getContentProject(body.project_id);
			if (!detail) return c.json({ error: "project_not_found" }, 404);
			workspace = detail.project.workspace;
		} else {
			const source = sourceId ? await getMediaObject(sourceId) : null;
			if (!source || source.kind !== "image") return c.json({ error: "not_found" }, 404);
			workspace = source.workspace;
		}
		if (!(await isWorkspaceMember(workspace, activeCaller(c).userId)))
			return c.json({ error: "not_found" }, 404);
		try {
			return c.json(
				await generateVideo(
					{
						imageUrl: body.imageUrl,
						prompt: body.prompt ?? "",
						durationSec: body.durationSec ?? 4,
					},
					{ workspace, projectId: body.project_id },
				),
			);
		} catch (error) {
			return c.json(
				{ error: error instanceof Error ? error.message : String(error) },
				error instanceof QuotaExceededError ? 429 : 502,
			);
		}
	});

	app.post("/render", async (c) => {
		const parsed = videoRenderBody.safeParse(await c.req.json().catch(() => null));
		if (!parsed.success) {
			return c.json({ error: "body required" }, 400);
		}
		const body = parsed.data;
		const project = await getContentProject(body.project_id);
		if (!project) return c.json({ error: "project_not_found" }, 404);
		const refusal = await unknownWorkspaceRefusal(c, project.project.workspace);
		if (refusal) return refusal;
		// Clip-native render: project the posted document into the render storyboard
		// via the SHARED projection (same one the WYSIWYG preview uses), server-side.
		let preset = body.preset;
		let storyboard = body.storyboard;
		if (body.render) {
			// SAFETY: the editor handing back documents THIS system defines —
			// `TimelineDoc`, `Config` and `RefsState` are all written by the app that
			// is posting them. There is no schema for the timeline document yet, so
			// this is the same claim the agent routes make about their scenes, and it
			// is resolved by the same work: a schema for the document contract.
			const r = body.render as VideoRenderRequest;
			const captionIssues = captionOutputBlockers(
				r.doc.clips,
				r.captions ?? r.doc.captions,
				r.trackFlags,
			);
			if (captionIssues.length)
				return c.json({ error: "captions_need_refresh", blockers: captionIssues }, 422);
			const sourceBlockers = await renderMediaBlockers(
				r.doc,
				project.project.workspace,
				project.project.editor_state_json,
			);
			if (sourceBlockers.length)
				return c.json({ error: "media_unavailable", blockers: sourceBlockers }, 422);
			const built = buildRenderStoryboardFromDoc(r.config, r.refs, r.doc, {
				mediaAssets: project.project.editor_state_json?.media_assets,
				trackFlags: r.trackFlags,
				captions: r.captions,
				pacingDevices: r.pacingDevices,
				infographicStyle: r.infographicStyle,
				brand: r.brand,
				backgroundFill: r.backgroundFill,
			});
			preset = built.preset;
			storyboard = built.storyboard;
		}
		if (!preset) {
			return c.json({ error: "preset required" }, 400);
		}
		const isStoryboard = preset.startsWith("storyboard-");
		if (!isStoryboard && !body.product) {
			return c.json({ error: "product required for non-storyboard presets" }, 400);
		}
		if (isStoryboard && !storyboard && !body.product) {
			return c.json({ error: "storyboard data required" }, 400);
		}
		try {
			const blockers = await renderMediaBlockers(
				isStoryboard ? (storyboard ?? body.product) : body.product,
				project.project.workspace,
				project.project.editor_state_json,
			);
			if (blockers.length)
				return c.json({ error: "media_unavailable", message: blockers.join(" "), blockers }, 422);
			// Explicit request backend wins; otherwise the workspace default
			// (MALEO_VIDEO_BACKEND=lambda routes everything to Remotion Lambda).
			const defaultBackend =
				process.env.MALEO_VIDEO_BACKEND === "lambda" ? ("lambda" as const) : undefined;
			const job = await submitRender({
				project_id: project.project.id,
				workspace: project.project.workspace,
				product: isStoryboard
					? absolutizeStoryboardImages(storyboard ?? body.product)
					: body.product,
				preset,
				backend: body.backend ?? defaultBackend,
			});
			return c.json(job, 202);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.get("/render/:id", async (c) => {
		try {
			const j = await getJob(c.req.param("id"));
			if (!j) return c.json({ error: "not_found" }, 404);
			if (!(await mayRead(j, activeCaller(c).userId))) return c.json({ error: "not_found" }, 404);
			return c.json(await resolveRenderMedia(j));
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.post("/render/:id/cancel", async (c) => {
		try {
			const current = await getJob(c.req.param("id"));
			if (!current || !(await mayRead(current, activeCaller(c).userId)))
				return c.json({ error: "not_found" }, 404);
			const j = await cancelRender(c.req.param("id"));
			if (!j) return c.json({ error: "not_found" }, 404);
			return c.json(j);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.post("/render/:id/retry", async (c) => {
		const force = c.req.query("force") === "1" || c.req.query("force") === "true";
		const refreshImages =
			c.req.query("refresh_images") === "1" || c.req.query("refresh_images") === "true";
		try {
			const current = await getJob(c.req.param("id"));
			if (!current || !(await mayRead(current, activeCaller(c).userId)))
				return c.json({ error: "not_found" }, 404);
			const j = await retryRender(c.req.param("id"), { force, refreshImages });
			return c.json(j);
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	app.get("/render/:id/file", async (c) => {
		try {
			const job = await getJob(c.req.param("id"));
			if (!job || !(await mayRead(job, activeCaller(c).userId)))
				return c.json({ error: "not_found" }, 404);
			const resolved = await resolveRenderMedia(job);
			const mediaId =
				resolved.output_url && /^\/api\/media\/([0-9a-f-]{36})$/.exec(resolved.output_url)?.[1];
			if (mediaId)
				return serveMedia(mediaId, activeCaller(c).userId, c.req.header("range") ?? null);
			const upstream = await fetchJobFile(c.req.param("id"));
			if (!upstream.ok) {
				const text = await upstream.text();
				return c.json(
					{ error: "upstream_error", status: upstream.status, body: text.slice(0, 300) },
					502,
				);
			}
			return new Response(upstream.body, {
				status: 200,
				headers: {
					"content-type": upstream.headers.get("content-type") ?? "video/mp4",
					"content-disposition": upstream.headers.get("content-disposition") ?? `inline`,
				},
			});
		} catch (err) {
			return c.json({ error: err instanceof Error ? err.message : String(err) }, 502);
		}
	});

	return app;
}
