import { Hono } from "hono";
import { oneOf, textOf } from "@maleo/shared";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { buildImagePrompt, type ImagePromptIntent, type ImagePromptReference } from "@maleo/shared";
import { getImageGenBaseUrl, getImageGenHealth } from "../lib/image-gen-client.ts";
import { getWorkspaceImageStyle } from "../lib/workspace-image-style.ts";
import { extractSceneOverrides } from "../lib/scene-extractor.ts";
import { recordGeneration } from "../lib/image-policy.ts";
import { meter, QuotaExceededError } from "../lib/metering/meter.ts";
import { getContentProject } from "@maleo/db/project-detail";
import { unknownWorkspaceRefusal } from "../lib/active-workspace.ts";
import { storeManagedMedia } from "../lib/media-storage.ts";
import { activeCaller } from "../lib/active-workspace.ts";
import { findLegacyMediaForUser } from "@maleo/db/media-objects";
import { serveMedia } from "./media.ts";
import {
	findByJobId,
	imageFacets,
	listImages,
	softDeleteImage,
	toggleStar as toggleImageStar,
	IMAGE_SOURCES,
} from "@maleo/db/image-ledger";
import {
	submitImageJob,
	pollImageJob,
	recordJobCompleted,
	recordJobFailed,
	ImageSubmitFailedError,
} from "../lib/generation/image-generator.ts";
import {
	trackJob as persistJob,
	markJobDone,
	markJobFailed,
	listActiveJobs,
} from "@maleo/db/image-jobs";
import { generateImageBody, sceneImageBody } from "./request-schemas.ts";

/* Hono types `c.json`'s status as a literal union of the codes it knows, so a
 * number forwarded from upstream does not fit without a cast. That cast is the
 * same claim at four call sites, so it is made once here. */
function upstreamStatus(status: number): ContentfulStatusCode {
	// SAFETY: an HTTP status forwarded verbatim from the image provider's own
	// response. Deliberately not narrowed — this route is a proxy, so the
	// contract is that the upstream status reaches the caller unchanged, and
	// mapping it onto a code Hono happens to list would invent a different
	// response. The assertion buys the literal type Hono's signature wants and
	// claims nothing about the value.
	return status as ContentfulStatusCode;
}

/* The tenant a non-project generation belongs to. Mirrors `workspaceOf` in
 * routes/operations/content-materials.ts: single-workspace deployments send no
 * workspace and the column's default matches. Kept as a named function so the
 * fallback is one identifiable place rather than a bare string at a call site. */
function defaultWorkspace(): string {
	return "default";
}

/* `jobWorkspaceMap` and `findJobAcrossWorkspaces` are gone.
 *
 * Attribution used to live in an in-memory Map keyed by job id, capped at 1000
 * entries. A restart between submit and completion emptied it, and an eviction
 * dropped it under load — and in both cases the completion handler found no
 * tracked job and silently skipped recordGeneration, recordPromptUse and
 * markJobDone. The ledger opens its row before submit, so the association is in
 * SQLite from the first moment and survives both.
 *
 * `trackJob` remains only to keep the image_jobs polling record, which is a
 * separate 7-day operational table with its own prune. */
function trackJob(jobId: string, workspace: string, prompt: string): Promise<void> {
	return persistJob(workspace, jobId, prompt);
}

function compact(value: string | undefined): string {
	return (value ?? "")
		.replace(/(^|[\s([{"'])@([^\s,).!?;:"'\]}][^,).!?;:"'\]}]*)/gu, "$1$2")
		.replace(/\s+/g, " ")
		.trim();
}

function csv(value: string | undefined): string[] {
	return (value ?? "").split(",").map(compact).filter(Boolean);
}

function legacySceneIntent(input: {
	sceneName?: string;
	visualDesc?: string;
	actionDesc?: string;
	shotType?: string;
	movement?: string;
	aspect?: string;
	tone?: string;
	colors?: string;
	target?: string;
	style?: Awaited<ReturnType<typeof getWorkspaceImageStyle>>;
	product?: { name?: string; category?: string; description?: string };
	productRefs: ImagePromptReference[];
	styleRefs: ImagePromptReference[];
	characterDescription?: string;
}): ImagePromptIntent {
	const productLocks = input.productRefs.map((ref) => ({
		source: "reference" as const,
		role: ref.role,
		label: ref.label ?? input.product?.name ?? ref.entityId ?? "product",
		descriptors: [input.product?.description, ref.description].map(compact).filter(Boolean),
		mustAvoid: [],
		referenceId: ref.entityId,
	}));
	const characterLock = compact(input.characterDescription)
		? [
				{
					source: "user" as const,
					role: "character" as const,
					label: "Character",
					descriptors: [compact(input.characterDescription)],
					mustAvoid: [],
				},
			]
		: [];
	return {
		output: { kind: "single-image", aspect: input.aspect, fullFrame: true },
		subjectLocks: [...productLocks, ...characterLock],
		scene: {
			visualMoment: compact(input.visualDesc) || compact(input.sceneName) || "scene image",
			action: compact(input.actionDesc),
		},
		composition: {
			shotType: input.shotType || "Medium Shot",
			movement: input.movement || "Static",
		},
		style: {
			medium: input.style?.style,
			visualTreatment: compact(input.target),
		},
		lightingColor: {
			lighting: input.style?.lighting_default,
			palette: compact(input.colors),
			mood: compact(input.tone),
		},
		constraints: { mustInclude: [], mustAvoid: [] },
		negative: csv(input.style?.negative),
		references: [...input.productRefs, ...input.styleRefs],
	};
}

export function imageGenRoutes(): Hono {
	const app = new Hono();

	/* Generated images, across every workspace and project unless narrowed.
	 *
	 * Replaces /history/:workspace, which read prompt_library — one row per PROMPT,
	 * lab-only, and blind to the clip, reference and agent images that were never
	 * recorded at all. The store filters to completed, not-deleted rows, so a
	 * pending or failed attempt cannot surface here as an image. */
	app.get("/images", async (c) => {
		const q = c.req.query();
		// An unregistered workspace is refused, not served an empty gallery. Empty
		// is a real answer here — most workspaces own no images — so a typo that
		// returned 200 with zero rows was indistinguishable from the truth.
		const refusal = await unknownWorkspaceRefusal(c, q.workspace);
		if (refusal) return refusal;
		const limit = Number.parseInt(q.limit ?? "100", 10);
		const offset = Number.parseInt(q.offset ?? "0", 10);
		/* A query param is client input, so membership is checked rather than
		 * asserted. A `?source=` the ledger does not know now behaves as absent —
		 * the listing is unfiltered — where before it travelled into the query as
		 * a value nothing matched, returning an empty page that looked like "no
		 * images" rather than "no such source". */
		const source = oneOf(q.source, IMAGE_SOURCES);
		const items = await listImages({
			workspace: q.workspace?.trim() || undefined,
			// `project=none` selects images that belong to no project — a real answer,
			// distinct from "do not filter by project".
			projectId: q.project === "none" ? null : q.project?.trim() || undefined,
			source: source && ["lab", "clip", "reference", "agent"].includes(source) ? source : undefined,
			search: q.q,
			limit: Number.isFinite(limit) ? limit : 100,
			offset: Number.isFinite(offset) ? offset : 0,
		});
		return c.json({ items });
	});

	/* The values the gallery's project filter can offer, within one workspace.
	 * There is no workspace facet: the gallery shows the active workspace and
	 * offers no control to leave it. */
	app.get("/images/facets", async (c) => {
		const workspace = c.req.query("workspace")?.trim();
		const refusal = await unknownWorkspaceRefusal(c, workspace);
		if (refusal) return refusal;
		return c.json(await imageFacets(workspace || undefined));
	});

	app.post("/images/:id/star", async (c) => {
		return c.json({ ok: await toggleImageStar(c.req.param("id")) });
	});

	/* A hide, not a delete. This row is the artifact side of a metered, billed
	 * generation; tidying a gallery must not make that spend unattributable. */
	app.delete("/images/:id", async (c) => {
		return c.json({ ok: await softDeleteImage(c.req.param("id")) });
	});

	app.get("/active-jobs/:workspace", async (c) => {
		const jobs = await listActiveJobs(c.req.param("workspace"));
		return c.json({ jobs });
	});

	app.get("/health", async (c) => {
		const h = await getImageGenHealth();
		return c.json(h);
	});

	// Return the workspace's image_style block so the operator can preview
	// what scaffold the next generation will use.
	app.get("/workspace-style/:name", async (c) => {
		const style = await getWorkspaceImageStyle(c.req.param("name"));
		if (!style) return c.json({ configured: false, style: null });
		return c.json({ configured: true, style });
	});

	// Kick off image generation. Body: { prompt, workspace? }.
	// When `workspace` is set, the corresponding image_style profile is read
	// from the workspace config and forwarded to maleo-image so the result
	// matches that character's locked look (face, outfit, theme, etc.).
	app.post("/generate", async (c) => {
		const parsed = generateImageBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		const prompt = (body.prompt ?? "").trim();
		if (!prompt) return c.json({ error: "prompt_required" }, 400);
		// A generation with no workspace can be neither metered nor attributed. It used
		// to proceed anyway and record nothing; that silent path is the defect this
		// change closes, so it is now a refusal. The lab already gates its submit on a
		// selected workspace, so no working caller loses anything.
		const workspace = body.workspace?.trim();
		if (!workspace) return c.json({ error: "workspace_required" }, 400);
		// Validated against the registry BEFORE metering. A generation billed to a
		// workspace that does not exist is spend attributed to nothing: the ledger
		// row and the credit capture both carry a tenant no switcher can select and
		// no report can group by.
		const refusal = await unknownWorkspaceRefusal(c, workspace);
		if (refusal) return refusal;
		const base = getImageGenBaseUrl();
		if (!base) return c.json({ error: "not_configured" }, 503);
		const style = await getWorkspaceImageStyle(workspace);
		const scene = await extractSceneOverrides(prompt);
		const aspect = ["1:1", "16:9", "9:16"].includes(body.aspect ?? "") ? body.aspect : undefined;
		const builtPrompt = buildImagePrompt(prompt, style, scene);
		const directRefUrls = (body.reference_image_urls ?? [])
			.filter(
				(u): u is string =>
					typeof u === "string" &&
					(/^https?:\/\//.test(u) || /^\/api\/media\/[0-9a-f-]{36}$/.test(u)),
			)
			.slice(0, 4);
		try {
			const referenceImageUrls = directRefUrls.length
				? directRefUrls.map((url) => ({ url, role: "reference" }))
				: undefined;
			const { job_id, status, raw } = await meter({
				operation: "image",
				quantity: 1,
				provider: "image-service",
				model: referenceImageUrls?.length ? "image-service+refs" : "image-service",
				reference: "image:route",
				workspace,
				metadata: { aspect, route: "generate" },
				run: () =>
					submitImageJob(
						{ prompt: builtPrompt, aspect, referenceImageUrls },
						{ workspace, source: "lab" },
					),
			});
			if (job_id) await trackJob(job_id, workspace, prompt);
			return c.json(raw, upstreamStatus(status));
		} catch (err) {
			// The workspace quota and the credit ledger are one gate now; a refusal
			// keeps the 429 contract this route has always had.
			if (err instanceof QuotaExceededError)
				return c.json({ error: "image_policy", ...err.gate }, 429);
			// A submit that produced no job throws so meter() releases instead of
			// capturing. The upstream status and body are still forwarded verbatim,
			// which is the proxy contract this route has always had.
			if (err instanceof ImageSubmitFailedError) return c.json(err.raw, upstreamStatus(err.status));
			return c.json(
				{ error: "upstream_failed", message: err instanceof Error ? err.message : String(err) },
				502,
			);
		}
	});

	// Scene-aware image generation. Uses structured scene data + template prompt.
	app.post("/generate-scene", async (c) => {
		const base = getImageGenBaseUrl();
		if (!base) return c.json({ error: "not_configured" }, 503);
		const parsed = sceneImageBody.safeParse(await c.req.json().catch(() => ({})));
		if (!parsed.success) return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
		const body = parsed.data;
		/* Defaulted rather than assumed present. The old type declared `scene`
		 * required while the guard below reads it as `sc?.visualDesc`, so a body
		 * without one has always been accepted — the type was the optimistic
		 * reading, not the route's contract. */
		const sc = body.scene ?? {};
		if (!body.intent && !sc?.visualDesc) return c.json({ error: "scene.visualDesc required" }, 400);
		// This route never received any generation context — buildSceneImageRequest
		// sent no workspace at all — so every clip, reference and studio image it
		// produced was unmetered and unrecorded.
		//
		// The workspace comes from the PROJECT, not from the body: content_projects
		// .workspace is the authoritative record of which tenant owns the project, and
		// a body field would let a caller pick a tenant by sending different JSON.
		const projectId = body.project_id?.trim() || null;
		const source = body.source ?? (projectId ? "clip" : "reference");
		const workspace = projectId
			? ((await getContentProject(projectId))?.project.workspace ?? null)
			: defaultWorkspace();
		if (!workspace) {
			return c.json({ error: projectId ? "project_not_found" : "workspace_unresolved" }, 400);
		}
		const refusal = await unknownWorkspaceRefusal(c, workspace);
		if (refusal) return refusal;
		const style = await getWorkspaceImageStyle(workspace);
		const aspect = ["1:1", "16:9", "9:16", "4:5", "3:4"].includes(body.aspect ?? "")
			? body.aspect
			: undefined;
		const managedOrRemote = (u: string) =>
			u.startsWith("http") || /^\/api\/media\/[0-9a-f-]{36}$/.test(u);
		const productImageUrls = (body.product_image_urls ?? []).filter(
			(u) => typeof u === "string" && managedOrRemote(u),
		);
		// Global style lock: a "style" role ref — match its look, NOT its subject.
		const styleImageUrls = (body.style_image_urls ?? []).filter(
			(u) => typeof u === "string" && managedOrRemote(u),
		);
		try {
			const legacyRefs: ImagePromptReference[] = [
				...productImageUrls.map((url) => ({
					url,
					role: "product" as const,
					entityId: "product",
					label: body.product?.name,
					description: body.product?.description,
				})),
				...styleImageUrls.map((url) => ({
					url,
					role: "style" as const,
					label: "Global style reference",
				})),
			];
			const intent =
				body.intent ??
				legacySceneIntent({
					sceneName: sc.sceneName,
					visualDesc: sc.visualDesc,
					actionDesc: sc.actionDesc,
					shotType: sc.shotType,
					movement: sc.movement,
					aspect,
					tone: body.creativeNotes?.tone,
					colors: body.creativeNotes?.colors,
					target: body.creativeNotes?.target,
					style,
					product: body.product,
					productRefs: legacyRefs.filter((ref) => ref.role === "product"),
					styleRefs: legacyRefs.filter((ref) => ref.role === "style"),
					characterDescription: body.character_description,
				});
			const prompt = intent.scene.visualMoment;
			const { job_id, status, raw } = await meter({
				operation: "image",
				quantity: 1,
				provider: "image-service",
				model: intent.references.length ? "image-service+refs" : "image-service",
				reference: "image:route-scene",
				workspace,
				metadata: { aspect, route: "generate-scene" },
				run: () =>
					submitImageJob(
						{
							prompt,
							aspect,
							referenceImageUrls: intent.references,
							intent,
						},
						{ workspace, projectId, source },
					),
			});
			if (job_id) await trackJob(job_id, workspace, prompt);
			return c.json(raw, upstreamStatus(status));
		} catch (err) {
			if (err instanceof QuotaExceededError)
				return c.json({ error: "image_policy", ...err.gate }, 429);
			if (err instanceof ImageSubmitFailedError) return c.json(err.raw, upstreamStatus(err.status));
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[image-gen/scene] upstream error: ${msg}`);
			return c.json({ error: "upstream_failed", message: msg }, 502);
		}
	});

	// Poll job status. Rewrites image_url to /api/image-gen/files/* so
	// the client uses the proxy path and never sees upstream URL/auth.
	app.get("/jobs/:id", async (c) => {
		const base = getImageGenBaseUrl();
		if (!base) return c.json({ error: "not_configured" }, 503);
		const jobId = c.req.param("id");
		try {
			const job = await pollImageJob(jobId);
			// Preserve the proxy-rewritten contract clients depend on: upstream
			// fields plus normalized image_url (proxy), image_path, image_url_public.
			const data = {
				...job.raw,
				...(job.imageUrl
					? {
							image_url: job.imageUrl,
							image_path: job.imagePath,
							image_url_public: job.imageUrlPublic,
						}
					: {}),
			};
			// Resolution is keyed by job id against the ledger, whose row was opened
			// before submit. The old path looked the job up in an in-memory Map and
			// skipped every write when it missed — which is what a restart, or an
			// eviction past 1000 entries, guaranteed. Idempotent in the store, so the
			// `jobRecorded` Set that used to guard double-polling is gone too.
			if (job.status === "done" && job.imageUrl) {
				const ledgerRow = await findByJobId(jobId);
				// Resolve the ledger for a CACHED completion too. `fromCache` gates the
				// quota counter only — it means "this cost nothing to produce", not
				// "this is not an image". Skipping it here left the row pending forever
				// while the client happily rendered the picture, so the gallery and the
				// lab feed both missed an image the operator could see.
				if (ledgerRow && (await recordJobCompleted(jobId, job.imageUrlPublic ?? job.imageUrl))) {
					if (!job.fromCache) {
						try {
							await recordGeneration(ledgerRow.workspace, "post");
						} catch {}
					}
					try {
						await markJobDone(ledgerRow.workspace, jobId, job.imageUrlPublic ?? job.imageUrl ?? "");
					} catch {}
				}
			} else if (job.status === "error" || job.status === "failed") {
				const ledgerRow = await findByJobId(jobId);
				if (ledgerRow && (await recordJobFailed(jobId))) {
					try {
						await markJobFailed(ledgerRow.workspace, jobId);
					} catch {}
				}
			}
			return c.json(data, 200);
		} catch (err) {
			return c.json(
				{ error: "upstream_failed", message: err instanceof Error ? err.message : String(err) },
				502,
			);
		}
	});

	// Owner-scoped compatibility for historical generated-image URLs.
	app.get("/files/:name", async (c) => {
		const name = c.req.param("name");
		if (name.includes("/") || name.includes("..")) {
			return c.json({ error: "bad_path" }, 400);
		}
		const mapped = await findLegacyMediaForUser(
			`/api/image-gen/files/${name}`,
			activeCaller(c).userId,
		);
		return mapped.mediaId
			? await serveMedia(mapped.mediaId, activeCaller(c).userId, c.req.header("range") ?? null)
			: c.json({ error: "not_found" }, 404);
	});

	app.post("/upload", async (c) => {
		try {
			const form = await c.req.formData();
			const projectId = textOf(form.get("project_id")).trim();
			const workspace = projectId
				? (await getContentProject(projectId))?.project.workspace
				: c.req.query("workspace")?.trim() || "default";
			if (!workspace) return c.json({ error: "project_not_found" }, 400);
			const refusal = await unknownWorkspaceRefusal(c, workspace);
			if (refusal) return refusal;
			const file = form.get("file");
			if (!file || !(file instanceof File)) {
				return c.json({ error: "file field required" }, 400);
			}
			const allowed = ["image/png", "image/jpeg", "image/webp", "image/avif"];
			if (!allowed.includes(file.type)) {
				return c.json({ error: "unsupported file type" }, 400);
			}
			const maxSize = 10 * 1024 * 1024;
			if (file.size > maxSize) {
				return c.json({ error: "file too large (max 10MB)" }, 400);
			}

			const url = await storeManagedMedia({
				workspace,
				project: projectId || null,
				kind: "image",
				body: file,
				contentType: file.type,
				filename: file.name,
			});

			return c.json({
				url,
				size: file.size,
				type: file.type,
			});
		} catch (err) {
			return c.json(
				{
					error: "upload_failed",
					message: err instanceof Error ? err.message : String(err),
				},
				500,
			);
		}
	});

	return app;
}
