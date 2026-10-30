import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMediaClient } from "../api/client.ts";
import { CaptionProcessingRequestSchema } from "../api/processing.ts";
import { cancelProcessingJob, createProcessingJob, getProcessingJob } from "../generation/store.ts";
import { runCaptionJob } from "./caption-run.ts";
import { transcribeLocalWhisper } from "./whisper.ts";
import { speechRoutes } from "./speech-routes.ts";
import { processingRoutes } from "./routes.ts";
import { inngest } from "@maleo/inngest";
import { spyOn } from "bun:test";

let directory: string, audio: Buffer;
const names = [
	"CACHE_DIR",
	"MALEO_WHISPER_CPP_DIR",
	"MALEO_CAPTION_CACHE_DIR",
	"MALEO_WHISPER_MODEL",
	"MALEO_WHISPER_CPP_VERSION",
	"MALEO_WHISPER_AUTO_INSTALL",
	"MALEO_SERVICE_TOKEN",
	"MALEO_TEST_WHISPER_MODE",
	"MALEO_TEST_WHISPER_PID",
];
const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "caption-run-proof-"));
	process.env.CACHE_DIR = join(directory, "scratch");
	process.env.MALEO_WHISPER_CPP_DIR = join(directory, "engine");
	process.env.MALEO_CAPTION_CACHE_DIR = join(directory, "cache");
	process.env.MALEO_WHISPER_MODEL = "base";
	process.env.MALEO_WHISPER_CPP_VERSION = "1.5.5";
	process.env.MALEO_WHISPER_AUTO_INSTALL = "0";
	process.env.MALEO_SERVICE_TOKEN = "caption-proof-only";
	process.env.MALEO_TEST_WHISPER_PID = join(directory, "pid");
	await mkdir(process.env.MALEO_WHISPER_CPP_DIR);
	const executable = join(process.env.MALEO_WHISPER_CPP_DIR, "main");
	await writeFile(
		executable,
		`#!/usr/bin/env bun
import { writeFileSync } from "node:fs";
writeFileSync(process.env.MALEO_TEST_WHISPER_PID, String(process.pid));
const mode = process.env.MALEO_TEST_WHISPER_MODE;
if (mode === "slow") await new Promise((resolve) => setTimeout(resolve, 60000));
if (mode === "fail") process.exit(2);
if (mode === "unsupported-dtw") { console.error("error: unknown DTW preset 'large.v3.turbo'"); process.exit(2); }
if (mode === "alignment-assert") { console.error("WHISPER_ASSERT: whisper.cpp:7003: filter_width < a->ne[2]"); process.exit(134); }
const output = process.argv[process.argv.indexOf("--output-file") + 1];
writeFileSync(output + ".json", JSON.stringify({ result: { language: "id" }, transcription: mode === "empty" ? [] : [
 { text: " Halo", offsets: { from: 100, to: 400 } }, { text: " dunia.", offsets: { from: 450, to: mode === "gap" ? 5000 : 800 } },
 { text: "[BLANK_AUDIO]", offsets: { from: 800, to: 1000 } }
] }));
`,
	);
	await chmod(executable, 0o700);
	await writeFile(join(process.env.MALEO_WHISPER_CPP_DIR, "ggml-base.bin"), "fixture model");
	audio = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=1",
		"-f",
		"wav",
		"pipe:1",
	]);
});
afterAll(async () => {
	for (const name of names)
		if (previous[name] === undefined) delete process.env[name];
		else process.env[name] = previous[name];
	await rm(directory, { recursive: true, force: true });
});
async function fresh(mode = "normal") {
	process.env.MALEO_TEST_WHISPER_MODE = mode;
	await rm(join(directory, "cache"), { recursive: true, force: true });
	await rm(join(directory, "pid"), { force: true });
	const mediaId = randomUUID();
	const manifest = {
		version: 1,
		startSec: 5,
		endSec: 6,
		sources: [
			{
				binding: {
					clipId: "audio:1",
					mediaId,
					mediaRevision: "r1",
					sourceStartSec: 0,
					sourceEndSec: 1,
				},
				mediaId,
				sourceRevision: "r1",
				fingerprint: createHash("sha256").update(audio).digest("hex"),
				kind: "audio",
				role: "voiceover",
				timelineStartSec: 5,
				durationSec: 1,
				sourceDurationSec: 1,
				playbackRate: 1,
				preservePitch: false,
				reverse: false,
				volume: 1,
				fadeInSec: 0,
				fadeOutSec: 0,
				loop: false,
			},
		],
	};
	return CaptionProcessingRequestSchema.parse({
		type: "captions",
		workspaceId: "proof",
		projectId: randomUUID(),
		idempotencyKey: randomUUID(),
		manifest,
		manifestHash: createHash("sha256").update(JSON.stringify(manifest)).digest("hex"),
		language: "id",
		captionTrack: 2,
		applyContext: "{}",
	});
}
const transport = {
	apiBaseUrl: "http://api.test",
	serviceToken: "caption-proof-only",
	fetch: async (_url: RequestInfo | URL, init?: RequestInit) =>
		new Response(init?.method === "HEAD" ? null : new Uint8Array(audio), {
			headers: { "content-length": String(audio.length) },
		}),
};

test("caption execution publishes canonical source-bound candidates and stable warm-cache results", async () => {
	const request = await fresh(),
		job = createProcessingJob(request);
	const result = await runCaptionJob(job.id, transport);
	expect(result?.cues).toMatchObject([
		{
			id: `caption:${job.id}:0`,
			caption: {
				text: "Halo dunia.",
				sources: [{ clipId: "audio:1" }],
				provenance: { origin: "recognized" },
			},
		},
	]);
	expect(result?.cues[0]?.startSec).toBeCloseTo(5.1);
	expect(result?.cues[0]?.durationSec).toBeCloseTo(0.7);
	expect(result?.cues[0]?.caption.sources[0]?.sourceStartSec).toBeCloseTo(0.1);
	expect(getProcessingJob(job.id)).toMatchObject({ status: "done", stage: "ready" });
	expect(await runCaptionJob(job.id, transport)).toEqual(result);
	const warm = createProcessingJob({ ...request, idempotencyKey: randomUUID() });
	expect((await runCaptionJob(warm.id, transport))?.fromCache).toBe(true);
	expect(await readdir(process.env.CACHE_DIR!)).toEqual([]);
});

test.each([0.1, 2, 20])(
	"voiceovers separated by %ss retain independent words and an empty caption gap",
	async (gap) => {
		const request = await fresh("gap");
		const first = request.manifest.sources[0]!;
		const second = {
			...first,
			timelineStartSec: 6 + gap,
			binding: { ...first.binding, clipId: "audio:2" },
		};
		request.manifest.endSec = second.timelineStartSec + 1;
		request.manifest.sources.push(second);
		request.manifestHash = createHash("sha256")
			.update(JSON.stringify(request.manifest))
			.digest("hex");
		const job = createProcessingJob(request);
		const result = await runCaptionJob(job.id, transport);
		expect(result?.cues).toHaveLength(2);
		for (const [index, source] of [first, second].entries()) {
			const cue = result!.cues[index]!;
			expect(cue.caption.text).toBe("Halo dunia.");
			expect(cue.startSec).toBeCloseTo(source.timelineStartSec + 0.1);
			expect(cue.startSec + cue.durationSec).toBeCloseTo(source.timelineStartSec + 1);
			expect(cue.caption.words.at(-1)!.endSec).toBeCloseTo(cue.durationSec);
			expect(cue.caption.sources).toHaveLength(1);
			expect(cue.caption.sources[0]!.clipId).toBe(source.binding.clipId);
			expect(cue.caption.sources[0]!.sourceEndSec).toBeCloseTo(1);
		}
		expect(result!.cues[0]!.startSec + result!.cues[0]!.durationSec).toBeLessThanOrEqual(6);
		expect(result!.cues[1]!.startSec).toBeGreaterThanOrEqual(second.timelineStartSec);
		const warm = createProcessingJob({ ...request, idempotencyKey: randomUUID() });
		expect((await runCaptionJob(warm.id, transport))?.fromCache).toBe(true);
		expect(await readdir(process.env.CACHE_DIR!)).toEqual([]);
	},
);

test("overlapping voiceovers remain one recognition pass over the audible mix", async () => {
	const request = await fresh();
	const first = request.manifest.sources[0]!;
	request.manifest.sources.push({
		...first,
		timelineStartSec: 5.5,
		binding: { ...first.binding, clipId: "audio:2" },
	});
	request.manifest.endSec = 6.5;
	request.manifestHash = createHash("sha256")
		.update(JSON.stringify(request.manifest))
		.digest("hex");
	const result = await runCaptionJob(createProcessingJob(request).id, transport);
	expect(result?.cues).toHaveLength(1);
	expect(result?.cues[0]?.caption.sources.map((source) => source.clipId)).toEqual([
		"audio:1",
		"audio:2",
	]);
});

test("worker HTTP/client preserve caption submit/poll/cancel identity and readiness", async () => {
	const request = await fresh();
	const send = spyOn(inngest, "send").mockResolvedValue({ ids: ["caption-event"] });
	try {
		const routes = processingRoutes();
		const client = createMediaClient({
			baseUrl: "http://worker.test",
			token: "caption-proof-only",
			fetch: async (url, init) => routes.request(String(url).replace("/processing", ""), init),
		});
		expect((await client.processingReadiness("captions")).captions?.available).toBe(true);
		const id = await client.submitProcessing(request);
		expect(await client.submitProcessing(request)).toBe(id);
		expect((await client.pollProcessing(id, request)).request).toEqual(request);
		await expect(client.pollProcessing(id, { ...request, workspaceId: "other" })).rejects.toThrow(
			"404",
		);
		expect((await client.cancelProcessing(id, request)).status).toBe("cancelled");
		expect(await runCaptionJob(id, transport)).toBeNull();
		await expect(client.submitProcessing({ ...request, language: "en" })).rejects.toThrow("409");
	} finally {
		send.mockRestore();
	}
});

test("source failure and no-speech never publish partial captions; retry keeps original deadline", async () => {
	for (const mode of ["empty", "fail", "unsupported-dtw", "alignment-assert", "stale"]) {
		const request = await fresh(mode),
			job = createProcessingJob(request);
		if (mode === "empty") expect((await runCaptionJob(job.id, transport))?.cues).toEqual([]);
		else {
			await expect(
				runCaptionJob(
					job.id,
					mode === "stale"
						? {
								...transport,
								fetch: async (url, init) =>
									init?.method === "HEAD"
										? new Response(null, { status: 409 })
										: transport.fetch(url, init),
							}
						: transport,
				),
			).rejects.toThrow();
			expect(getProcessingJob(job.id)).toMatchObject({ status: "failed", result: null });
			const startedAt = getProcessingJob(job.id)!.startedAt;
			process.env.MALEO_TEST_WHISPER_MODE = "normal";
			expect((await runCaptionJob(job.id, transport))?.cues.length).toBe(1);
			expect(getProcessingJob(job.id)!.startedAt).toBe(startedAt);
		}
		expect(await readdir(process.env.CACHE_DIR!)).toEqual([]);
	}
}, 30_000);

test("cancellation kills owned recognition process and remains terminal after late completion", async () => {
	const request = await fresh("slow"),
		job = createProcessingJob(request);
	const pending = runCaptionJob(job.id, transport);
	// Attach rejection before the cancellation can fire.
	const stopped = pending.then(
		() => undefined,
		(error: unknown) => error,
	);
	let pid = 0;
	const readyBy = performance.now() + 5_000;
	try {
		// Recognition starts after source preprocessing.
		while (performance.now() < readyBy) {
			try {
				pid = Number(await readFile(join(directory, "pid"), "utf8"));
				break;
			} catch {
				await Bun.sleep(10);
			}
		}
		expect(pid).toBeGreaterThan(0);
		cancelProcessingJob(job.id);
		expect(await stopped).toBeInstanceOf(Error);
		expect(() => process.kill(pid, 0)).toThrow();
		expect(getProcessingJob(job.id)).toMatchObject({ status: "cancelled", result: null });
		expect(await runCaptionJob(job.id, transport)).toBeNull();
		expect(await readdir(process.env.CACHE_DIR!)).toEqual([]);
		expect(
			(await readdir(process.env.MALEO_CAPTION_CACHE_DIR!)).filter((name) =>
				name.startsWith("recognize-"),
			),
		).toEqual([]);
	} finally {
		cancelProcessingJob(job.id);
		await stopped;
	}
}, 30_000);

test("generated narration adapter uses worker-owned cache with offsets outside cache identity", async () => {
	await fresh();
	const input = join(directory, "source.wav");
	await writeFile(input, audio);
	const first = await transcribeLocalWhisper({ audioPath: input, force: true, language: "id" });
	const second = await transcribeLocalWhisper({
		audioPath: input,
		force: true,
		language: "id",
		offsetSec: 100,
	});
	expect(first?.words[0]?.startSec).toBe(0.1);
	expect(second).toMatchObject({
		cached: true,
		detectedLanguage: "id",
		words: [
			{ text: "Halo", startSec: 100.1 },
			{ text: "dunia.", startSec: 100.45 },
		],
	});
	const app = speechRoutes();
	const client = createMediaClient({
		baseUrl: "http://worker.test",
		token: "caption-proof-only",
		fetch: async (url, init) => app.request(String(url).replace("/speech", ""), init),
	});
	expect((await client.speechStatus()).ready).toBe(true);
	expect(
		(
			await client.transcribeSpeech(new Blob([new Uint8Array(audio)]), {
				language: "id",
				force: true,
			})
		)?.cached,
	).toBe(true);
	expect((await app.request("/status")).status).toBe(401);
});

test("manifest tampering, changed bytes and persisted deadline leave no caption result or scratch", async () => {
	for (const failure of ["manifest", "fingerprint", "deadline"]) {
		const request = await fresh(failure === "deadline" ? "slow" : "normal");
		if (failure === "manifest") request.manifestHash = "0".repeat(64);
		if (failure === "fingerprint") {
			request.manifest.sources[0]!.fingerprint = "0".repeat(64);
			request.manifestHash = createHash("sha256")
				.update(JSON.stringify(request.manifest))
				.digest("hex");
		}
		const job = createProcessingJob(request);
		await expect(
			runCaptionJob(job.id, {
				...transport,
				...(failure === "deadline" ? { limits: { processingTimeoutMs: 400 } } : {}),
			}),
		).rejects.toThrow();
		expect(getProcessingJob(job.id)).toMatchObject({ status: "failed", result: null });
		if (failure === "deadline")
			expect(getProcessingJob(job.id)?.error).toBe("Caption processing deadline exceeded");
		expect(await readdir(process.env.CACHE_DIR!)).toEqual([]);
	}
});
