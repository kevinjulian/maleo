// Run: bun apps/web/scripts/measure-renderer-baseline.ts [output JSON]
// Synthetic worker-only input override. Remotion UI is not a parity oracle in this measurement.
import { chromium } from "@playwright/test";
import { replayApi } from "../visual/har.ts";
import { readFileSync, writeFileSync } from "node:fs";
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
}
declare global {
	interface Window {
		baseline: Baseline;
	}
}
const root = new URL("../../../", import.meta.url).pathname;
const fixture = `${root}/crates/renderer/corpus/image-scene-full`;
const json = readFileSync(`${fixture}/storyboard.json`, "utf8");
const image = `data:image/jpeg;base64,${readFileSync(`${fixture}/media/portrait.jpg`).toString("base64")}`;
const browser = await chromium.launch({ headless: false, channel: "chrome" });
try {
	const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
	await replayApi(context, `${root}/apps/web/visual/fixtures/api.har`);
	const page = await context.newPage();
	await page.addInitScript(
		({ json, image }) => {
			const g = window;
			g.baseline = { events: [], started: 0, firstComplete: null, worker: null };
			const NativeWorker = window.Worker;
			window.Worker = class extends NativeWorker {
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options);
					if (!String(url).includes("preview-worker.js")) return;
					g.baseline.worker = this;
					g.baseline.started = performance.now();
					this.addEventListener("message", (event: MessageEvent<PreviewEvent>) => {
						const state = event.data.state;
						if (state?.times?.count && !state.coverage?.length && g.baseline.firstComplete === null)
							g.baseline.firstComplete = performance.now() - g.baseline.started;
						g.baseline.events.push({ at: performance.now(), ...state });
					});
				}
				postMessage(
					message: PreviewRequest,
					transfer: Transferable[] | StructuredSerializeOptions = [],
				) {
					if (message.type === "storyboard")
						message = {
							...message,
							json: json.replaceAll("media/portrait.jpg", image),
							fps: 30,
							durationFrames: 120,
							images: [image],
						};
					if (message.type === "resize") message = { ...message, width: 1080, height: 1920 };
					return Array.isArray(transfer)
						? super.postMessage(message, transfer)
						: super.postMessage(message, transfer);
				}
			};
		},
		{ json, image },
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
			window.baseline.firstComplete !== null ||
			window.baseline.events.some((e) => e.status === "failed"),
		undefined,
		{ timeout: 60000 },
	);
	console.log(
		"initial",
		JSON.stringify(
			await page.evaluate(() => {
				const b = window.baseline;
				return { startupMs: b.firstComplete, last: b.events.at(-1) };
			}),
		),
	);
	await page.waitForTimeout(1000);
	const result = await page.evaluate(async () => {
		const b = window.baseline;
		const worker = b.worker;
		if (!worker || b.firstComplete === null) throw new Error("No complete baseline frame");
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
		const samples: number[] = [];
		for (let frame = 1; frame < 120; frame++) {
			const count = last().times.count;
			worker.postMessage({ type: "seek", frame });
			await waitFrame(frame, count);
			if (frame >= 10) samples.push(last().times.last);
		}
		for (const frame of [90, 10, 119, 0]) {
			const count = last().times.count;
			worker.postMessage({ type: "seek", frame });
			await waitFrame(frame, count);
		}
		const playbackStart = b.events.length;
		worker.postMessage({
			type: "play",
			position: 0,
			at: (performance.timeOrigin + performance.now()) / 1000,
			rate: 1,
		});
		await new Promise((r) => setTimeout(r, 4300));
		worker.postMessage({ type: "pause", position: 3.9 });
		await new Promise((r) => setTimeout(r, 100));
		const sorted = [...samples].sort((a, b) => a - b);
		const playback = b.events
			.slice(playbackStart)
			.filter((e) => e.status === "playing" && e.times?.count)
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
			adapter: {
				vendor: adapter.info.vendor,
				architecture: adapter.info.architecture,
				isFallbackAdapter: adapter.info.isFallbackAdapter,
			},
			startupMs: b.firstComplete,
			playback: {
				samples: playback.length,
				p50Ms: playback[Math.ceil(playback.length * 0.5) - 1],
				p95Ms: playback[Math.ceil(playback.length * 0.95) - 1],
			},
			samples: samples.length,
			p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
			p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
			minMs: sorted[0],
			maxMs: sorted.at(-1),
			seeks: [90, 10, 119, 0],
			final: last(),
			frameSamplesMs: samples,
		};
	});
	const output = {
		date: new Date().toISOString(),
		fixture: "image-scene-full",
		storyboardSha256: createHash("sha256").update(json).digest("hex"),
		width: 1080,
		height: 1920,
		fps: 30,
		durationFrames: 120,
		launch: { channel: "chrome", headless: false, customArgs: [] },
		requests,
		...result,
	};
	writeFileSync(
		process.argv[2] ?? "/tmp/maleo-renderer-baseline.json",
		JSON.stringify(output, null, 2),
	);
	console.log(JSON.stringify({ ...output, frameSamplesMs: undefined }, null, 2));
} finally {
	await browser.close();
}
