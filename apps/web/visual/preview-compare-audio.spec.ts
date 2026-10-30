import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import type { PreviewState } from "../src/models/timeline/preview-protocol.ts";

declare global {
	interface Window {
		compareSoundProbe: {
			contexts: AudioContext[];
			captured: Float32Array[];
			reports: PreviewState[];
		};
	}
}

async function report(page: Page) {
	return page.evaluate(() => ({
		contexts: window.compareSoundProbe.contexts.map((context) => context.state),
		peak: window.compareSoundProbe.captured.reduce(
			(peak, block) => Math.max(peak, ...block.map(Math.abs)),
			0,
		),
		preview: window.compareSoundProbe.reports.at(-1),
		reference: [...document.querySelectorAll<HTMLMediaElement>(".tl2-remotion-stage audio")].map(
			(element) => ({
				time: element.currentTime,
				audible: !element.paused && !element.muted && element.volume > 0,
			}),
		),
	}));
}

for (const width of [1440, 320]) {
	test(`production compare has one audio owner and disposes output at ${width}px`, async ({
		playwright,
	}, info) => {
		test.setTimeout(120_000);
		const fixtures = info.outputPath("sources");
		execFileSync(
			"bun",
			[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
			{ stdio: "pipe" },
		);
		execFileSync(
			"ffmpeg",
			[
				"-v",
				"error",
				"-y",
				"-f",
				"lavfi",
				"-i",
				"sine=frequency=440:sample_rate=48000:duration=8",
				"-c:a",
				"pcm_s16le",
				join(fixtures, "tone.wav"),
			],
			{ stdio: "pipe" },
		);
		const browser = await playwright.chromium.launch({
			args: [
				"--enable-unsafe-webgpu",
				...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
			],
		});
		try {
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
			});
			await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
			await context.route("**/compare-tone.wav", (route) =>
				route.fulfill({ path: join(fixtures, "tone.wav"), contentType: "audio/wav" }),
			);
			await context.route("**/compare-video.mp4", (route) =>
				route.fulfill({ path: join(fixtures, "vfr-silent.mp4"), contentType: "video/mp4" }),
			);
			await context.route("**/preview-audio-worklet.js", async (route) => {
				const response = await route.fetch();
				await route.fulfill({
					response,
					body:
						`const register=globalThis.registerProcessor.bind(globalThis);globalThis.registerProcessor=(name,Base)=>register(name,class extends Base{process(inputs,outputs,parameters){const active=super.process(inputs,outputs,parameters);this.port.postMessage({type:"capture",pcm:outputs[0][0].slice()});return active;}});` +
						(await response.text()),
				});
			});
			const page = await context.newPage(),
				errors: string[] = [],
				writes: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.on("request", (request) => {
				if (
					["POST", "PATCH"].includes(request.method()) &&
					/\/projects\/[^/]+\/(commands|storyboards|storyboard-presentation)$/.test(
						new URL(request.url()).pathname,
					)
				)
					writes.push(request.postData() ?? "");
			});
			await page.addInitScript(() => {
				const probe: Window["compareSoundProbe"] = { contexts: [], captured: [], reports: [] };
				window.compareSoundProbe = probe;
				const OriginalNode = AudioWorkletNode;
				globalThis.AudioWorkletNode = class extends OriginalNode {
					constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
						super(context, name, options);
						if (name !== "maleo-preview-audio") return;
						if (context instanceof AudioContext) probe.contexts.push(context);
						this.port.addEventListener("message", (event) => {
							if (event.data.type === "capture") {
								probe.captured.push(event.data.pcm);
								event.stopImmediatePropagation();
							}
						});
						this.port.start();
					}
				};
				const OriginalWorker = Worker;
				globalThis.Worker = class extends OriginalWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						if (String(url).includes("/renderer/preview-worker.js"))
							this.addEventListener("message", (event) => {
								if (event.data.type === "state") probe.reports.push(event.data.state);
							});
					}
				};
				const original = fetch;
				globalThis.fetch = Object.assign(
					async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
						const response = await original(input, init);
						const url =
							typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
						if (!/\/api\/operations\/projects\/[^/?]+(\?|$)/.test(url)) return response;
						const detail = await response
							.clone()
							.json()
							.catch(() => null);
						if (!Array.isArray(detail?.storyboards?.[0]?.storyboard_json?.clips)) return response;
						detail.storyboards[0].storyboard_json.clips = [
							{
								id: "video:900",
								type: "video",
								startSec: 0,
								durationSec: 2,
								track: 0,
								video: {
									id: 900,
									kind: "video",
									start: 0,
									dur: 2,
									track: 0,
									url: location.origin + "/compare-video.mp4",
									sourceDurationSec: 2,
									volume: 0,
								},
							},
							{
								id: "audio:901",
								type: "audio",
								startSec: 0,
								durationSec: 8,
								track: 1,
								audio: {
									id: 901,
									kind: "voiceover",
									content: "Synthetic tone",
									start: 0,
									dur: 8,
									originalDur: 8,
									volume: 0.5,
									url: location.origin + "/compare-tone.wav",
								},
							},
						];
						return new Response(JSON.stringify(detail), {
							status: response.status,
							headers: { "content-type": "application/json" },
						});
					},
					original,
				);
			});
			await page.goto(`/content/${FIXTURE_PROJECT_ID}?renderer=compare`);
			const panel = page.getByRole("region", { name: "Rust renderer", exact: true });
			const selection = panel.getByRole("combobox", { name: "Compare audio output" });
			await expect(selection).toContainText("Reference audio", { timeout: 60_000 });
			await expect(panel).not.toContainText("missing media", { timeout: 30_000 });
			await selection.click();
			await expect(page.getByRole("option", { name: "Rust audio", exact: true })).toBeEnabled();
			await page.keyboard.press("Escape");
			expect((await report(page)).contexts).toEqual([]);
			// This legacy fixture first admits its source identities through scope.replace.
			await expect.poll(() => writes.length).toBeGreaterThan(0);
			expect(
				JSON.parse(writes[0]!).commands.every(
					(entry: { command: { type: string } }) => entry.command.type === "scope.replace",
				),
			).toBe(true);
			const baselineWrites = writes.length;
			await context.setOffline(true);
			await page.getByRole("button", { name: "Play", exact: true }).click();
			await expect
				.poll(async () =>
					(await report(page)).reference.some((row) => row.audible && row.time > 0.1),
				)
				.toBe(true);
			await selection.focus();
			if (width === 1440) {
				await selection.press("ArrowDown");
				await page.getByRole("option", { name: "Rust audio", exact: true }).press("Enter");
			} else {
				await selection.tap();
				await page.getByRole("option", { name: "Rust audio", exact: true }).tap();
			}
			await expect(selection).toContainText("Rust audio");
			await expect
				.poll(async () => (await report(page)).preview?.clockOwner, { timeout: 20_000 })
				.toBe("audio");
			await expect.poll(async () => (await report(page)).peak).toBeGreaterThan(0.001);
			expect((await report(page)).reference.every((row) => !row.audible)).toBe(true);
			expect((await report(page)).contexts).toEqual(["running"]);
			await page.screenshot({ path: info.outputPath(`rust-audio-${width}.png`) });
			await selection.click();
			await page.getByRole("option", { name: "Reference audio", exact: true }).click();
			await expect
				.poll(async () => (await report(page)).contexts.every((state) => state === "closed"))
				.toBe(true);
			await expect
				.poll(async () => (await report(page)).reference.some((row) => row.audible))
				.toBe(true);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			await selection.click();
			await page.getByRole("option", { name: "Rust audio", exact: true }).click();
			expect((await report(page)).contexts).toEqual(["closed"]);
			await page.getByRole("button", { name: "Play", exact: true }).click();
			await expect.poll(async () => (await report(page)).contexts).toEqual(["closed", "running"]);
			const toggleMenu = page.getByRole("button", { name: "toggle menu", exact: true });
			if (await toggleMenu.isVisible()) await toggleMenu.click();
			await page.getByRole("button", { name: "Projects", exact: true }).first().click();
			await expect(panel).toHaveCount(0);
			await expect
				.poll(async () => (await report(page)).contexts.every((state) => state === "closed"))
				.toBe(true);
			expect(writes).toHaveLength(baselineWrites);
			expect(errors).toEqual([]);
			writeFileSync(
				info.outputPath(`compare-audio-${width}.json`),
				JSON.stringify(
					{
						report: await report(page),
						initialWrites: baselineWrites,
						ownershipWrites: writes.length - baselineWrites,
						errors,
					},
					null,
					"\t",
				) + "\n",
			);
		} finally {
			await browser.close();
		}
	});
}
