import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createContentProject } from "@maleo/db/project-detail";
import { openDb } from "@maleo/db/connection";
import { applyMediaLibraryChange, lockedMediaLibrary } from "@maleo/db/project-media-assets";
import type { MediaAsset } from "@maleo/shared/editor";

import { registerMediaObject, getMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import { putMedia, getMedia } from "@maleo/storage";
import { DEFAULT_MEDIA_IMPORT_LIMITS, ProjectMediaProcessingResponseSchema } from "@maleo/shared";
import { type MediaProcessingJob, type ProcessingMediaClient } from "@maleo/media/api";
import { installTestCaller } from "../../../../middleware/auth-testing.ts";
import { workspaceScope } from "../../../../lib/active-workspace.ts";
import { internalMediaProcessingRoutes, projectMediaProcessingRoutes } from "../../index.ts";
import type { ProcessMediaBody } from "../../model.ts";

/** The project's library rows, set wholesale (`p1-media-library`). */
async function setLibrary(projectId: string, list: object[]): Promise<void> {
	await openDb().transaction(async (tx) => {
		const before = await lockedMediaLibrary(tx, projectId);
		// SAFETY: test fixtures shaped as the assets the scope holds.
		await applyMediaLibraryChange(tx, projectId, before, list as MediaAsset[]);
	});
}

test("authenticated source processing enforces admission, revision and durable output ownership", async () => {
	const previous = {
		data: process.env.MALEO_DATA_DIR,
		backend: process.env.MALEO_MEDIA_STORAGE_BACKEND,
		token: process.env.MALEO_SERVICE_TOKEN,
	};
	if (!previous.data) throw new Error("Run source-processing tests with test-db-guard preload");
	const directory = await mkdtemp(join(tmpdir(), "maleo-reverse-api-"));
	process.env.MALEO_DATA_DIR = directory;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	process.env.MALEO_SERVICE_TOKEN = "reverse-api-proof-only";
	const jobs = new Map<string, MediaProcessingJob>();
	const client: ProcessingMediaClient = {
		async processingReadiness() {
			return { available: true, limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS } };
		},
		async submitProcessing(request) {
			if ("type" in request) throw new Error("Expected media request");
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
			return jobs.get(id)!;
		},
		async cancelProcessing(id) {
			const job = jobs.get(id)!;
			job.status = "cancelled";
			return job;
		},
	};
	const app = new Hono();
	app.route("/internal/media-processing", internalMediaProcessingRoutes());
	const publicApp = new Hono();
	publicApp.use("*", installTestCaller());
	publicApp.use("*", workspaceScope());
	publicApp.route("/projects", projectMediaProcessingRoutes({ client }));
	app.route("/", publicApp);
	const server = Bun.serve({ port: 0, fetch: app.fetch });
	try {
		const project = (await createContentProject({ title: "Reverse API" }))!;
		const bytes = new Uint8Array(
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=32x32:r=30:d=2",
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
		);
		const stored = await putMedia({
			workspace: project.project.workspace,
			project: project.project.id,
			kind: "video",
			body: bytes,
			filename: "source.mp4",
			contentType: "video/mp4",
		});
		const media = await registerMediaObject({
			workspace: project.project.workspace,
			kind: "video",
			hash: stored.hash,
			storage_key: stored.key,
			content_type: stored.contentType,
			size: stored.size,
		});
		const asset = { id: "source", label: "Original", url: mediaObjectUrl(media.id), kind: "video" };
		await setLibrary(project.project.id, [asset]);
		const input = {
			sourceMediaId: media.id,
			sourceRevision: media.id,
			requestKey: randomUUID(),
			operation: { type: "reverse", startSec: 0.5, durationSec: 1 },
		} satisfies ProcessMediaBody;
		const post = (body: unknown, id = project.project.id) =>
			fetch(new URL(`/projects/${id}/media/processing`, server.url), {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
		expect((await post({ ...input, sourceRevision: "old" })).status).toBe(409);
		expect((await post({ ...input, url: "https://untrusted.test" })).status).toBe(400);
		const other = (await createContentProject({ title: "Other project" }))!;
		expect((await post(input, other.project.id)).status).toBe(409);
		const response = await post(input);
		expect(response.status).toBe(202);
		const { id } = await response.json();
		const job = jobs.get(id)!;
		expect(job.request.fingerprint).toBe(media.hash);
		expect(job.request.operation).toEqual(input.operation);
		const sourceUrl = new URL(
			`/internal/media-processing/${media.id}/source?${new URLSearchParams({ workspace: project.project.workspace, project: project.project.id, revision: media.id })}`,
			server.url,
		);
		expect((await fetch(sourceUrl)).status).toBe(401);
		const headers = { authorization: "Bearer reverse-api-proof-only" };
		expect(Buffer.from(await (await fetch(sourceUrl, { headers })).arrayBuffer())).toEqual(
			Buffer.from(bytes),
		);
		for (const key of ["workspace", "project", "revision"]) {
			const wrong = new URL(sourceUrl);
			wrong.searchParams.set(key, "other");
			expect((await fetch(wrong, { headers })).status).toBe(404);
		}
		const pollUrl = new URL(`/projects/${project.project.id}/media/processing/${id}`, server.url);
		expect(
			ProjectMediaProcessingResponseSchema.parse(await (await fetch(pollUrl)).json()).status,
		).toBe("queued");
		const playback = await putMedia({
			workspace: project.project.workspace,
			project: project.project.id,
			kind: "video",
			body: bytes,
			filename: "reversed.mp4",
			contentType: "video/mp4",
		});
		job.status = "done";
		job.result = {
			sourceRevision: media.id,
			playback,
			metadata: {
				originalFilename: "Original",
				byteSize: bytes.length,
				kind: "video",
				duration: 2,
			},
			compatibility: {
				preview: { status: "supported" },
				render: {
					status: "supported",
				},
			},
			derivative: {
				operation: { type: "reverse", startSec: 0.5, durationSec: 1 },
				metadata: {
					originalFilename: "Original",
					byteSize: bytes.length,
					kind: "video",
					duration: 1,
				},
			},
		};
		const ready = ProjectMediaProcessingResponseSchema.parse(await (await fetch(pollUrl)).json());
		expect(ready.status).toBe("ready");
		expect(ready.url).not.toBe(asset.url);
		expect(
			ProjectMediaProcessingResponseSchema.parse(await (await fetch(pollUrl)).json()).url,
		).toBe(ready.url);
		expect(await getMediaObject(media.id)).toEqual(media);
		expect(Buffer.from(await (await getMedia(media.storage_key)).arrayBuffer())).toEqual(
			Buffer.from(bytes),
		);
		job.result.playback = {
			...playback,
			key: playback.key.replace(`/${project.project.id}/`, `/${other.project.id}/`),
		};
		expect((await fetch(pollUrl)).status).toBe(500);
		job.result.playback = playback;
		const audioBytes = new Uint8Array(
			execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:duration=2",
				"-c:a",
				"aac",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]),
		);
		const audioStored = await putMedia({
			workspace: project.project.workspace,
			project: project.project.id,
			kind: "audio",
			body: audioBytes,
			filename: "audio.m4a",
			contentType: "audio/mp4",
		});
		const audioMedia = await registerMediaObject({
			workspace: project.project.workspace,
			kind: "audio",
			hash: audioStored.hash,
			storage_key: audioStored.key,
			content_type: audioStored.contentType,
			size: audioStored.size,
		});
		await setLibrary(project.project.id, [
			asset,
			{ ...asset, id: "audio", kind: "audio", url: mediaObjectUrl(audioMedia.id) },
		]);
		for (const original of [media, audioMedia]) {
			const operation = {
				type: "audio",
				startSec: 0.25,
				durationSec: 1,
				playbackRate: 0.5,
				preservePitch: true,
				reverse: true,
			} as const;
			const audioInput = {
				...input,
				sourceMediaId: original.id,
				sourceRevision: original.id,
				requestKey: randomUUID(),
				operation,
			};
			expect(
				(await post({ ...audioInput, operation: { ...operation, playbackRate: 5 } })).status,
			).toBe(400);
			const submitted = await post(audioInput);
			expect(submitted.status).toBe(202);
			const audioJob = jobs.get((await submitted.json()).id)!;
			expect(audioJob.request.kind).toBe(original.kind === "audio" ? "audio" : "video");
			audioJob.status = "done";
			audioJob.result = {
				sourceRevision: original.id,
				playback: audioStored,
				metadata: {
					originalFilename: "Original",
					byteSize: original.size,
					kind: original.kind === "audio" ? "audio" : "video",
					duration: 2,
				},
				compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
				derivative: {
					operation,
					metadata: {
						originalFilename: "Original",
						byteSize: audioBytes.length,
						kind: "audio",
						duration: 2,
						hasAudio: true,
					},
				},
			};
			const audioPoll = new URL(
				`/projects/${project.project.id}/media/processing/${audioJob.id}`,
				server.url,
			);
			const processed = ProjectMediaProcessingResponseSchema.parse(
				await (await fetch(audioPoll)).json(),
			);
			expect(processed.status).toBe("ready");
			expect((await getMediaObject(processed.url!.split("/").at(-1)!))?.kind).toBe("audio");
			audioJob.result.playback = playback;
			expect((await fetch(audioPoll)).status).toBe(500);
			audioJob.result.playback = audioStored;
			audioJob.result.derivative!.operation = { ...operation, preservePitch: false };
			expect((await fetch(audioPoll)).status).toBe(500);
		}
		await setLibrary(project.project.id, []);
		expect((await fetch(pollUrl)).status).toBe(409);
		expect((await fetch(sourceUrl, { method: "HEAD", headers })).status).toBe(404);
		expect((await fetch(pollUrl, { method: "DELETE" })).status).toBe(200);
		expect(jobs.get(id)?.status).toBe("cancelled");
	} finally {
		void server.stop(true);
		process.env.MALEO_DATA_DIR = previous.data;
		for (const [key, value] of [
			["MALEO_MEDIA_STORAGE_BACKEND", previous.backend],
			["MALEO_SERVICE_TOKEN", previous.token],
		] as const) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		await rm(directory, { recursive: true, force: true });
	}
});

test("source processing is editor-only and never echoes internal failures", async () => {
	const { addWorkspaceMember } = await import("@maleo/db/workspace-members");
	const { openDb } = await import("@maleo/db/connection");
	const project = (await createContentProject({ title: "Processing hygiene" }))!;
	let polled = false;
	const client: ProcessingMediaClient = {
		async processingReadiness() {
			return { available: true, limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS } };
		},
		async submitProcessing() {
			return "job";
		},
		async pollProcessing() {
			polled = true;
			throw new Error("fetch failed: http://10.0.0.9:8091/processing/job");
		},
		async cancelProcessing() {
			throw new Error("unused");
		},
	};
	const appFor = (caller?: Parameters<typeof installTestCaller>[0]) => {
		const app = new Hono();
		app.use("*", installTestCaller(caller));
		app.use("*", workspaceScope());
		app.route("/projects", projectMediaProcessingRoutes({ client }));
		return app;
	};
	await addWorkspaceMember({ workspace: "default", user_id: "processing-viewer", role: "member" });
	await openDb().run(
		"UPDATE workspace_members SET role = 'viewer' WHERE workspace = 'default' AND user_id = 'processing-viewer'",
	);
	const viewer = await appFor({
		userId: "processing-viewer",
		email: "pv@example.com",
		role: "member",
	}).request(`/projects/${project.project.id}/media/processing/job`);
	expect(viewer.status).toBe(403);
	expect(polled).toBe(false);
	const failed = await appFor().request(`/projects/${project.project.id}/media/processing/job`);
	expect(failed.status).toBe(500);
	expect(JSON.stringify(await failed.json())).not.toContain("10.0.0.9");
});
