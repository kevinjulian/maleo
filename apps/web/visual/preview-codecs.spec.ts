import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PreviewMediaSource } from "@maleo/shared";

test.use({ browserName: process.env.MEDIA_CODEC_BROWSER === "webkit" ? "webkit" : "chromium" });
let fixtures: string;
test.beforeAll(async ({ browserName }, info) => {
	expect(["chromium", "webkit"]).toContain(browserName);
	fixtures = info.outputPath("codecs");
	execFileSync("bun", [
		resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"),
		fixtures,
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-i",
		join(fixtures, "cfr-av.mp4"),
		"-an",
		"-c:v",
		"ffv1",
		"-threads",
		"1",
		join(fixtures, "unsupported.mkv"),
	]);
	execFileSync("ffmpeg", [
		"-v",
		"error",
		"-y",
		"-i",
		join(fixtures, "cfr-av.mp4"),
		"-c:v",
		"ffv1",
		"-c:a",
		"aac",
		"-threads",
		"1",
		join(fixtures, "audio-only-unsupported-video.mkv"),
	]);
});

test("real local media passes track probes with bounded decoders and named failures", async ({
	page,
	context,
	browser,
	browserName,
}, info) => {
	const cases: Array<{ name: string; kinds: PreviewMediaSource["kinds"]; valid: boolean }> = [
		{ name: "cfr-av.mp4", kinds: ["video"], valid: true },
		{ name: "vfr-silent.mp4", kinds: ["video"], valid: true },
		{ name: "nonzero-silent.mp4", kinds: ["video"], valid: true },
		{ name: "silent.webm", kinds: ["video"], valid: true },
		{ name: "impulses-44100.wav", kinds: ["audio"], valid: true },
		{ name: "impulses-48000.wav", kinds: ["audio"], valid: true },
		{ name: "unsupported.mkv", kinds: ["video"], valid: false },
		{ name: "audio-only-unsupported-video.mkv", kinds: ["audio"], valid: true },
		{ name: "malformed.bin", kinds: ["video"], valid: false },
		{ name: "image.png", kinds: ["image"], valid: true },
		{ name: "silent-as-audio.mp4", kinds: ["audio"], valid: false },
		{ name: "silent-as-both.mp4", kinds: ["audio", "video"], valid: false },
		{ name: "shared-av.mp4", kinds: ["audio", "video"], valid: true },
	];
	const files = new Map(
		cases.map((item) => [
			item.name,
			item.name === "malformed.bin"
				? Buffer.from([0, 1, 2, 3, 4])
				: readFileSync(
						item.name === "image.png"
							? join(import.meta.dirname, "../static/maleo-favicon-32.png")
							: join(
									fixtures,
									item.name.startsWith("silent-as-")
										? "nonzero-silent.mp4"
										: item.name === "shared-av.mp4"
											? "cfr-av.mp4"
											: item.name,
								),
					),
		]),
	);
	await context.route("**/codec-probe", (route) =>
		route.fulfill({
			body: "<!doctype html><title>Media codec probe</title>",
			contentType: "text/html",
		}),
	);
	await context.route("**/codec-fixtures/*", (route) =>
		route.fulfill({
			body: files.get(new URL(route.request().url()).pathname.split("/").at(-1)!)!,
			contentType: "application/octet-stream",
		}),
	);
	await context.route("**/preview-media-worker.js", async (route) => {
		const response = await route.fetch();
		const counters = `
globalThis.__probeCounts = { video: {active:0,max:0}, audio: {active:0,max:0} };
for (const [name, kind] of [["VideoDecoder","video"],["AudioDecoder","audio"]]) {
 const Native = globalThis[name];
 if (Native) globalThis[name] = class extends Native {
  constructor(init) { super(init); const count=globalThis.__probeCounts[kind]; count.active++; count.max=Math.max(count.max,count.active); }
  close() { if (!this.__probeClosed) {this.__probeClosed=true; globalThis.__probeCounts[kind].active--;} return super.close(); }
 };
}
const __probePost = globalThis.postMessage.bind(globalThis);
globalThis.postMessage = (message) => __probePost({...message, decoderCounts: structuredClone(globalThis.__probeCounts)});
`;
		await route.fulfill({ response, body: counters + (await response.text()) });
	});
	await page.goto("/codec-probe");
	const { results, cleanup } = await page.evaluate(async (cases) => {
		type Reply = {
			type: string;
			id: string;
			requestId?: number;
			message?: string;
			probe?: { container: string; codecs: string[]; videoTracks: number; audioTracks: number };
			decoderCounts: {
				video: { active: number; max: number };
				audio: { active: number; max: number };
			};
		};
		const worker = new Worker("/preview-media-worker.js");
		let memory = 0;
		function budget(message: {
			type: string;
			bytes?: number;
			reservation?: number;
			requestId?: number;
		}): boolean {
			if (message.type === "decoder-request") {
				worker.postMessage({
					type: "decoder-result",
					requestId: message.requestId,
					lease: message.requestId,
				});
				return true;
			}
			if (message.type === "decoder-release") return true;
			if (message.type === "reserve-memory") {
				const bytes = message.bytes ?? 0;
				const accepted = memory + bytes <= 64 * 1024 * 1024;
				if (accepted) memory += bytes;
				worker.postMessage({ type: "memory-result", reservation: message.reservation, accepted });
				return true;
			}
			if (message.type === "release-memory") {
				memory -= message.bytes ?? 0;
				return true;
			}
			return false;
		}
		try {
			const results = await new Promise<Reply[]>((resolve, reject) => {
				const replies = new Map<string, Reply>();
				worker.onerror = () => reject(new Error("Codec worker failed"));
				worker.onmessage = (event: MessageEvent<Reply>) => {
					if (budget(event.data)) return;
					if (event.data.type === "protocol-error") reject(new Error(event.data.message));
					if (!["complete", "failed"].includes(event.data.type)) return;
					replies.set(event.data.id, event.data);
					if (replies.size === cases.length)
						resolve(
							[...replies.values()].map(({ type, id, message, probe, decoderCounts }) => ({
								type,
								id,
								message,
								probe,
								decoderCounts,
							})),
						);
				};
				for (const [i, item] of cases.entries())
					worker.postMessage({
						type: "load",
						source: {
							id: item.name,
							revision: "1",
							kinds: item.kinds,
							requestId: i + 1,
							target: {
								url: location.origin + "/codec-fixtures/" + item.name,
								credentials: "omit",
							},
						},
					});
			});
			const cleanup = await new Promise<string | null>((resolve) => {
				worker.onmessage = (event: MessageEvent<{ type: string; message?: string }>) => {
					if (budget(event.data)) return;
					return event.data.type === "disposed"
						? resolve(null)
						: resolve(event.data.message ?? "Unknown cleanup failure");
				};
				worker.postMessage({ type: "dispose" });
			});
			return { results, cleanup };
		} finally {
			worker.terminate();
		}
	}, cases);
	const matrix = {
		browser: browserName,
		version: browser.version(),
		results,
		cleanup,
		hashes: Object.fromEntries(
			[...files].map(([name, bytes]) => [name, createHash("sha256").update(bytes).digest("hex")]),
		),
	};
	console.log(`CODEC_MATRIX ${JSON.stringify(matrix)}`);
	writeFileSync(info.outputPath("codec-matrix.json"), JSON.stringify(matrix, null, 2));
	await info.attach("codec-matrix.json", {
		body: JSON.stringify(matrix, null, 2),
		contentType: "application/json",
	});
	expect(cleanup).toBeNull();
	for (const item of cases) {
		const result = results.find((result) => result.id === item.name)!;
		if (item.valid && browserName === "chromium") expect(result.type, item.name).toBe("complete");
		if (!item.valid) expect(result.type, item.name).toBe("failed");
		if (result.type === "failed")
			expect(result.message).toMatch(/unsupported|malformed|no audio track|cannot be decoded/i);
		expect(result.decoderCounts.video.max).toBeLessThanOrEqual(1);
		expect(result.decoderCounts.audio.max).toBeLessThanOrEqual(1);
		expect(result.decoderCounts.video.active).toBe(0);
		expect(result.decoderCounts.audio.active).toBe(0);
	}
});
