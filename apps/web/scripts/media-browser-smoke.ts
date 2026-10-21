/** Optional real-browser check against a private test object-store bucket.
 * Run with MALEO_MEDIA_TEST_ENDPOINT and a web origin allowed by bucket CORS. */
import { chromium } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addressMedia, deleteMedia, putMedia } from "../../../packages/storage/src/storage.ts";

const endpoint = process.env.MALEO_MEDIA_TEST_ENDPOINT;
if (!endpoint) throw new Error("MALEO_MEDIA_TEST_ENDPOINT is required");
const origin = process.env.MALEO_MEDIA_TEST_ORIGIN ?? "http://127.0.0.1:3030";
Object.assign(process.env, {
	MALEO_MEDIA_STORAGE_BACKEND: "s3",
	MALEO_MEDIA_S3_BUCKET: process.env.MALEO_MEDIA_TEST_BUCKET ?? "maleo-test",
	MALEO_MEDIA_S3_ENDPOINT: endpoint,
	MALEO_MEDIA_S3_PUBLIC_ENDPOINT: endpoint,
	MALEO_MEDIA_S3_REGION: "us-east-1",
	MALEO_MEDIA_S3_ACCESS_KEY_ID: process.env.MALEO_MEDIA_TEST_ACCESS_KEY ?? "maleoapp",
	MALEO_MEDIA_S3_SECRET_ACCESS_KEY: process.env.MALEO_MEDIA_TEST_SECRET_KEY ?? "maleoappsecret",
});

const temp = await mkdtemp(join(tmpdir(), "maleo-media-browser-"));
const stored: string[] = [];
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
	const videoPath = join(temp, "seek.mp4");
	const ffmpeg = Bun.spawn(
		[
			"ffmpeg",
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=64x64:d=3",
			"-c:v",
			"libx264",
			"-movflags",
			"+faststart",
			"-y",
			videoPath,
		],
		{ stdout: "ignore", stderr: "pipe" },
	);
	if ((await ffmpeg.exited) !== 0)
		throw new Error(`ffmpeg failed: ${await new Response(ffmpeg.stderr).text()}`);
	const wav = new Uint8Array(44 + 3 * 8000);
	const view = new DataView(wav.buffer);
	for (const [offset, word] of [
		[0, "RIFF"],
		[8, "WAVE"],
		[12, "fmt "],
		[36, "data"],
	] as const) {
		for (let i = 0; i < word.length; i++) wav[offset + i] = word.charCodeAt(i);
	}
	view.setUint32(4, wav.length - 8, true);
	view.setUint32(16, 16, true);
	view.setUint16(20, 1, true);
	view.setUint16(22, 1, true);
	view.setUint32(24, 8000, true);
	view.setUint32(28, 8000, true);
	view.setUint16(32, 1, true);
	view.setUint16(34, 8, true);
	view.setUint32(40, wav.length - 44, true);
	wav.fill(128, 44);
	const png = await readFile(new URL("../visual/baselines/image-lab-1024.png", import.meta.url));
	const videoBytes = await readFile(videoPath);
	const media = await Promise.all([
		putMedia({ workspace: "browser-smoke", kind: "image", body: png, contentType: "image/png" }),
		putMedia({ workspace: "browser-smoke", kind: "audio", body: wav, contentType: "audio/wav" }),
		putMedia({
			workspace: "browser-smoke",
			kind: "video",
			body: videoBytes,
			contentType: "video/mp4",
		}),
	]);
	stored.push(...media.map((item) => item.key));
	browser = await chromium.launch();
	const page = await browser.newPage();
	const response = await page.goto(origin);
	if (!response?.ok()) throw new Error(`web origin unavailable: ${response?.status()}`);
	const [imageUrl, audioUrl, videoUrl] = [
		"/api/media/browser-image",
		"/api/media/browser-audio",
		"/api/media/browser-video",
	];
	for (const [url, object] of [
		[imageUrl, media[0]!],
		[audioUrl, media[1]!],
		[videoUrl, media[2]!],
	] as const) {
		await page.route(`${origin}${url}`, (route) =>
			route.fulfill({
				status: 302,
				headers: { location: addressMedia(object.key)!, "cache-control": "private, no-store" },
			}),
		);
	}
	const stockUrl = "https://stock.example.com/clip.mp4";
	const externalUrl = "https://external.example.com/clip.mp4";
	for (const url of [stockUrl, externalUrl])
		await page.route(url, (route) => {
			const range = /^bytes=(\d+)-(\d*)$/.exec(route.request().headers().range ?? "");
			const start = range ? Number(range[1]) : 0;
			const end = range?.[2]
				? Math.min(Number(range[2]), videoBytes.length - 1)
				: videoBytes.length - 1;
			return route.fulfill({
				status: range ? 206 : 200,
				body: videoBytes.subarray(start, end + 1),
				headers: {
					"content-type": "video/mp4",
					"accept-ranges": "bytes",
					"content-length": String(end - start + 1),
					...(range ? { "content-range": `bytes ${start}-${end}/${videoBytes.length}` } : {}),
				},
			});
		});
	const result = await page.evaluate(
		async ({ imageUrl, audioUrl, videoUrl, stockUrl, externalUrl }) => {
			const image = new Image();
			image.crossOrigin = "anonymous";
			image.src = imageUrl;
			await image.decode();
			const canvas = document.createElement("canvas");
			canvas.width = canvas.height = 1;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(image, 0, 0, 1, 1);
			ctx.getImageData(0, 0, 1, 1);
			const seek = async (tag: "audio" | "video", url: string) => {
				const element = document.createElement(tag);
				element.preload = "auto";
				element.src = url;
				await new Promise<void>((resolve, reject) => {
					element.onloadedmetadata = () => resolve();
					element.onerror = () => reject(new Error(`${tag} failed to load`));
				});
				element.currentTime = 1;
				await new Promise<void>((resolve, reject) => {
					element.onseeked = () => resolve();
					element.onerror = () => reject(new Error(`${tag} failed to seek`));
				});
				return element.currentTime;
			};
			const audioTime = await seek("audio", audioUrl);
			const videoTime = await seek("video", videoUrl);
			const stockTime = await seek("video", stockUrl);
			const externalTime = await seek("video", externalUrl);
			const range = await fetch(videoUrl, { headers: { Range: "bytes=0-7" } });
			const credentialedRange = await fetch(videoUrl, {
				credentials: "include",
				headers: { Range: "bytes=0-7" },
			});
			return {
				audioTime,
				videoTime,
				stockTime,
				externalTime,
				rangeStatus: range.status,
				rangeHeader: range.headers.get("content-range"),
				credentialedRangeStatus: credentialedRange.status,
			};
		},
		{ imageUrl, audioUrl, videoUrl, stockUrl, externalUrl },
	);
	if (
		result.audioTime < 0.9 ||
		result.videoTime < 0.9 ||
		result.stockTime < 0.9 ||
		result.externalTime < 0.9 ||
		result.rangeStatus !== 206 ||
		result.credentialedRangeStatus !== 206 ||
		!result.rangeHeader?.startsWith("bytes 0-7/")
	)
		throw new Error(`browser media check failed: ${JSON.stringify(result)}`);
	const expired = addressMedia(media[0]!.key, "GET", 1)!;
	await new Promise((resolve) => setTimeout(resolve, 1500));
	const expiry = await page.evaluate(
		async ({ expired, stable }) => [
			await fetch(expired).then((r) => r.status),
			await fetch(stable).then((r) => r.status),
		],
		{ expired, stable: imageUrl },
	);
	if (expiry[0] !== 403 || expiry[1] !== 200)
		throw new Error(`signature renewal failed: ${expiry}`);
	const lateSeek = await page.evaluate(async (url) => {
		const video = document.createElement("video");
		video.src = url;
		await new Promise<void>((resolve, reject) => {
			video.onloadedmetadata = () => resolve();
			video.onerror = () => reject(new Error("late video load failed"));
		});
		video.currentTime = 2;
		await new Promise<void>((resolve, reject) => {
			video.onseeked = () => resolve();
			video.onerror = () => reject(new Error("late video seek failed"));
		});
		return video.currentTime;
	}, videoUrl);
	if (lateSeek < 1.9) throw new Error(`late seek failed: ${lateSeek}`);
	console.log(
		"browser media: canvas, audio seek, video seek, unmanaged stock/external playback, range, expiry renewal passed",
	);
} finally {
	await browser?.close();
	await Promise.all(stored.map((key) => deleteMedia(key)));
	await rm(temp, { recursive: true, force: true });
}
