import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hono } from "hono";
import {
	DEFAULT_MEDIA_IMPORT_LIMITS,
	mintMediaId,
	ProjectMediaImportResponseSchema,
	ProjectMediaImportPageSchema,
	type ImportedMediaKind,
} from "@maleo/shared";
import { openDb } from "@maleo/db/connection";
import { createContentProject } from "@maleo/db/project-detail";
import {
	getProjectMediaImport,
	importOriginal,
	reserveProjectMediaImport,
} from "@maleo/db/media-imports";
import { addWorkspaceMember } from "@maleo/db/workspace-members";
import { getMediaObject } from "@maleo/db/media-objects";
import { putMedia } from "@maleo/storage";
import {
	MediaWorkerHttpError,
	type MediaProcessingJob,
	type ProcessingMediaClient,
	type MediaProcessingRequest,
} from "@maleo/media/api";
import { installTestCaller } from "../../../../middleware/auth-testing.ts";
import { workspaceScope } from "../../../../lib/active-workspace.ts";
import { projectMediaImportRoutes } from "../../index.ts";
import { mediaRoutes } from "../../../../routes/media.ts";
import { registerProjectRoutes } from "../../../../routes/operations/projects.ts";

const previousData = process.env.MALEO_DATA_DIR;
const previousBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
let directory: string;
const fixtures = new Map<ImportedMediaKind, Uint8Array<ArrayBuffer>>();
const jobs = new Map<string, MediaProcessingJob>();

const client: ProcessingMediaClient = {
	async processingReadiness() {
		return { available: true, limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS } };
	},
	async submitProcessing(request) {
		if ("type" in request) throw new Error("Expected import request");
		const existing = [...jobs.values()].find(
			(job) => job.request.idempotencyKey === request.idempotencyKey,
		);
		if (existing) return existing.id;
		const id = randomUUID();
		jobs.set(id, {
			id,
			request,
			status: "queued",
			result: null,
			error: null,
			createdAt: Date.now(),
			startedAt: null,
			finishedAt: null,
		});
		return id;
	},
	async pollProcessing(id) {
		const job = jobs.get(id);
		if (!job) throw new Error("Worker job missing");
		return job;
	},
	async cancelProcessing(id) {
		const job = jobs.get(id);
		if (!job) throw new Error("Worker job missing");
		job.status = "cancelled";
		return job;
	},
};

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "maleo-upload-proof-"));
	process.env.MALEO_DATA_DIR = directory;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	fixtures.set(
		"image",
		new Uint8Array(
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=blue:s=32x32",
				"-frames:v",
				"1",
				"-f",
				"image2pipe",
				"-c:v",
				"png",
				"pipe:1",
			]),
		),
	);
	fixtures.set(
		"audio",
		new Uint8Array(
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440",
				"-t",
				"0.5",
				"-c:a",
				"aac",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]),
		),
	);
	fixtures.set(
		"video",
		new Uint8Array(
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=32x32:r=30",
				"-t",
				"0.5",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]),
		),
	);
});
afterAll(async () => {
	if (previousData !== undefined) process.env.MALEO_DATA_DIR = previousData;
	if (previousBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
	else process.env.MALEO_MEDIA_STORAGE_BACKEND = previousBackend;
	await rm(directory, { recursive: true, force: true });
});

function app(
	limit = DEFAULT_MEDIA_IMPORT_LIMITS.maxFileBytes,
	caller?: Parameters<typeof installTestCaller>[0],
): Hono {
	const app = new Hono();
	app.use("*", installTestCaller(caller));
	app.use("*", workspaceScope());
	app.route("/projects", projectMediaImportRoutes({ client, limits: { maxFileBytes: limit } }));
	app.route("/api/media", mediaRoutes());
	registerProjectRoutes(app);
	return app;
}

function uploadHeaders(filename: string, kind: ImportedMediaKind, key: string = mintMediaId()) {
	return {
		"content-type": "application/octet-stream",
		"x-file-name": encodeURIComponent(filename),
		"x-media-kind": kind,
		"x-upload-id": key,
	};
}

async function completeJob(request: MediaProcessingRequest): Promise<void> {
	const job = [...jobs.values()].find(
		(job) => job.request.idempotencyKey === request.idempotencyKey,
	)!;
	// Late completions after cancellation no longer see the released original, so size comes from the fixture.
	const original = { size: fixtures.get(request.kind)!.byteLength };
	const playback = await putMedia({
		workspace: request.workspaceId,
		project: request.projectId,
		kind: request.kind,
		body: fixtures.get(request.kind)!,
		contentType:
			request.kind === "image" ? "image/png" : request.kind === "audio" ? "audio/mp4" : "video/mp4",
		filename: "playback",
	});
	job.status = "done";
	job.result = {
		sourceRevision: request.sourceRevision,
		playback,
		metadata: {
			originalFilename: request.originalFilename,
			byteSize: original.size,
			kind: request.kind,
			...(request.kind === "image"
				? { width: 32, height: 32 }
				: { duration: 0.5, hasAudio: request.kind === "audio" }),
		},
		compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	};
}

test("authenticated runtime upload/poll admits image/video/audio once and retains originals with stable source identity", async () => {
	const project = (await createContentProject({ title: "Upload proof" }))!;
	const server = Bun.serve({ port: 0, fetch: app().fetch });
	try {
		for (const kind of ["image", "video", "audio"] as const) {
			const extension = kind === "image" ? "png" : kind === "video" ? "mp4" : "m4a";
			const headers = uploadHeaders(`原始 file.${extension}`, kind);
			const url = new URL(`/projects/${project.project.id}/media/import`, server.url);
			const res = await fetch(url, { method: "POST", headers, body: fixtures.get(kind)! });
			expect(res.status).toBe(202);
			const pending = ProjectMediaImportResponseSchema.parse(await res.json());
			expect(pending.asset).toBeNull();
			const retry = ProjectMediaImportResponseSchema.parse(
				await (await fetch(url, { method: "POST", headers, body: fixtures.get(kind)! })).json(),
			);
			expect(retry.id).toBe(pending.id);
			const row = (await getProjectMediaImport(pending.id))!;
			const source = importOriginal(row)!;
			expect(
				await openDb().get("SELECT id FROM media_objects WHERE storage_key = ?", [source.key]),
			).toBeNull();
			const job = jobs.get(row.worker_job_id!)!;
			const pollUrl = new URL(`${url.pathname}/${pending.id}`, server.url);
			const restored = ProjectMediaImportPageSchema.parse(await (await fetch(url)).json());
			expect(restored.items).toEqual([{ requestKey: headers["x-upload-id"], import: pending }]);
			expect(
				ProjectMediaImportResponseSchema.parse(await (await fetch(pollUrl)).json()).status,
			).toBe("queued");
			await completeJob(job.request);
			const ready = ProjectMediaImportResponseSchema.parse(await (await fetch(pollUrl)).json());
			expect(ready.status).toBe("ready");
			expect(ready.asset).toMatchObject({
				id: pending.id,
				kind,
				source: "upload",
				metadata: { originalFilename: `原始 file.${extension}` },
			});
			expect(await getMediaObject(ready.asset!.importedSource.originalMediaId)).not.toBeNull();
			expect(
				ProjectMediaImportResponseSchema.parse(await (await fetch(pollUrl)).json()).asset,
			).toEqual(ready.asset);
			expect(ProjectMediaImportPageSchema.parse(await (await fetch(url)).json()).items).toEqual([]);
		}
		expect(
			(
				await openDb().get<{ editor_state_json: string | null }>(
					"SELECT editor_state_json FROM content_projects WHERE id = ?",
					[project.project.id],
				)
			)?.editor_state_json,
		).toBeNull();
	} finally {
		void server.stop(true);
	}
});

test("oversize streamed bytes, invalid headers, unavailable worker and retry mismatch publish no ready source", async () => {
	const project = (await createContentProject({ title: "Failure proof" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const headers = uploadHeaders("file.png", "image");
	expect(
		(
			await app(64).request(url, {
				method: "POST",
				headers: { ...headers, "content-length": "65" },
				body: new Uint8Array([1]),
			})
		).status,
	).toBe(413);
	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new Uint8Array(32));
			controller.enqueue(new Uint8Array(64));
			controller.close();
		},
	});
	expect((await app(64).request(url, { method: "POST", headers, body: stream })).status).toBe(413);
	const failed = await openDb().get<{ status: string; asset_json: string | null }>(
		"SELECT status, asset_json FROM project_media_imports WHERE project_id = ? AND request_key = ?",
		[project.project.id, headers["x-upload-id"]],
	);
	expect(failed).toMatchObject({ status: "failed", asset_json: null });
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: { ...headers, "x-file-name": "%ZZ" },
				body: fixtures.get("image")!,
			})
		).status,
	).toBe(400);
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: { ...headers, "x-batch-size": "51" },
				body: fixtures.get("image")!,
			})
		).status,
	).toBe(400);
	const unavailable = new Hono();
	unavailable.use("*", installTestCaller());
	unavailable.use("*", workspaceScope());
	unavailable.route(
		"/projects",
		projectMediaImportRoutes({
			client: {
				...client,
				async processingReadiness() {
					return {
						available: false,
						limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS },
						reason: "ffprobe missing",
					};
				},
			},
		}),
	);
	const unavailableResponse = await unavailable.request(url, {
		method: "POST",
		headers: uploadHeaders("missing.png", "image"),
		body: fixtures.get("image")!,
	});
	expect(unavailableResponse.status).toBe(503);
	expect(await unavailableResponse.json()).toMatchObject({ message: "ffprobe missing" });
	const valid = uploadHeaders("file.png", "image");
	expect(
		(await app().request(url, { method: "POST", headers: valid, body: fixtures.get("image")! }))
			.status,
	).toBe(202);
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: { ...valid, "x-file-name": "other.png" },
				body: fixtures.get("image")!,
			})
		).status,
	).toBe(409);
});

test("unowned derivative rolls back media registration and can recover with valid storage", async () => {
	const project = (await createContentProject({ title: "Atomic publication" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("atomic.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	const row = (await getProjectMediaImport(pending.id))!;
	const job = jobs.get(row.worker_job_id!)!;
	await completeJob(job.request);
	const playback = job.result!.playback;
	job.result!.playback = {
		...playback,
		key: playback.key.replace(project.project.id, randomUUID()),
	};
	const rejected = await app().request(`${url}/${pending.id}`);
	expect(rejected.status).toBe(200);
	expect(ProjectMediaImportResponseSchema.parse(await rejected.json())).toMatchObject({
		status: "failed",
		error: "Worker result storage ownership mismatch",
		asset: null,
	});
	expect(
		await openDb().get("SELECT id FROM media_objects WHERE storage_key = ?", [
			importOriginal(row)!.key,
		]),
	).toBeNull();
	expect((await getProjectMediaImport(pending.id))!.asset_json).toBeNull();
	job.result!.playback = playback;
	expect(
		ProjectMediaImportResponseSchema.parse(
			await (await app().request(`${url}/${pending.id}`)).json(),
		).status,
	).toBe("ready");
});

function appWith(
	overrides: Partial<ProcessingMediaClient>,
	caller?: Parameters<typeof installTestCaller>[0],
): Hono {
	const app = new Hono();
	app.use("*", installTestCaller(caller));
	app.use("*", workspaceScope());
	app.route("/projects", projectMediaImportRoutes({ client: { ...client, ...overrides } }));
	return app;
}

test("poll never loops on 500: transient worker errors stay processing, a lost job fails, an expired one times out", async () => {
	const project = (await createContentProject({ title: "Poll recovery" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("flaky.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	const transient = await appWith({
		async pollProcessing() {
			throw new Error("connect ECONNREFUSED 10.0.0.7:8091");
		},
	}).request(`${url}/${pending.id}`);
	expect(transient.status).toBe(200);
	const body = ProjectMediaImportResponseSchema.parse(await transient.json());
	expect(body).toMatchObject({ status: "processing", error: null });
	expect(JSON.stringify(body)).not.toContain("10.0.0.7");
	await openDb().run("UPDATE project_media_imports SET lease_until = 0 WHERE id = ?", [pending.id]);
	const expired = ProjectMediaImportResponseSchema.parse(
		await (
			await appWith({
				async pollProcessing() {
					throw new Error("socket hang up");
				},
			}).request(`${url}/${pending.id}`)
		).json(),
	);
	expect(expired).toMatchObject({ status: "failed", error: "Processing timed out; retry file" });

	const lost = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("lost.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	const missing = await appWith({
		async pollProcessing() {
			throw new MediaWorkerHttpError(404, "media processing failed: 404");
		},
	}).request(`${url}/${lost.id}`);
	expect(ProjectMediaImportResponseSchema.parse(await missing.json())).toMatchObject({
		status: "failed",
		error: "Processing was interrupted; retry file",
	});
});

test("unexpected errors return a generic message and never store internal text", async () => {
	const project = (await createContentProject({ title: "Error hygiene" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("hygiene.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	await openDb().run("UPDATE project_media_imports SET worker_job_id = NULL WHERE id = ?", [
		pending.id,
	]);
	const failing = appWith({
		async submitProcessing() {
			throw new Error("media storage object missing: workspaces/default/file/secret-key");
		},
	});
	const response = await failing.request(`${url}/${pending.id}`);
	expect(JSON.stringify(await response.json())).not.toContain("workspaces/");
	const upload = await appWith({
		async submitProcessing() {
			throw new Error("internal bucket s3://private-bucket refused");
		},
	}).request(url, {
		method: "POST",
		headers: uploadHeaders("leak.png", "image"),
		body: fixtures.get("image")!,
	});
	expect(upload.status).toBe(500);
	expect(JSON.stringify(await upload.json())).not.toContain("private-bucket");
	const stored = await openDb().get<{ error: string }>(
		"SELECT error FROM project_media_imports WHERE project_id = ? AND original_filename = 'leak.png'",
		[project.project.id],
	);
	expect(stored?.error).toBe("Upload failed; retry file");
});

test("read-only members can poll but never drive worker submission or publication", async () => {
	const project = (await createContentProject({ title: "Viewer poll" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("viewer.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	const row = (await getProjectMediaImport(pending.id))!;
	await completeJob(jobs.get(row.worker_job_id!)!.request);
	await addWorkspaceMember({ workspace: "default", user_id: "viewer-poll", role: "member" });
	await openDb().run(
		"UPDATE workspace_members SET role = 'viewer' WHERE workspace = 'default' AND user_id = 'viewer-poll'",
	);
	let submitted = false,
		polled = false;
	const viewer = appWith(
		{
			async submitProcessing() {
				submitted = true;
				return "x";
			},
			async pollProcessing(id) {
				polled = true;
				return jobs.get(id)!;
			},
		},
		{ userId: "viewer-poll", email: "viewer@example.com", role: "member" },
	);
	const seen = ProjectMediaImportResponseSchema.parse(
		await (await viewer.request(`${url}/${pending.id}`)).json(),
	);
	expect(seen.status).toBe("processing");
	expect(submitted || polled).toBe(false);
	expect((await getProjectMediaImport(pending.id))!.asset_json).toBeNull();
	expect(
		ProjectMediaImportResponseSchema.parse(
			await (await app().request(`${url}/${pending.id}`)).json(),
		).status,
	).toBe("ready");
});

test("cancel by request key wins even while readiness is still pending, and frees the quarantined original", async () => {
	const project = (await createContentProject({ title: "Early cancel" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const key = mintMediaId();
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const slow = appWith({
		async processingReadiness() {
			await gate;
			return { available: true, limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS } };
		},
	});
	const upload = slow.request(url, {
		method: "POST",
		headers: uploadHeaders("early.png", "image", key),
		body: fixtures.get("image")!,
	});
	for (
		let attempt = 0;
		attempt < 200 &&
		!(await openDb().get("SELECT id FROM project_media_imports WHERE request_key = ?", [key]));
		attempt++
	)
		await Bun.sleep(5);
	const cancelled = await app().request(`${url}/request/${key}`, { method: "DELETE" });
	expect(ProjectMediaImportResponseSchema.parse(await cancelled.json()).status).toBe("cancelled");
	release();
	expect((await upload).status).toBe(409);
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("held.png", "image"),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	expect(importOriginal((await getProjectMediaImport(pending.id))!)).not.toBeNull();
	await app().request(`${url}/${pending.id}`, { method: "DELETE" });
	expect((await getProjectMediaImport(pending.id))!.original_json).toBeNull();
});

test("two active streams enforce upload ceiling; cancellation by request identity blocks publication", async () => {
	const project = (await createContentProject({ title: "Streaming quota" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const keys = [mintMediaId(), mintMediaId()];
	const streams: ReadableStreamDefaultController<Uint8Array>[] = [];
	const pending = keys.map((key) =>
		app().request(url, {
			method: "POST",
			headers: uploadHeaders("held.png", "image", key),
			body: new ReadableStream<Uint8Array>({
				start(controller) {
					streams.push(controller);
					controller.enqueue(fixtures.get("image")!);
				},
			}),
		}),
	);
	try {
		for (let attempt = 0; attempt < 200; attempt++) {
			const count = await openDb().get<{ count: number }>(
				"SELECT COUNT(*) AS count FROM project_media_imports WHERE project_id = ?",
				[project.project.id],
			);
			if (count?.count === 2) break;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		expect(
			(
				await app().request(url, {
					method: "POST",
					headers: uploadHeaders("third.png", "image"),
					body: fixtures.get("image")!,
				})
			).status,
		).toBe(429);
		for (const key of keys) {
			const cancelled = await app().request(`${url}/request/${key}`, { method: "DELETE" });
			expect(ProjectMediaImportResponseSchema.parse(await cancelled.json()).status).toBe(
				"cancelled",
			);
		}
	} finally {
		for (const stream of streams) stream.close();
	}
	for (const response of await Promise.all(pending)) expect(response.status).toBe(409);
	expect(
		await openDb().get(
			"SELECT id FROM project_media_imports WHERE project_id = ? AND asset_json IS NOT NULL",
			[project.project.id],
		),
	).toBeNull();
});

test("non-members/read-only roles, wrong project scope and cancellation cannot publish late results", async () => {
	const project = (await createContentProject({ title: "Ownership proof" }))!;
	const other = (await createContentProject({ title: "Other project", workspace: "other" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const headers = uploadHeaders("file.png", "image");
	expect(
		(
			await app().request(`/projects/${other.project.id}/media/import`, {
				method: "POST",
				headers,
				body: fixtures.get("image")!,
			})
		).status,
	).toBe(404);
	expect(
		(
			await app(undefined, {
				userId: "outsider",
				email: "out@example.com",
				role: "member",
			}).request(url, { method: "POST", headers, body: fixtures.get("image")! })
		).status,
	).toBe(400);
	await addWorkspaceMember({ workspace: "default", user_id: "readonly", role: "member" });
	// Current UI grants only owner/member. Unexpected read-only role must fail closed.
	await openDb().run(
		"UPDATE workspace_members SET role = 'viewer' WHERE workspace = 'default' AND user_id = 'readonly'",
	);
	expect(
		(
			await app(undefined, {
				userId: "readonly",
				email: "read@example.com",
				role: "member",
			}).request(url, { method: "POST", headers, body: fixtures.get("image")! })
		).status,
	).toBe(403);
	const pending = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, { method: "POST", headers, body: fixtures.get("image")! })
		).json(),
	);
	expect(
		(await app().request(`/projects/${other.project.id}/media/import/${pending.id}`)).status,
	).toBe(404);
	expect(
		(
			await app().request(`/projects/${other.project.id}/media/import/${pending.id}`, {
				method: "DELETE",
			})
		).status,
	).toBe(404);
	const row = (await getProjectMediaImport(pending.id))!;
	const request = jobs.get(row.worker_job_id!)!.request;
	expect(
		ProjectMediaImportResponseSchema.parse(
			await (await app().request(`${url}/${pending.id}`, { method: "DELETE" })).json(),
		).status,
	).toBe("cancelled");
	await completeJob(request); // completion after cancellation is deliberately stale
	expect(
		ProjectMediaImportResponseSchema.parse(
			await (await app().request(`${url}/${pending.id}`)).json(),
		),
	).toMatchObject({ status: "cancelled", asset: null });
	expect(
		await openDb().get("SELECT id FROM media_objects WHERE storage_key = ?", [
			jobs.get(row.worker_job_id!)!.result!.playback.key,
		]),
	).toBeNull();
});

test("shared imported source survives project removal and authenticated playback serves seek ranges", async () => {
	const project = (await createContentProject({ title: "Reload import proof" }))!;
	const server = Bun.serve({ port: 0, fetch: app().fetch });
	try {
		const url = new URL(`/projects/${project.project.id}/media/import`, server.url);
		const uploaded = ProjectMediaImportResponseSchema.parse(
			await (
				await fetch(url, {
					method: "POST",
					headers: uploadHeaders("Original camera.mp4", "video"),
					body: fixtures.get("video")!,
				})
			).json(),
		);
		const row = (await getProjectMediaImport(uploaded.id))!;
		await completeJob(jobs.get(row.worker_job_id!)!.request);
		const ready = ProjectMediaImportResponseSchema.parse(
			await (await fetch(new URL(`${url.pathname}/${uploaded.id}`, server.url))).json(),
		);
		const saved = await fetch(new URL(`/projects/${project.project.id}/editor-state`, server.url), {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ editor_state: { media_assets: [ready.asset], chat: [] } }),
		});
		expect(saved.status).toBe(200);
		const detail = await (
			await fetch(new URL(`/projects/${project.project.id}`, server.url))
		).json();
		expect(detail.project.editor_state_json.media_assets).toEqual([ready.asset]);
		const other = (await createContentProject({ title: "Shared source consumer" }))!;
		const saveAssets = (id: string, assets: unknown[]) =>
			fetch(new URL(`/projects/${id}/editor-state`, server.url), {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					editor_state: { media_assets: assets, chat: [] },
				}),
			});
		expect((await saveAssets(other.project.id, [ready.asset])).status).toBe(200);
		expect((await saveAssets(project.project.id, [])).status).toBe(200);
		const retained = await (
			await fetch(new URL(`/projects/${other.project.id}`, server.url))
		).json();
		expect(retained.project.editor_state_json.media_assets).toEqual([ready.asset]);
		const removed = await (
			await fetch(new URL(`/projects/${project.project.id}`, server.url))
		).json();
		expect(removed.project.editor_state_json.media_assets).toEqual([]);
		const playback = await fetch(new URL(ready.asset!.url, server.url), {
			headers: { range: "bytes=0-31" },
		});
		expect(playback.status).toBe(206);
		expect(playback.headers.get("content-type")).toBe("video/mp4");
		expect(Buffer.from(await playback.arrayBuffer())).toEqual(
			Buffer.from(fixtures.get("video")!).subarray(0, 32),
		);
	} finally {
		void server.stop(true);
	}
});

test("a body shorter or longer than the declared file size is refused and never processed", async () => {
	const project = (await createContentProject({ title: "Truncated upload" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const bytes = fixtures.get("image")!;
	const short = uploadHeaders("short.png", "image");
	const truncated = await app().request(url, {
		method: "POST",
		headers: { ...short, "x-file-size": String(bytes.byteLength + 10) },
		body: bytes,
	});
	expect(truncated.status).toBe(400);
	expect(await truncated.json()).toMatchObject({ message: "Upload was incomplete; retry file" });
	const row = await openDb().get<{
		status: string;
		worker_job_id: string | null;
		original_json: string | null;
	}>(
		"SELECT status, worker_job_id, original_json FROM project_media_imports WHERE request_key = ?",
		[short["x-upload-id"]],
	);
	expect(row).toMatchObject({ status: "failed", worker_job_id: null, original_json: null });
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: {
					...uploadHeaders("long.png", "image"),
					"x-file-size": String(bytes.byteLength - 10),
				},
				body: bytes,
			})
		).status,
	).toBe(400);
	expect(
		(
			await app(64).request(url, {
				method: "POST",
				headers: { ...uploadHeaders("big.png", "image"), "x-file-size": "65" },
				body: bytes,
			})
		).status,
	).toBe(413);
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: {
					...uploadHeaders("exact.png", "image"),
					"x-file-size": String(bytes.byteLength),
				},
				body: bytes,
			})
		).status,
	).toBe(202);
});

test("lookup by request key returns stored import state within the caller's project only", async () => {
	const project = (await createContentProject({ title: "Request lookup" }))!;
	const other = (await createContentProject({ title: "Other lookup" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const key = mintMediaId();
	const uploaded = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("lookup.png", "image", key),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	const lookup = async (
		path = `${url}/request/${key}`,
		caller?: Parameters<typeof installTestCaller>[0],
	) => app(undefined, caller).request(path);
	await completeJob(jobs.get((await getProjectMediaImport(uploaded.id))!.worker_job_id!)!.request);
	// Stored state only: the lookup never polls the worker on the caller's behalf.
	expect(ProjectMediaImportResponseSchema.parse(await (await lookup()).json())).toEqual(uploaded);
	const ready = ProjectMediaImportResponseSchema.parse(
		await (await app().request(`${url}/${uploaded.id}`)).json(),
	);
	expect(ready.status).toBe("ready");
	expect(ProjectMediaImportResponseSchema.parse(await (await lookup()).json())).toEqual(ready);
	await addWorkspaceMember({ workspace: "default", user_id: "lookup-viewer", role: "member" });
	await openDb().run(
		"UPDATE workspace_members SET role = 'viewer' WHERE workspace = 'default' AND user_id = 'lookup-viewer'",
	);
	expect(
		(
			await lookup(undefined, {
				userId: "lookup-viewer",
				email: "viewer@example.com",
				role: "member",
			})
		).status,
	).toBe(200);
	expect((await lookup(`${url}/request/${randomUUID()}`)).status).toBe(404);
	expect((await lookup(`${url}/request/not%2Fa%20key`)).status).toBe(404);
	expect((await lookup(`/projects/${other.project.id}/media/import/request/${key}`)).status).toBe(
		404,
	);
});

test("a file chosen again for the same request key restarts an unfinished import under its new name", async () => {
	const project = (await createContentProject({ title: "Choose again" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const key = mintMediaId();
	const first = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("first.png", "image", key),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	// A live attempt only answers for the same file.
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("other.png", "image", key),
				body: fixtures.get("image")!,
			})
		).status,
	).toBe(409);
	await app().request(`${url}/request/${key}`, { method: "DELETE" });
	const again = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("other.png", "image", key),
				body: fixtures.get("image")!,
			})
		).json(),
	);
	expect([again.id, again.filename]).toEqual([first.id, "other.png"]);
	expect(["queued", "processing"]).toContain(again.status);
	expect(
		(
			await app().request(url, {
				method: "POST",
				headers: uploadHeaders("other.mp4", "video", key),
				body: fixtures.get("video")!,
			})
		).status,
	).toBe(409);
});

test("a minted media identity is validated at import and the finished import is published under it", async () => {
	const project = (await createContentProject({ title: "Minted identity" }))!;
	const other = (await createContentProject({ title: "Elsewhere", workspace: "other" }))!;
	const url = `/projects/${project.project.id}/media/import`;
	const mediaId = mintMediaId();
	const headers = uploadHeaders("clip.mp4", "video", mediaId);
	const started = await app().request(url, {
		method: "POST",
		headers,
		body: fixtures.get("video")!,
	});
	expect(started.status).toBe(202);
	const pending = ProjectMediaImportResponseSchema.parse(await started.json());
	expect((await getProjectMediaImport(pending.id))?.media_id).toBe(mediaId);
	expect((await app().request(`/api/media/${mediaId}`)).status).toBe(409);
	// Same project, same identity: the same import.
	const retry = ProjectMediaImportResponseSchema.parse(
		await (
			await app().request(url, { method: "POST", headers, body: fixtures.get("video")! })
		).json(),
	);
	expect(retry.id).toBe(pending.id);
	// Malformed identity: refused as invalid before any bytes are stored.
	const malformed = await app().request(url, {
		method: "POST",
		headers: { ...headers, "x-upload-id": `${mediaId}/x` },
		body: fixtures.get("video")!,
	});
	expect(malformed.status).toBe(400);
	// Taken by an import in another workspace: generic conflict, owner unnamed.
	const foreignId = mintMediaId();
	await reserveProjectMediaImport({
		workspace: "other",
		projectId: other.project.id,
		requestKey: foreignId,
		filename: "theirs.mp4",
		kind: "video",
		uploadTimeoutMs: 60_000,
	});
	const conflict = await app().request(url, {
		method: "POST",
		headers: uploadHeaders("clip.mp4", "video", foreignId),
		body: fixtures.get("video")!,
	});
	expect(conflict.status).toBe(409);
	const body = await conflict.json();
	expect(body).toMatchObject({ error: "media_id_conflict" });
	expect(JSON.stringify(body)).not.toContain("other");
	expect(
		await openDb().get(
			"SELECT id FROM project_media_imports WHERE request_key = ? AND workspace = 'default'",
			[foreignId],
		),
	).toBeNull();
	// Finish: the registry publishes the playable object under the minted identity.
	const row = (await getProjectMediaImport(pending.id))!;
	await completeJob(jobs.get(row.worker_job_id!)!.request);
	const ready = ProjectMediaImportResponseSchema.parse(
		await (await app().request(`${url}/${pending.id}`)).json(),
	);
	expect(ready.status).toBe("ready");
	expect(ready.asset?.url).toBe(`/api/media/${mediaId}`);
	expect(ready.asset?.importedSource.playbackMediaId).toBe(mediaId);
	const media = await app().request(`/api/media/${mediaId}`);
	expect(media.status).toBe(200);
	expect(new Uint8Array(await media.arrayBuffer())).toEqual(fixtures.get("video")!);
	// No second identity for the playable bytes.
	const playbackKey = (await getMediaObject(mediaId))!.storage_key;
	expect(
		(await openDb().all("SELECT id FROM media_objects WHERE storage_key = ?", [playbackKey]))
			.length,
	).toBe(1);
});
