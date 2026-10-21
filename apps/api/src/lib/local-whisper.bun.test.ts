import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	getLocalWhisperStatus,
	setupLocalWhisper,
	transcribeLocalWhisper,
} from "./local-whisper.ts";

test("API caption adapter uses execution-host status/setup/recognition and applies offsets after worker cache", async () => {
	const directory = await mkdtemp(join(tmpdir(), "caption-adapter-proof-"));
	const previous = {
		url: process.env.MALEO_GEN_WORKER_URL,
		token: process.env.MALEO_SERVICE_TOKEN,
	};
	const paths: string[] = [];
	const status = {
		ready: true,
		enabled: true,
		model: "base",
		version: "1.5.5",
		whisperDir: "/worker/runtime",
		cacheDir: "/worker/cache",
		mainInstalled: true,
		modelInstalled: true,
		ffmpegInstalled: true,
		cacheBytes: 123,
	};
	const server = Bun.serve({
		port: 0,
		async fetch(request) {
			expect(request.headers.get("authorization")).toBe("Bearer adapter-proof-only");
			paths.push(new URL(request.url).pathname);
			if (request.method === "GET" || request.url.endsWith("/setup")) return Response.json(status);
			const body = await request.formData();
			expect(body.get("options")).toBe(
				JSON.stringify({ language: "id", text: "Approved script", force: true }),
			);
			const audio = body.get("audio");
			expect(audio).toBeInstanceOf(File);
			if (!(audio instanceof File)) throw new Error("Expected bytes");
			expect([...new Uint8Array(await audio.arrayBuffer())]).toEqual([1, 2, 3]);
			return Response.json({
				cached: true,
				model: "base",
				detectedLanguage: "id",
				words: [{ text: "Approved", startSec: 0.1, endSec: 0.4 }],
			});
		},
	});
	try {
		process.env.MALEO_GEN_WORKER_URL = server.url.toString();
		process.env.MALEO_SERVICE_TOKEN = "adapter-proof-only";
		const input = join(directory, "speech.wav");
		await writeFile(input, new Uint8Array([1, 2, 3]));
		expect(await getLocalWhisperStatus()).toEqual(status);
		expect(await setupLocalWhisper()).toEqual(status);
		expect(
			await transcribeLocalWhisper({
				audioPath: input,
				language: "id",
				text: "Approved script",
				force: true,
				offsetSec: 100,
			}),
		).toMatchObject({
			cached: true,
			words: [{ text: "Approved", startSec: 100.1, endSec: 100.4 }],
		});
		expect(paths).toEqual(["/speech/status", "/speech/setup", "/speech"]);
	} finally {
		await server.stop(true);
		if (previous.url === undefined) delete process.env.MALEO_GEN_WORKER_URL;
		else process.env.MALEO_GEN_WORKER_URL = previous.url;
		if (previous.token === undefined) delete process.env.MALEO_SERVICE_TOKEN;
		else process.env.MALEO_SERVICE_TOKEN = previous.token;
		await rm(directory, { recursive: true, force: true });
	}
});

test("setup failure carries the worker's reason, not a generic message", async () => {
	const previous = {
		url: process.env.MALEO_GEN_WORKER_URL,
		token: process.env.MALEO_SERVICE_TOKEN,
	};
	const reason = "Whisper setup failed on media worker: Error while executing make . Exit code: 2";
	const server = Bun.serve({
		port: 0,
		fetch: () => Response.json({ error: reason }, { status: 503 }),
	});
	try {
		process.env.MALEO_GEN_WORKER_URL = server.url.toString();
		process.env.MALEO_SERVICE_TOKEN = "adapter-proof-only";
		await expect(setupLocalWhisper()).rejects.toThrow(reason);
	} finally {
		await server.stop(true);
		if (previous.url === undefined) delete process.env.MALEO_GEN_WORKER_URL;
		else process.env.MALEO_GEN_WORKER_URL = previous.url;
		if (previous.token === undefined) delete process.env.MALEO_SERVICE_TOKEN;
		else process.env.MALEO_SERVICE_TOKEN = previous.token;
	}
});
