// Run: bun apps/web/scripts/verify-renderer-motion.ts [corpus case] [output JSON]
// Synthetic 120-frame worker fixture; measures separately from UI transport checks.
// Synthetic worker-only input override. Remotion UI is not a parity oracle in this measurement.
import { chromium } from "@playwright/test";
import { replayApi } from "../visual/har.ts";
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type {
	PreviewEvent,
	PreviewRequest,
	PreviewState,
} from "../src/models/timeline/preview-protocol.ts";
interface Baseline {
	events: Array<PreviewState & { at: number }>;
	started: number;
	firstComplete: number | null;
	worker: Worker | null;
	nativePost: ((message: PreviewRequest) => void) | null;
}
declare global {
	interface Window {
		motionProbe: Baseline;
		normalRendererWorkerCreated?: boolean;
	}
}
const root = new URL("../../../", import.meta.url).pathname;
const caseName = process.argv[2] ?? "motion-combined-absolute";
const outputPath = process.argv[3] ?? "/tmp/maleo-motion-browser.json";
const fixture = `${root}/crates/renderer/corpus/${caseName}`;
const payload = JSON.parse(readFileSync(`${fixture}/storyboard.json`, "utf8"));

const media = readdirSync(`${fixture}/media`).map((file) => ({
	file,
	url: `data:image/${file.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(`${fixture}/media/${file}`).toString("base64")}`,
}));
const images = media.map((m) => m.url);
const json = media.reduce(
	(s, m) => s.replaceAll(`media/${m.file}`, m.url),
	JSON.stringify(payload),
);
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await replayApi(context, `${root}/apps/web/visual/fixtures/api.har`);
	const page = await context.newPage();
	await page.addInitScript(
		({ json, images }) => {
			const g = window;
			g.motionProbe = {
				events: [],
				started: 0,
				firstComplete: null,
				worker: null,
				nativePost: null,
			};
			const NativeWorker = window.Worker;
			window.Worker = class extends NativeWorker {
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options);
					if (!String(url).includes("preview-worker.js")) return;
					g.motionProbe.worker = this;
					g.motionProbe.nativePost = (message) =>
						NativeWorker.prototype.postMessage.call(this, message);
					g.motionProbe.started = performance.now();
					this.addEventListener("message", (event: MessageEvent<PreviewEvent>) => {
						const state = event.data.state;
						if (
							state?.times?.count &&
							!state.coverage?.length &&
							g.motionProbe.firstComplete === null
						)
							g.motionProbe.firstComplete = performance.now() - g.motionProbe.started;
						g.motionProbe.events.push({ at: performance.now(), ...state });
					});
				}
				postMessage(
					message: PreviewRequest,
					transfer: Transferable[] | StructuredSerializeOptions = [],
				) {
					if (message.type === "storyboard")
						message = {
							...message,
							json,
							fps: 30,
							durationFrames: 120,
							images,
						};
					if (message.type === "resize") message = { ...message, width: 1080, height: 1920 };
					return Array.isArray(transfer)
						? super.postMessage(message, transfer)
						: super.postMessage(message, transfer);
				}
			};
		},
		{ json, images },
	);
	const requests: string[] = [];
	page.on("request", (r) => {
		if (new URL(r.url()).pathname.startsWith("/renderer/"))
			requests.push(new URL(r.url()).pathname);
	});
	await page.goto(
		"http://127.0.0.1:3031/content/00000000-0000-4000-8000-000000000001?renderer=compare",
	);
	await page.locator(".tl2-timeline").waitFor({ timeout: 60000 });
	await page.waitForFunction(
		() =>
			window.motionProbe.firstComplete !== null ||
			window.motionProbe.events.some((e) => e.status === "failed"),
		undefined,
		{ timeout: 60000 },
	);
	console.log(
		"initial",
		JSON.stringify(
			await page.evaluate(() => {
				const b = window.motionProbe;
				return { startupMs: b.firstComplete, last: b.events.at(-1) };
			}),
		),
	);
	const transport = page.locator("[data-transport=play]").first();
	await transport.click();
	await page.waitForFunction(() => window.motionProbe.events.at(-1)?.status === "playing");
	await page.waitForTimeout(500);
	await transport.click();
	await page.waitForFunction(() => window.motionProbe.events.at(-1)?.status === "paused");
	await page.waitForTimeout(1000);
	const result = await page.evaluate(async () => {
		const b = window.motionProbe;
		const worker = b.worker;
		if (!worker || b.firstComplete === null) throw new Error("No complete motionProbe frame");
		const last = () => {
			const state = b.events.at(-1);
			if (!state?.times) throw new Error("No completed frame timing");
			return { ...state, times: state.times };
		};
		const waitFrame = async (frame: number, count: number) => {
			const start = performance.now();
			while (
				!b.events.some(
					(e) => e.frame === frame && (e.times?.count ?? 0) > count && e.coverage?.length === 0,
				)
			) {
				const failed = b.events.find((e) => e.status === "failed" || e.error);
				if (failed) throw new Error(JSON.stringify(failed));
				if (performance.now() - start > 15000)
					throw new Error(`frame ${frame} timed out: ${JSON.stringify(b.events.at(-1))}`);
				await new Promise((r) => setTimeout(r, 10));
			}
		};
		const hash = async () => {
			const source = document.querySelector<HTMLCanvasElement>(".tl2-rust-compare-canvas");
			if (!source) throw new Error("compare canvas absent");
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			const canvas = document.createElement("canvas");
			canvas.width = 1080;
			canvas.height = 1920;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(source, 0, 0);
			const bytes = ctx.getImageData(0, 0, 1080, 1920).data;
			const digest = await crypto.subtle.digest("SHA-256", bytes);
			const key = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
			bytesByHash[key] = bytes;
			return key;
		};
		const hashes: Record<number, string> = {};
		const bytesByHash: Record<string, Uint8ClampedArray> = {};
		const samples: number[] = [];
		for (let frame = 1; frame < 120; frame++) {
			const count = last().times.count;
			worker.postMessage({ type: "seek", frame });
			await waitFrame(frame, count);
			if (frame >= 10) samples.push(last().times.last);
			if ([8, 33, 51, 57, 90, 119].includes(frame)) hashes[frame] = await hash();
		}
		for (const frame of [33, 119, 51, 90, 8, 57]) {
			const count = last().times.count;
			worker.postMessage({ type: "seek", frame });
			await waitFrame(frame, count);
			const repeated = await hash();
			if (repeated !== hashes[frame]) {
				const a = bytesByHash[hashes[frame]],
					c = bytesByHash[repeated];
				let count = 0,
					max = 0;
				for (let i = 0; i < a.length; i++) {
					if (a[i] !== c[i]) count++;
					max = Math.max(max, Math.abs(a[i] - c[i]));
				}
				throw new Error(`canvas hash changed at ${frame}: channels ${count}, max ${max}`);
			}
		}
		const playbackStart = b.events.length;
		const playbackCount = last().times.count;
		const droppedBeforePlayback = last().dropped;
		worker.postMessage({
			type: "play",
			position: 0,
			at: (performance.timeOrigin + performance.now()) / 1000,
			rate: 1,
		});
		await new Promise((r) => setTimeout(r, 4200));
		worker.postMessage({ type: "pause", position: 3.9 });
		await new Promise((r) => setTimeout(r, 100));
		const sorted = [...samples].sort((a, b) => a - b);
		const completed = new Set<number>();
		const playback = b.events
			.slice(playbackStart)
			.filter((e) => {
				const count = e.times?.count ?? 0;
				if (e.status !== "playing" || count <= playbackCount || completed.has(count)) return false;
				completed.add(count);
				return true;
			})
			.flatMap((e) => (e.times ? [e.times.last] : []))
			.sort((a: number, b: number) => a - b);
		// SAFETY: WebGPU is optional in this DOM lib; the adapter is checked below.
		const gpu = (
			navigator as Navigator & {
				gpu?: {
					requestAdapter(): Promise<{
						info: { vendor: string; architecture: string; isFallbackAdapter: boolean };
					} | null>;
				};
			}
		).gpu;
		const adapter = await gpu?.requestAdapter();
		if (!adapter || adapter.info.isFallbackAdapter) throw new Error("Hardware adapter required");
		return {
			browser: navigator.userAgent,
			canvasHashes: hashes,
			adapter: {
				vendor: adapter.info.vendor,
				architecture: adapter.info.architecture,
				isFallbackAdapter: adapter.info.isFallbackAdapter,
			},
			startupMs: b.firstComplete,
			playback: {
				dropped: last().dropped - droppedBeforePlayback,
				samples: playback.length,
				p50Ms: playback[Math.ceil(playback.length * 0.5) - 1],
				p95Ms: playback[Math.ceil(playback.length * 0.95) - 1],
			},
			samples: samples.length,
			p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
			p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
			minMs: sorted[0],
			maxMs: sorted.at(-1),
			seeks: [33, 119, 51, 90, 8, 57],
			final: last(),
			frameSamplesMs: samples,
		};
	});
	const beforeSeek = await page.evaluate(() => window.motionProbe.events.at(-1)?.times?.count ?? 0);
	await page.evaluate(() => window.motionProbe.worker!.postMessage({ type: "seek", frame: 33 }));
	await page.waitForFunction((count) => {
		const state = window.motionProbe.events.at(-1);
		return state?.frame === 33 && (state.times?.count ?? 0) > count && !state.coverage.length;
	}, beforeSeek);
	const canvasHash = () =>
		page.evaluate(async () => {
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			const source = document.querySelector<HTMLCanvasElement>(".tl2-rust-compare-canvas");
			if (!source) throw new Error("Compare canvas absent");
			const canvas = document.createElement("canvas");
			canvas.width = 1080;
			canvas.height = 1920;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(source, 0, 0);
			const digest = await crypto.subtle.digest("SHA-256", ctx.getImageData(0, 0, 1080, 1920).data);
			return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
		});
	const beforeHash = await canvasHash();
	const previewWorker = page.workers().find((w) => w.url().includes("preview-worker.js"));
	if (!previewWorker) throw new Error("Preview worker absent");
	const lossStart = await page.evaluate(() => ({
		index: window.motionProbe.events.length,
		count: window.motionProbe.events.at(-1)?.times?.count ?? 0,
	}));
	await previewWorker.evaluate(() => {
		// SAFETY: the worker exposes loseDevice; it is checked before use. This probe owns the counter.
		const scope = globalThis as typeof globalThis & {
			loseDevice?: () => void;
			motionImageFetches?: number;
		};
		if (!scope.loseDevice) throw new Error("Device loss hook absent");
		scope.motionImageFetches = 0;
		const native = fetch;
		globalThis.fetch = new Proxy(native, {
			apply(target, _receiver, args: Parameters<typeof fetch>) {
				const input = args[0];
				if (typeof input === "string" && input.startsWith("data:image/"))
					scope.motionImageFetches!++;
				return target(...args);
			},
		});
		scope.loseDevice();
	});
	await page.waitForFunction(
		(start) => {
			const events = window.motionProbe.events.slice(start.index);
			const last = events.at(-1);
			return (
				events.some((e) => e.status === "device-lost") &&
				last?.frame === 33 &&
				last.status !== "device-lost" &&
				!last.coverage.length &&
				(last.times?.count ?? 0) > start.count
			);
		},
		lossStart,
		{ timeout: 60000 },
	);
	const afterHash = await canvasHash();
	if (beforeHash !== afterHash) throw new Error("Treated frame changed after GPU recovery");
	const imageFetches = await previewWorker.evaluate(() => {
		// SAFETY: this probe created the counter on this worker before device loss.
		return (globalThis as typeof globalThis & { motionImageFetches?: number }).motionImageFetches;
	});
	if (imageFetches !== 0) throw new Error("Recovery fetched images again");
	const timingProbe: number[][] = [];
	for (const [fps, frame, durationFrames] of [
		[24, 12, 96],
		[60, 30, 240],
	]) {
		const count = await page.evaluate(() => window.motionProbe.events.at(-1)?.times?.count ?? 0);
		await page.evaluate(
			({ fps, frame, durationFrames }) => {
				const send = window.motionProbe.nativePost;
				if (!send) throw new Error("Native worker sender absent");
				const json = JSON.stringify({
					scenes: [{ image: "", durationSec: 2, movement: "Static", transition: "cut" }],
					bgColor: "#ffffff",
					accentColor: "#ff0000",
					fgColor: "#ffffff",
					pacingDevices: { progressBar: true },
					effects: [{ effect: "fade_in", startSec: 0, durationSec: 1 }],
				});
				send({ type: "storyboard", json, fps, durationFrames, images: [] });
				send({ type: "resize", width: 100, height: 100 });
				send({ type: "seek", frame });
			},
			{ fps: fps!, frame: frame!, durationFrames: durationFrames! },
		);
		await page.waitForFunction(
			({ count, frame }) => {
				const state = window.motionProbe.events.at(-1);
				return (
					state?.frame === frame && (state.times?.count ?? 0) > count && !state.coverage.length
				);
			},
			{ count, frame },
		);
		const pixels = await page.evaluate(async () => {
			await new Promise(requestAnimationFrame);
			await new Promise(requestAnimationFrame);
			const source = document.querySelector<HTMLCanvasElement>(".tl2-rust-compare-canvas");
			if (!source) throw new Error("Timing canvas absent");
			const canvas = document.createElement("canvas");
			canvas.width = 100;
			canvas.height = 100;
			const ctx = canvas.getContext("2d")!;
			ctx.drawImage(source, 0, 0);
			return [
				{ x: 5, y: 2 },
				{ x: 20, y: 2 },
				{ x: 50, y: 50 },
			].flatMap(({ x, y }) => [...ctx.getImageData(x, y, 1, 1).data]);
		});
		if (
			pixels.slice(0, 4).join() !== "255,0,0,255" ||
			pixels.slice(4, 8).join() === "255,0,0,255" ||
			Math.abs(pixels[8]! - 128) > 1
		)
			throw new Error(`Session timing pixels disagree with native: ${pixels}`);
		timingProbe.push(pixels);
	}
	if (timingProbe[0]!.join() !== timingProbe[1]!.join())
		throw new Error("Different session frame rates changed equal-time output");
	const normalRequests: string[] = [];
	const normal = await context.newPage();
	await normal.addInitScript(() => {
		window.normalRendererWorkerCreated = false;
		const Native = Worker;
		window.Worker = class extends Native {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				if (String(url).includes("preview-worker.js")) window.normalRendererWorkerCreated = true;
			}
		};
	});
	normal.on("request", (r) => {
		if (new URL(r.url()).pathname.startsWith("/renderer/")) normalRequests.push(r.url());
	});
	await normal.goto("http://127.0.0.1:3031/content/00000000-0000-4000-8000-000000000001");
	await normal.locator(".tl2-timeline").waitFor({ timeout: 60000 });
	await normal.waitForTimeout(1000);
	if (normalRequests.length) throw new Error("Normal editor requested renderer assets");
	if (await normal.evaluate(() => window.normalRendererWorkerCreated !== false))
		throw new Error("Normal editor created a renderer worker");
	await normal.close();
	const output = {
		date: new Date().toISOString(),
		fixture: caseName,

		storyboardSha256: createHash("sha256").update(json).digest("hex"),
		width: 1080,
		height: 1920,
		fps: 30,
		durationFrames: 120,
		launch: { channel: "chrome", headless: false, customArgs: [] },
		requests,
		measurementContext: process.env.MALEO_VERIFY_CONTEXT ?? "unrecorded",
		uiTransport: "play and pause controls drove worker state",
		gpuRecovery: { frame: 33, beforeHash, afterHash, imageFetches },
		timingProbe: { rates: [24, 60], pixels: timingProbe },
		normalRequests,
		...result,
	};
	writeFileSync(outputPath, JSON.stringify(output, null, 2));
	console.log(JSON.stringify({ ...output, frameSamplesMs: undefined }, null, 2));
} finally {
	await browser.close();
}
