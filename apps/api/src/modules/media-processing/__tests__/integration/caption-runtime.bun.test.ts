/* Explicit runtime proof: isolated API database, real Inngest/worker/Whisper and S3.
 * Set MALEO_CAPTION_RUNTIME_PROOF=1 and MALEO_CAPTION_PROOF_AUDIO_DIR to licensed WAV fixtures.
 */
import { expect, test } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";
import { createContentProject, setContentEditorState } from "@maleo/db/project-detail";
import { registerMediaObject, mediaObjectUrl } from "@maleo/db/media-objects";
import { createMediaClient } from "@maleo/media/api";
import { putMedia } from "@maleo/storage";
import { CaptionJobResponseSchema, type CaptionJobResponse } from "@maleo/shared";
import { applyCommand, editCaptions, moveClip, type EditorDoc } from "@maleo/shared/editor";
import { installTestCaller } from "../../../../middleware/auth-testing.ts";
import { workspaceScope } from "../../../../lib/active-workspace.ts";
import { internalMediaProcessingRoutes, projectMediaProcessingRoutes } from "../../index.ts";
import {
	internalMediaImportRoutes,
	projectMediaImportRoutes,
} from "../../../media-import/index.ts";
import { registerProjectRoutes } from "../../../../routes/operations/projects.ts";
import { registerStoryboardRoutes } from "../../../../routes/operations/storyboards.ts";
import { mediaRoutes } from "../../../../routes/media.ts";

const enabled = process.env.MALEO_CAPTION_RUNTIME_PROOF === "1";
test.skipIf(!enabled)(
	"real local/S3 API caption jobs run through Inngest, preserve no-speech/cancel, and fence stale sources",
	async () => {
		const audioDirectory = process.env.MALEO_CAPTION_PROOF_AUDIO_DIR;
		if (
			!audioDirectory ||
			!process.env.MALEO_CAPTION_PROOF_WORKER_URL ||
			!process.env.MALEO_SERVICE_TOKEN
		)
			throw new Error("Runtime proof needs licensed audio directory, worker URL and service token");
		const port = Number(process.env.MALEO_CAPTION_PROOF_API_PORT ?? 18090);
		const app = new Hono();
		const media = new Hono();
		media.use("*", installTestCaller());
		media.route("/", mediaRoutes());
		app.route("/api/media", media);
		app.route("/internal/media-processing", internalMediaProcessingRoutes());
		app.route("/internal/media-imports", internalMediaImportRoutes());
		const projects = new Hono();
		projects.use("*", installTestCaller());
		projects.use("*", workspaceScope());
		projects.route(
			"/",
			projectMediaProcessingRoutes({
				client: createMediaClient({
					baseUrl: process.env.MALEO_CAPTION_PROOF_WORKER_URL!,
					token: process.env.MALEO_SERVICE_TOKEN!,
				}),
			}),
		);
		app.route("/api/operations/projects", projects);
		const operations = new Hono();
		operations.use("*", installTestCaller());
		operations.use("*", workspaceScope());
		operations.route(
			"/projects",
			projectMediaImportRoutes({
				client: createMediaClient({
					baseUrl: process.env.MALEO_CAPTION_PROOF_WORKER_URL!,
					token: process.env.MALEO_SERVICE_TOKEN!,
				}),
			}),
		);
		registerProjectRoutes(operations);
		registerStoryboardRoutes(operations);
		app.route("/api/operations", operations);
		const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
		const base = `http://127.0.0.1:${port}`;
		const proof: unknown[] = [];
		const originalBackend = process.env.MALEO_MEDIA_STORAGE_BACKEND;
		const originalDataDir = process.env.MALEO_DATA_DIR;
		if (!originalDataDir) throw new Error("Runtime proof requires an isolated test data directory");
		try {
			for (const [backend, sample, language] of [
				["local", "en_us", "en"],
				["local", "en_us_video", "en"],
				["s3", "id_id", "id"],
				["local", "silence", "auto"],
			] as const) {
				process.env.MALEO_MEDIA_STORAGE_BACKEND = backend;
				const kind = sample === "en_us_video" ? "video" : "audio";
				const filename = `${sample}.${kind === "video" ? "mp4" : "wav"}`;
				const bytes = new Uint8Array(await Bun.file(join(audioDirectory, filename)).arrayBuffer());
				const duration = Number(
					execFileSync(
						"ffprobe",
						[
							"-v",
							"error",
							"-show_entries",
							"format=duration",
							"-of",
							"default=nw=1:nk=1",
							join(audioDirectory, filename),
						],
						{ encoding: "utf8" },
					).trim(),
				);
				const project = (
					await createContentProject({ title: `Caption ${backend} runtime`, type: "video" })
				).project;
				const stored = await putMedia({
					workspace: project.workspace,
					kind,
					body: bytes,
					filename,
					contentType: kind === "video" ? "video/mp4" : "audio/wav",
				});
				const media = await registerMediaObject({
					workspace: project.workspace,
					kind,
					hash: stored.hash,
					storage_key: stored.key,
					content_type: stored.contentType,
					size: stored.size,
				});
				const url = mediaObjectUrl(media.id);
				await setContentEditorState(project.id, {
					media_assets: [{ id: "speech", label: sample, kind, url, dur: duration }],
				});
				const doc: EditorDoc = {
					schemaVersion: 2,
					markers: [],
					clips: [
						{
							id: "audio:7",
							type: "audio",
							track: 0,
							startSec: 2,
							durationSec: duration,
							audio: {
								id: 7,
								kind: "voiceover",
								content: "",
								url,
								start: 2,
								dur: duration,
								originalDur: duration,
								track: 0,
							},
						},
					],
				};
				if (kind === "video") {
					doc.clips = [
						{
							id: "video:7",
							type: "video",
							track: 0,
							startSec: 2,
							durationSec: duration,
							video: {
								id: 7,
								kind: "video",
								url,
								start: 2,
								dur: duration,
								sourceDurationSec: duration,
								volume: 1,
								track: 0,
							},
						},
					];
				}
				const input = {
					requestKey: randomUUID(),
					doc,
					source: "all",
					sourceRevisions: { [media.id]: media.id },
					language,
					captionTrack: 1,
					replaceEdited: false,
				};
				const path = `${base}/api/operations/projects/${project.id}/captions/jobs`;
				const started = performance.now();
				const submit = await fetch(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(input),
				});
				expect(submit.status, await submit.clone().text()).toBe(202);
				const accepted: { id: string } = await submit.json();
				let job: CaptionJobResponse | undefined;
				const stages = new Set<string>();
				while (performance.now() - started < 45_000) {
					const response = await fetch(`${path}/${accepted.id}`);
					expect(response.status, await response.clone().text()).toBe(200);
					job = CaptionJobResponseSchema.parse(await response.json());
					stages.add(job.stage ?? job.status);
					if (["done", "failed", "cancelled"].includes(job.status)) break;
					await Bun.sleep(150);
				}
				expect(job?.status, JSON.stringify(job)).toBe("done");
				if (sample === "silence") expect(job?.result?.cues).toEqual([]);
				else expect(job?.result?.cues.length).toBeGreaterThan(0);
				const result = job!.result!;
				const applied = applyCommand(
					{ doc, slides: [], posts: [], mediaAssets: [] },
					editCaptions({
						action: "apply-result",
						...job!.context,
						candidates: result.cues,
						runId: job!.id,
						language: result.language,
						...(result.detectedLanguage ? { detectedLanguage: result.detectedLanguage } : {}),
					}),
				);
				expect(applied.doc.clips.filter((clip) => clip.type === "caption").length).toBe(
					result.cues.length,
				);
				expect(
					applyCommand(
						applied,
						editCaptions({
							action: "apply-result",
							...job!.context,
							candidates: result.cues,
							runId: job!.id,
							language: result.language,
						}),
					).doc,
				).toEqual(applied.doc);
				const moved = {
					...doc,
					clips: doc.clips.map((clip) => ({
						...clip,
						startSec: 3,
						audio: { ...clip.audio!, start: 3 },
					})),
				};
				if (sample !== "silence")
					expect(() =>
						applyCommand(
							{ ...applied, doc: moved },
							editCaptions({
								action: "apply-result",
								...job!.context,
								candidates: result.cues,
								runId: job!.id,
								language: result.language,
							}),
						),
					).toThrow();
				const cancelled = await fetch(path, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ ...input, requestKey: randomUUID() }),
				});
				expect(cancelled.status).toBe(202);
				const cancelledId: { id: string } = await cancelled.json();
				expect((await fetch(`${path}/${cancelledId.id}`, { method: "DELETE" })).status).toBe(200);
				const stopped = CaptionJobResponseSchema.parse(
					await (await fetch(`${path}/${cancelledId.id}`)).json(),
				);
				expect(stopped.status).toBe("cancelled");
				expect(stopped.result).toBeNull();
				if (sample === "en_us") {
					let mixed = {
						...applied,
						doc: {
							...doc,
							clips: [
								doc.clips[0]!,
								{
									...doc.clips[0]!,
									id: "audio:8",
									track: 2,
									audio: { ...doc.clips[0]!.audio!, id: 8, track: 2, volume: 0.1 },
								},
							],
						},
					};
					const runs = [];
					for (const replacing of [false, true]) {
						const response = await fetch(path, {
							method: "POST",
							headers: { "content-type": "application/json" },
							body: JSON.stringify({
								...input,
								doc: mixed.doc,
								requestKey: randomUUID(),
								replaceEdited: replacing,
							}),
						});
						expect(response.status, await response.clone().text()).toBe(202);
						const accepted: { id: string } = await response.json();
						const deadline = Date.now() + 45_000;
						let completed: CaptionJobResponse;
						do {
							completed = CaptionJobResponseSchema.parse(
								await (await fetch(`${path}/${accepted.id}`)).json(),
							);
							if (["done", "failed", "cancelled"].includes(completed.status)) break;
							await Bun.sleep(150);
						} while (Date.now() < deadline);
						expect(completed!.status, JSON.stringify(completed!)).toBe("done");
						expect(
							completed!.result!.cues.some((cue) => cue.caption?.sources.length === 2),
							JSON.stringify(completed!),
						).toBe(true);
						mixed = applyCommand(
							mixed,
							editCaptions({
								action: "apply-result",
								...completed!.context,
								candidates: completed!.result!.cues,
								runId: completed!.id,
								language: completed!.language,
							}),
						);
						runs.push(completed!);
						if (!replacing) {
							const cue = mixed.doc.clips.find((clip) => clip.type === "caption")!;
							mixed = applyCommand(
								mixed,
								editCaptions({
									action: "update",
									id: cue.id,
									text: "Protected mixed-source correction",
								}),
							);
							mixed = applyCommand(mixed, moveClip("audio:8", { startSec: 2.25 }));
							expect(mixed.doc.clips.some((clip) => clip.caption?.status === "needs-refresh")).toBe(
								true,
							);
							expect(mixed.doc.clips.find((clip) => clip.id === cue.id)?.caption?.text).toBe(
								"Protected mixed-source correction",
							);
						} else
							expect(
								mixed.doc.clips
									.filter((clip) => clip.caption)
									.every((clip) => clip.caption!.status === "current"),
							).toBe(true);
					}
					proof.push({
						sample: "mixed-source-refresh",
						durationSec: duration + 0.25,
						result: runs.at(-1)!.result,
						runs,
						final: mixed.doc,
					});
				}
				await setContentEditorState(project.id, { media_assets: [] });
				expect((await fetch(`${path}/${accepted.id}`)).status).toBe(409);
				expect(
					(
						await fetch(
							`${base}/internal/media-processing/${media.id}/source?workspace=${project.workspace}&project=${project.id}&revision=${media.id}`,
						)
					).status,
				).toBe(401);
				proof.push({
					backend,
					sample,
					language,
					durationSec: duration,
					elapsedMs: performance.now() - started,
					observedStages: [...stages],
					jobId: accepted.id,
					result,
				});
			}
			const output = process.env.MALEO_CAPTION_PROOF_OUTPUT;
			if (output)
				await Bun.write(output, JSON.stringify({ date: new Date().toISOString(), proof }, null, 2));
			if (process.env.MALEO_CAPTION_PROOF_BROWSER === "1") {
				const storage = process.env.MALEO_CAPTION_PROOF_STORAGE_DIR;
				if (!storage)
					throw new Error("Browser import proof needs worker's shared local storage directory");
				process.env.MALEO_DATA_DIR = storage;
				process.env.MALEO_MEDIA_STORAGE_BACKEND = "local";
				const ids = [];
				for (const width of [1440, 320])
					ids.push({
						width,
						id: (await createContentProject({ title: `Caption browser ${width}`, type: "video" }))
							.project.id,
					});
				const child = spawn(
					"bun",
					[
						"x",
						"playwright",
						"test",
						"caption-runtime.spec.ts",
						"--project=visual",
						"--workers=1",
						...(process.env.MALEO_CAPTION_PROOF_BROWSER_CONFIG
							? ["--config", process.env.MALEO_CAPTION_PROOF_BROWSER_CONFIG]
							: []),
					],
					{
						cwd: resolve(import.meta.dirname, "../../../../../../web"),
						env: {
							...process.env,
							MALEO_CAPTION_BROWSER_PROJECTS: JSON.stringify(ids),
							MALEO_CAPTION_BROWSER_API: base,
							MALEO_CAPTION_BROWSER_VIDEO: join(audioDirectory, "talking-head.mp4"),
						},
						stdio: "inherit",
					},
				);
				const exit = await new Promise<number | null>((done, reject) => {
					child.on("close", done);
					child.on("error", reject);
				});
				expect(exit).toBe(0);
			}
		} finally {
			await server.stop(true);
			if (originalBackend === undefined) delete process.env.MALEO_MEDIA_STORAGE_BACKEND;
			else process.env.MALEO_MEDIA_STORAGE_BACKEND = originalBackend;
			process.env.MALEO_DATA_DIR = originalDataDir;
		}
	},
	120_000,
);
