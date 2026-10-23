import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createContentProject, setContentEditorState } from "@maleo/db/project-detail";
import { registerMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import {
	reserveProjectMediaImport,
	attachImportOriginal,
	finishProjectMediaImport,
} from "@maleo/db/media-imports";
import { sourceMedia } from "../../service.ts";
import { putMedia } from "@maleo/storage";
import {
	CAPTION_JOB_LIMITS,
	DEFAULT_MEDIA_IMPORT_LIMITS,
	mediaUrl,
	mintMediaId,
} from "@maleo/shared";
import type { CaptionProcessingJob, ProcessingMediaClient } from "@maleo/media/api";
import { installTestCaller } from "../../../../middleware/auth-testing.ts";
import { workspaceScope } from "../../../../lib/active-workspace.ts";
import { projectMediaProcessingRoutes } from "../../index.ts";

const headers = { "content-type": "application/json" };

test("caption routes authorize admitted sources from live unsaved state and fence source changes", async () => {
	const backend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
	process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
	try {
		const jobs = new Map<string, CaptionProcessingJob>();
		const client: ProcessingMediaClient = {
			async processingReadiness() {
				return { available: true, limits: { ...DEFAULT_MEDIA_IMPORT_LIMITS } };
			},
			async submitProcessing(request) {
				if (!("type" in request)) throw new Error("Expected caption request");
				const old = [...jobs.values()].find(
					(job) => job.request.idempotencyKey === request.idempotencyKey,
				);
				if (old) return old.id;
				const id = randomUUID();
				jobs.set(id, {
					id,
					request,
					result: null,
					status: "queued",
					error: null,
					createdAt: Date.now(),
					startedAt: null,
					finishedAt: null,
				});
				return id;
			},
			async pollProcessing(id) {
				const job = jobs.get(id);
				if (!job) throw new Error("Missing fixture");
				return job;
			},
			async cancelProcessing(id) {
				const job = jobs.get(id)!;
				job.status = "cancelled";
				return job;
			},
		};
		const app = new Hono();
		app.use("*", installTestCaller());
		app.use("*", workspaceScope());
		app.route("/projects", projectMediaProcessingRoutes({ client }));
		const project = (await createContentProject({ title: "Caption source" })).project;
		const bytes = execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=2",
			"-f",
			"wav",
			"pipe:1",
		]);
		const stored = await putMedia({
			workspace: project.workspace,
			project: project.id,
			kind: "audio",
			body: new Uint8Array(bytes),
			filename: "speech.wav",
			contentType: "audio/wav",
		});
		const media = await registerMediaObject({
			workspace: project.workspace,
			kind: "audio",
			hash: stored.hash,
			storage_key: stored.key,
			content_type: stored.contentType,
			size: stored.size,
		});
		const asset = {
			id: "asset:1",
			label: "Speech",
			kind: "audio",
			url: mediaObjectUrl(media.id),
			dur: 2,
		};
		await setContentEditorState(project.id, { media_assets: [asset] });
		const input = {
			requestKey: randomUUID(),
			doc: {
				schemaVersion: 2,
				markers: [],
				clips: [
					{
						id: "audio:7",
						type: "audio",
						startSec: 5,
						durationSec: 1,
						track: 0,
						audio: {
							id: 7,
							kind: "voiceover",
							content: "",
							url: asset.url,
							start: 5,
							dur: 1,
							mediaStartSec: 0.25,
						},
					},
				],
			},
			source: "all",
			sourceRevisions: { [media.id]: media.id },
			language: "id",
			captionTrack: 2,
		};
		const post = (body: unknown, id = project.id) =>
			app.request(`/projects/${id}/captions/jobs`, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
			});
		const response = await post(input);
		expect(response.status).toBe(202);
		const { id } = (await response.json()) as { id: string };
		const job = jobs.get(id)!;
		expect(job.request.manifest).toMatchObject({
			startSec: 5,
			endSec: 6,
			sources: [
				{
					mediaId: media.id,
					timelineStartSec: 5,
					binding: { clipId: "audio:7", sourceStartSec: 0.25, sourceEndSec: 1.25 },
				},
			],
		});
		expect(JSON.parse(job.request.applyContext)).toMatchObject({
			startSec: 5,
			endSec: 6,
			ids: [],
			replaceEdited: false,
			snapshot: { sourceClips: [{ id: "audio:7", startSec: 5 }] },
		});
		expect((await post(input)).status).toBe(202);
		expect(jobs.size).toBe(1);

		expect((await app.request(`/projects/${project.id}/captions/jobs/${id}`)).status).toBe(200);
		for (const change of [
			{ sourceRevisions: { [media.id]: "stale" } },
			{ sourceRevisions: {} },
			{ path: "/tmp/source.wav" },
			{
				doc: {
					...input.doc,
					clips: [
						{
							...input.doc.clips[0],
							audio: { ...input.doc.clips[0]!.audio, url: "https://untrusted.test/speech.wav" },
						},
					],
				},
			},
			{
				doc: {
					...input.doc,
					clips: [{ ...input.doc.clips[0], durationSec: CAPTION_JOB_LIMITS.maxDurationSec + 1 }],
				},
			},
		])
			expect(
				(await post({ ...input, requestKey: randomUUID(), ...change })).status,
			).toBeGreaterThanOrEqual(400);
		const foreign = (await createContentProject({ title: "Other project" })).project;
		expect((await post(input, foreign.id)).status).toBe(409);
		expect((await app.request(`/projects/${foreign.id}/captions/jobs/${id}`)).status).toBe(404);
		expect(
			(await app.request(`/projects/${foreign.id}/captions/jobs/${id}`, { method: "DELETE" }))
				.status,
		).toBe(404);
		expect(
			(await post({ ...input, padding: "x".repeat(CAPTION_JOB_LIMITS.maxBodyBytes) })).status,
		).toBe(413);
		await setContentEditorState(project.id, { media_assets: [] });
		expect((await app.request(`/projects/${project.id}/captions/jobs/${id}`)).status).toBe(409);
		expect(
			(await app.request(`/projects/${project.id}/captions/jobs/${id}`, { method: "DELETE" }))
				.status,
		).toBe(200);
		expect(jobs.get(id)?.status).toBe("cancelled");
		const outsider = new Hono();
		outsider.use(
			"*",
			installTestCaller({
				userId: "caption-outsider",
				email: "outsider@example.com",
				role: "user",
			}),
		);
		outsider.use("*", workspaceScope());
		outsider.route("/projects", projectMediaProcessingRoutes({ client }));
		const denied = await outsider.request(`/projects/${project.id}/captions/jobs`, {
			method: "POST",
			headers,
			body: JSON.stringify(input),
		});
		expect(denied.status).toBe(400);
		expect(await denied.json()).toMatchObject({ error: "unknown_workspace" });
		expect(jobs.size).toBe(1);
		const requestKey = mintMediaId();
		await setContentEditorState(project.id, { media_assets: [asset] });
		const packetTail = (durationSec: number) => ({
			...input,
			requestKey: randomUUID(),
			doc: {
				...input.doc,
				clips: [
					{
						...input.doc.clips[0],
						durationSec,
						audio: { ...input.doc.clips[0]!.audio, dur: durationSec, mediaStartSec: 0 },
					},
				],
			},
		});
		const tail = await post(packetTail(2.02));
		expect(tail.status).toBe(202);
		const tailJob = jobs.get((await tail.json()).id)!;
		expect(tailJob.request.manifest.sources[0]!.durationSec).toBe(2);
		expect((await post(packetTail(2.06))).status).toBe(400);
		const { row } = await reserveProjectMediaImport({
			workspace: project.workspace,
			projectId: project.id,
			requestKey,
			filename: "speech.wav",
			kind: "audio",
			uploadTimeoutMs: 30_000,
		});
		await attachImportOriginal(row, {
			...stored,
			key: `workspaces/${project.workspace}/file/${project.id}/speech.wav`,
		});
		await finishProjectMediaImport(row, {
			...asset,
			kind: "audio",
			id: row.id,
			source: "upload",
			metadata: {
				originalFilename: "speech.wav",
				byteSize: stored.size,
				kind: "audio",
				duration: 2,
				hasAudio: true,
			},
			compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
			importedSource: {
				revision: row.source_revision,
				fingerprint: stored.hash,
				originalMediaId: media.id,
				playbackMediaId: media.id,
			},
		});
		await setContentEditorState(project.id, {
			media_assets: [{ ...asset, url: mediaUrl(requestKey) }],
		});
		expect(
			(
				await sourceMedia(media.id, {
					workspace: project.workspace,
					project: project.id,
					revision: row.source_revision,
				})
			).asset.url,
		).toBe(asset.url);
		await expect(
			sourceMedia(media.id, {
				workspace: project.workspace,
				project: foreign.id,
				revision: row.source_revision,
			}),
		).rejects.toThrow();
		await setContentEditorState(project.id, { media_assets: [] });
		expect(
			(
				await sourceMedia(media.id, {
					workspace: project.workspace,
					project: project.id,
					revision: row.source_revision,
				})
			).asset.url,
		).toBe(asset.url);
		await expect(
			sourceMedia(media.id, {
				workspace: project.workspace,
				project: project.id,
				revision: "stale",
			}),
		).rejects.toThrow();
	} finally {
		if (backend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
		else process.env.MALEO_MEDIA_STORAGE_BACKEND = backend;
	}
});
