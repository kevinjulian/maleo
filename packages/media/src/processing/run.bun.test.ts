import { afterAll, beforeAll, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { ProcessingRequestSchema, type MediaProcessingRequest } from "../api/processing.ts";
import {
	cancelProcessingJob,
	createProcessingJob,
	getProcessingJob,
	startProcessingJob,
} from "../generation/store.ts";
import type { StoredMedia } from "@maleo/storage";
import { runMediaCommand } from "./probe.ts";
import { runProcessingJob, type ProcessingOptions } from "./run.ts";

let directory: string;
const previousCache = process.env.CACHE_DIR;
let image: Buffer;
let video: Buffer;
let audio: Buffer;

beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), "maleo-import-proof-"));
	process.env.CACHE_DIR = directory;
	image = await sharp({ create: { width: 64, height: 64, channels: 4, background: "#247abc80" } })
		.png()
		.toBuffer();
	video = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=64x64:r=30",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440",
		"-t",
		"1",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	audio = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=660",
		"-t",
		"1",
		"-f",
		"wav",
		"pipe:1",
	]);
});
afterAll(async () => {
	if (previousCache === undefined) delete process.env.CACHE_DIR;
	else process.env.CACHE_DIR = previousCache;
	await rm(directory, { recursive: true, force: true });
});

function request(
	bytes: Buffer,
	kind: MediaProcessingRequest["kind"] = "image",
): MediaProcessingRequest {
	return {
		importId: randomUUID(),
		workspaceId: "proof",
		projectId: "project",
		sourceRevision: "r1",
		originalFilename: "Original file",
		kind,
		fingerprint: createHash("sha256").update(bytes).digest("hex"),
		idempotencyKey: randomUUID(),
	};
}

function transport(bytes: Buffer, req: MediaProcessingRequest): ProcessingOptions {
	return {
		apiBaseUrl: "http://api.test",
		serviceToken: "test-only",
		fetch: async (input, init) => {
			const url = new URL(String(input));
			if (
				url.searchParams.get("workspace") !== req.workspaceId ||
				url.searchParams.get("project") !== req.projectId ||
				url.searchParams.get("revision") !== req.sourceRevision ||
				init?.headers == null
			)
				return new Response(null, { status: 403 });
			return new Response(init?.method === "HEAD" ? null : new Uint8Array(bytes), {
				headers: { "content-length": String(bytes.length) },
			});
		},
		put: async (input) => {
			const blob = input.body instanceof Blob ? input.body : new Blob([new Uint8Array(input.body)]);
			return {
				key: `workspaces/${input.workspace}/${input.kind}/${input.project}/${randomUUID()}-${input.filename}`,
				hash: createHash("sha256")
					.update(Buffer.from(await blob.arrayBuffer()))
					.digest("hex"),
				size: blob.size,
				contentType: input.contentType,
			};
		},
		remove: async () => {},
	};
}

test("processing probes and normalizes synthetic image/video/audio, keeping durable retries idempotent", async () => {
	for (const [kind, bytes] of [
		["image", image],
		["video", video],
		["audio", audio],
	] as const) {
		const req = request(bytes, kind);
		const job = createProcessingJob(req);
		expect(createProcessingJob(req).id).toBe(job.id);
		const result = await runProcessingJob(job.id, transport(bytes, req));
		expect(result?.metadata).toMatchObject({
			kind,
			originalFilename: "Original file",
			byteSize: bytes.length,
		});
		expect(result?.compatibility.preview.status).toBe("supported");
		expect(result?.compatibility.render.status).toBe("supported");
		if (kind === "video") {
			expect(result?.metadata.hasAudio).toBe(true);
			expect(result?.metadata.duration).toBeGreaterThan(0.9);
			expect(result?.metadata.frameRate?.mode).toBe("constant");
		}
		expect(
			await runProcessingJob(job.id, {
				...transport(bytes, req),
				fetch: async () => {
					throw new Error("must not reprocess");
				},
			}),
		).toEqual(result);
		expect(() => createProcessingJob({ ...req, sourceRevision: "r2" })).toThrow("does not match");
	}
});

test("cancelling a finished job releases its outputs to managed-store cleanup", async () => {
	const req = request(image);
	const job = createProcessingJob(req);
	expect(await runProcessingJob(job.id, transport(image, req))).not.toBeNull();
	expect(cancelProcessingJob(job.id)).toBe(true);
	expect(getProcessingJob(job.id)).toMatchObject({ status: "cancelled", result: null });
	expect(await runProcessingJob(job.id, transport(image, req))).toBeNull();
});

test("imported playback duration permits reversing its full admitted source", async () => {
	const bytes = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=64x36:r=30:d=8",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=880:sample_rate=48000:duration=8",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const req = request(bytes, "video"),
		options = transport(bytes, req),
		put = options.put!;
	let playback: Buffer | undefined;
	options.put = async (input) => {
		if (input.kind === "video")
			playback =
				input.body instanceof Blob
					? Buffer.from(await input.body.arrayBuffer())
					: Buffer.from(input.body);
		return put(input);
	};
	const imported = await runProcessingJob(createProcessingJob(req).id, options);
	expect(playback).toBeDefined();
	const reverse: MediaProcessingRequest = {
		...request(playback!, "video"),
		sourceMediaId: randomUUID(),
		operation: {
			type: "reverse",
			startSec: 1 / 30,
			durationSec: imported!.metadata.duration! - 1 / 30,
		},
	};
	const result = await runProcessingJob(
		createProcessingJob(reverse).id,
		transport(playback!, reverse),
	);
	expect(result?.derivative?.metadata.duration).toBeCloseTo(reverse.operation!.durationSec, 1);
});

test("ownership, forged kind, fingerprint, byte/scratch limits and deadline failures publish nothing", async () => {
	for (const failure of [
		"ownership",
		"kind",
		"fingerprint",
		"bytes",
		"scratch",
		"deadline",
	] as const) {
		const req = request(image, failure === "kind" ? "video" : "image");
		if (failure === "fingerprint") req.fingerprint = "b".repeat(64);
		const job = createProcessingJob(req);
		const options = transport(image, req);
		let writes = 0;
		options.put = async () => {
			writes++;
			throw new Error("unexpected publication");
		};
		if (failure === "ownership") options.fetch = async () => new Response(null, { status: 403 });
		if (failure === "bytes") options.limits = { maxFileBytes: 1 };
		if (failure === "scratch") options.limits = { maxScratchBytes: 1024 };
		if (failure === "deadline") options.limits = { processingTimeoutMs: 1 };
		await expect(runProcessingJob(job.id, options)).rejects.toThrow();
		expect(writes).toBe(0);
		expect(getProcessingJob(job.id)).toMatchObject({ status: "failed", result: null });
	}
	expect(
		ProcessingRequestSchema.safeParse({ ...request(image), url: "http://untrusted.test/file" })
			.success,
	).toBe(false);
});

test("partial storage failure and cancellation discard outputs; durable retry retains original start", async () => {
	for (const cancellation of [false, true]) {
		const req = request(image);
		const job = createProcessingJob(req);
		const options = transport(image, req);
		const put = options.put!;
		const removed: string[] = [];
		const written: StoredMedia[] = [];
		options.remove = async (key) => {
			removed.push(key);
		};
		options.put = async (input) => {
			if (written.length && !cancellation) throw new Error("storage unavailable");
			const stored = await put(input);
			written.push(stored);
			if (cancellation) cancelProcessingJob(job.id);
			return stored;
		};
		await expect(runProcessingJob(job.id, options)).rejects.toThrow();
		expect(getProcessingJob(job.id)).toMatchObject({
			status: cancellation ? "cancelled" : "failed",
			result: null,
		});
		expect(removed).toContain(written[0]!.key);
		const started = getProcessingJob(job.id)!.startedAt;
		if (cancellation) expect(await runProcessingJob(job.id, transport(image, req))).toBeNull();
		else {
			expect(await runProcessingJob(job.id, transport(image, req))).not.toBeNull();
			expect(getProcessingJob(job.id)!.startedAt).toBe(started);
		}
	}
});

test("subprocess cancellation terminates bounded work", async () => {
	await expect(
		runMediaCommand(
			process.execPath,
			["-e", "setTimeout(() => {}, 10000)"],
			AbortSignal.timeout(20),
		),
	).rejects.toThrow();
});

test("resuming persisted processing keeps deadline and detects variable source timestamps", async () => {
	const variable = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=red:s=64x64:r=30:d=1",
		"-vf",
		"setpts=if(lt(N\\,10)\\,N/(30*TB)\\,(10/30+(N-10)/15)/TB)",
		"-fps_mode",
		"vfr",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const req = request(variable, "video");
	const job = createProcessingJob(req);
	expect(startProcessingJob(job.id)).toBe(true);
	const started = getProcessingJob(job.id)!.startedAt;
	const result = await runProcessingJob(job.id, transport(variable, req));
	expect(result?.metadata.frameRate?.mode).toBe("variable");
	expect(getProcessingJob(job.id)!.startedAt).toBe(started);
});

test("MPEG-4 Part 2 source converts to browser/render-compatible H.264 without losing original codec metadata", async () => {
	const bytes = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=64x64:r=30:d=1",
		"-c:v",
		"mpeg4",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const req = request(bytes, "video"),
		job = createProcessingJob(req),
		options = transport(bytes, req);
	const put = options.put!;
	let codec: string | undefined;
	options.put = async (input) => {
		if (input.kind === "video") {
			const path = join(directory, "converted.mp4");
			await Bun.write(path, input.body);
			codec = execFileSync(
				"ffprobe",
				[
					"-v",
					"error",
					"-select_streams",
					"v:0",
					"-show_entries",
					"stream=codec_name",
					"-of",
					"default=nw=1:nk=1",
					path,
				],
				{ encoding: "utf8" },
			).trim();
		}
		return put(input);
	};
	const result = await runProcessingJob(job.id, options);
	expect(result?.metadata.videoCodec).toBe("mpeg4");
	expect(codec).toBe("h264");
	expect(result?.compatibility).toEqual({
		preview: { status: "supported" },
		render: { status: "supported" },
	});
});

test("reverse worker retains original identity and reverses selected numbered frames and audible source", async () => {
	const bytes = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"nullsrc=s=32x32:r=30:d=12,geq=lum=mod(N\\,64)*4:cb=128:cr=128",
		"-f",
		"lavfi",
		"-i",
		"aevalsrc=sin(2*PI*440*t)*(0.8*between(t\\,0.60\\,0.63)+0.4*between(t\\,1.20\\,1.23)):s=48000:d=12",
		"-t",
		"12",
		"-c:v",
		"libx264",
		"-crf",
		"0",
		"-pix_fmt",
		"yuv420p",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	const req = {
		...request(bytes, "video"),
		sourceMediaId: randomUUID(),
		operation: { type: "reverse" as const, startSec: 0.5, durationSec: 11 },
	};
	const job = createProcessingJob(req),
		options = transport(bytes, req),
		put = options.put!;
	expect(createProcessingJob(req).id).toBe(job.id);
	expect(() =>
		createProcessingJob({ ...req, operation: { ...req.operation, durationSec: 10 } }),
	).toThrow("does not match");
	const source = join(directory, "numbered-source.mp4"),
		output = join(directory, "reversed-source.mp4");
	await Bun.write(source, bytes);
	options.put = async (input) => {
		if (input.kind === "video") await Bun.write(output, input.body);
		return put(input);
	};
	const result = await runProcessingJob(job.id, options);
	expect(result?.metadata.duration).toBeGreaterThan(11.9);
	expect(result?.derivative).toMatchObject({
		operation: req.operation,
		metadata: { kind: "video", hasAudio: true },
	});
	expect(result?.derivative?.metadata.duration).toBeCloseTo(11, 1);
	const pixel = (path: string, frame: number) =>
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-i",
			path,
			"-vf",
			`select=eq(n\\,${frame}),format=rgb24,crop=1:1:16:16`,
			"-frames:v",
			"1",
			"-f",
			"rawvideo",
			"pipe:1",
		])[0]!;
	for (const frame of [0, 299, 300, 329])
		expect(Math.abs(pixel(output, frame) - pixel(source, 344 - frame))).toBeLessThanOrEqual(3);
	const samples = execFileSync(
		"ffmpeg",
		["-v", "error", "-i", output, "-vn", "-ac", "1", "-ar", "48000", "-f", "f32le", "pipe:1"],
		{ maxBuffer: 4 * 1024 * 1024 },
	);
	const peak = (from: number, to: number) => {
		let value = 0;
		for (
			let sample = Math.floor(from * 48000);
			sample < Math.min(samples.length / 4, Math.floor(to * 48000));
			sample++
		)
			value = Math.max(value, Math.abs(samples.readFloatLE(sample * 4)));
		return value;
	};
	expect(peak(10.85, 10.95)).toBeGreaterThan(0.6);
	expect(peak(10.25, 10.35)).toBeGreaterThan(0.25);
	expect(peak(0.55, 0.65)).toBeLessThan(0.05);
	expect(ProcessingRequestSchema.safeParse({ ...req, kind: "image" }).success).toBe(false);
	expect(ProcessingRequestSchema.safeParse({ ...req, sourceMediaId: undefined }).success).toBe(
		false,
	);
});

test("reverse rejects bounds and stale/cancelled source completion without publishing ready output", async () => {
	for (const failure of ["bounds", "stale", "cancelled"] as const) {
		const req = {
			...request(video, "video"),
			sourceMediaId: randomUUID(),
			operation: {
				type: "reverse" as const,
				startSec: 0,
				durationSec: failure === "bounds" ? 2 : 0.5,
			},
		};
		const job = createProcessingJob(req),
			options = transport(video, req);
		let writes = 0;
		const fetchSource = options.fetch!,
			put = options.put!;
		options.fetch = async (input, init) =>
			failure === "stale" && init?.method === "HEAD"
				? new Response(null, { status: 404 })
				: fetchSource(input, init);
		options.put = async (input) => {
			writes++;
			const value = await put(input);
			if (failure === "cancelled") cancelProcessingJob(job.id);
			return value;
		};
		await expect(runProcessingJob(job.id, options)).rejects.toThrow();
		expect(getProcessingJob(job.id)).toMatchObject({
			status: failure === "cancelled" ? "cancelled" : "failed",
			result: null,
		});
		if (failure !== "cancelled") expect(writes).toBe(0);
	}
});

test("managed video/audio jobs publish verified retimed audio separately from immutable originals", async () => {
	for (const [kind, bytes] of [
		["video", video],
		["audio", audio],
	] as const)
		for (const playbackRate of [0.25, 0.5, 2, 4]) {
			const req: MediaProcessingRequest = {
				...request(bytes, kind),
				sourceMediaId: randomUUID(),
				operation: {
					type: "audio",
					startSec: 0.2,
					durationSec: 0.5,
					playbackRate,
					preservePitch: true,
					reverse: true,
				},
			};
			const job = createProcessingJob(req),
				options = transport(bytes, req);
			const result = await runProcessingJob(job.id, options);
			expect(result?.metadata).toMatchObject({ kind, byteSize: bytes.length });
			expect(result?.derivative).toMatchObject({
				operation: req.operation,
				metadata: { kind: "audio", hasAudio: true },
			});
			expect(Math.abs(result!.derivative!.metadata.duration! - 0.5 / playbackRate)).toBeLessThan(
				0.025,
			);
			expect(result?.playback.contentType).toBe("audio/mp4");
			expect(result?.playback.key).toStartWith("workspaces/proof/audio/project/");
			expect(result?.thumbnail).toBeUndefined();
			expect(
				await runProcessingJob(job.id, {
					...options,
					fetch: async () => {
						throw new Error("must not reprocess");
					},
				}),
			).toEqual(result);
		}
}, 30_000);
