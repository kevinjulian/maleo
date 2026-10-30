import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import type { PreviewState } from "../src/models/timeline/preview-protocol.ts";

declare global {
	interface Window {
		readinessGateProbe: { resumes: number; states: PreviewState[]; fetches: string[] };
	}
}

for (const compare of [false, true]) {
	test(`all placed sources gate ${compare ? "Rust compare" : "normal"} playback independently`, async ({
		playwright,
	}, info) => {
		test.setTimeout(120_000);
		const fixtures = info.outputPath("sources");
		execFileSync(
			"bun",
			[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
			{ stdio: "pipe" },
		);
		const browser = await playwright.chromium.launch({
			args: [
				"--enable-unsafe-webgpu",
				...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
			],
		});
		const releases = new Map<string, () => void>();
		const held = new Map(
			["image", "late", "audio", "muted", "hidden"].map((name) => [
				name,
				new Promise<void>((resolve) => releases.set(name, resolve)),
			]),
		);
		try {
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width: 1440, height: 900 },
			});
			await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
			let repaired = false;
			const downloads: Record<string, number> = {};
			await context.route("**/readiness-acceptance-*", async (route) => {
				const name = new URL(route.request().url()).pathname
					.split("readiness-acceptance-")[1]!
					.split(".")[0]!;
				if (route.request().resourceType() === "fetch")
					downloads[name] = (downloads[name] ?? 0) + 1;
				await held.get(name);
				if (name === "unused" || (name === "hidden" && !repaired)) {
					await route.fulfill({ status: 503, body: "Synthetic unavailable source" });
					return;
				}
				await route.fulfill({
					path:
						name === "image"
							? join(import.meta.dirname, "../static/maleo-favicon-32.png")
							: join(
									fixtures,
									["audio", "muted"].includes(name) ? "impulses-48000.wav" : "vfr-silent.mp4",
								),
					contentType:
						name === "image"
							? "image/png"
							: ["audio", "muted"].includes(name)
								? "audio/wav"
								: "video/mp4",
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
				const probe: Window["readinessGateProbe"] = { resumes: 0, states: [], fetches: [] };
				window.readinessGateProbe = probe;
				const resume = AudioContext.prototype.resume;
				AudioContext.prototype.resume = function () {
					probe.resumes++;
					return resume.call(this);
				};
				const NativeWorker = Worker;
				globalThis.Worker = class extends NativeWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options);
						if (String(url).includes("/renderer/preview-worker.js"))
							this.addEventListener("message", (event) => {
								if (event.data.type === "state") probe.states.push(event.data.state);
							});
					}
				};
				const original = fetch;
				globalThis.fetch = Object.assign(
					async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
						const response = await original(input, init);
						const url =
							typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
						if (url.includes("readiness-acceptance-")) probe.fetches.push(url);
						if (!/\/api\/operations\/projects\/[^/?]+(\?|$)/.test(url)) return response;
						const detail = await response
							.clone()
							.json()
							.catch(() => null);
						if (!Array.isArray(detail?.storyboards?.[0]?.storyboard_json?.clips)) return response;
						const media = (name: string, extension: string) =>
							`${location.origin}/readiness-acceptance-${name}.${extension}`;
						const visual = (
							id: number,
							kind: string,
							start: number,
							duration: number,
							track: number,
							url: string,
						) => ({
							id: `video:${id}`,
							type: kind,
							startSec: start,
							durationSec: duration,
							track,
							video: {
								id,
								kind,
								start,
								dur: duration,
								track,
								url,
								sourceDurationSec: 2,
								volume: 0,
							},
						});
						const audio = (id: number, start: number, volume: number) => ({
							id: `audio:${id}`,
							type: "audio",
							startSec: start,
							durationSec: 2,
							track: 2,
							audio: {
								id,
								kind: "voiceover",
								content: "Synthetic impulses",
								start,
								dur: 2,
								track: 2,
								originalDur: 2,
								volume,
								url: media(volume === 0 ? "muted" : "audio", "wav"),
							},
						});
						const doc = detail.storyboards[0].storyboard_json;
						doc.clips = [
							visual(900, "image", 0, 3, 0, media("image", "png")),
							visual(901, "video", 3, 2, 0, media("late", "mp4")),
							visual(902, "video", 6, 2, 1, media("hidden", "mp4")),
							audio(903, 6, 0),
							audio(904, 0, 1),
						];
						doc.markers = [];
						doc.trackFlags = {
							0: { group: "visual" },
							1: { group: "visual", hidden: true },
							2: { group: "audio" },
						};
						detail.mediaAssets = [
							{
								id: "unused-image",
								label: "Unused unavailable image",
								kind: "image",
								source: "stock",
								url: media("unused", "png"),
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
			await page.goto(`/content/${FIXTURE_PROJECT_ID}${compare ? "?renderer=compare" : ""}`);
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			const play = page.getByRole("button", { name: "Play", exact: true });
			const timecode = page.locator('[data-transport="timecode"]').first();
			const initial = await timecode.textContent(),
				started = Date.now();
			// A ready clip shows no preview badge; queued, loading and failed clips do.
			const ready = (id: string) =>
				page.locator(`[data-clipid="${id}"] .tl2-clip-upload[data-preview-state]`);
			const blocked = async () => {
				await expect(play).toBeDisabled();
				await page.keyboard.press("Space");
				await page.keyboard.press("k");
				await expect(timecode).toHaveText(initial!);
				expect(
					await page
						.locator(".tl2-remotion-stage audio")
						.evaluateAll((elements) =>
							elements.some(
								(element) =>
									element instanceof HTMLMediaElement &&
									element.src.startsWith("blob:") &&
									!element.paused &&
									!element.muted &&
									element.volume > 0,
							),
						),
				).toBe(false);
			};
			await blocked();
			releases.get("image")!();
			await expect(ready("video:900")).toHaveCount(0);
			await blocked();
			releases.get("late")!();
			await expect(ready("video:901")).toHaveCount(0);
			await blocked();
			releases.get("audio")!();
			await expect(ready("audio:904")).toHaveCount(0);
			await blocked();
			releases.get("muted")!();
			await expect(ready("audio:903")).toHaveCount(0);
			await blocked();
			releases.get("hidden")!();
			const hidden = page.locator('[data-clipid="video:902"]');
			await expect(hidden).toHaveClass(/hidden/);
			await expect(page.locator('[data-clipid="video:901"]')).not.toHaveClass(/hidden/);
			await expect(hidden.getByRole("img", { name: /Preview failed:/ })).toBeVisible();
			await blocked();
			const resumesBeforePlay = await page.evaluate(() => window.readinessGateProbe.resumes);
			expect(resumesBeforePlay).toBe(0);
			await hidden.click({ button: "right" });
			repaired = true;
			await page.getByRole("menuitem", { name: "Retry preview", exact: true }).click();
			await expect(ready("video:902")).toHaveCount(0);
			await expect(play).toBeEnabled();
			const readinessWaitMs = Date.now() - started;
			if (compare) {
				const choice = page.getByRole("combobox", { name: "Compare audio output" });
				await choice.click();
				await page.getByRole("option", { name: "Rust audio", exact: true }).click();
			}
			const paused = await timecode.textContent();
			await page.waitForTimeout(350);
			await expect(timecode).toHaveText(paused!);
			const beforeOffline = { ...downloads };
			await context.setOffline(true);
			await page.getByRole("button", { name: "Jump to start", exact: true }).click();
			await play.click();
			await expect.poll(() => timecode.textContent()).not.toBe(initial);
			if (compare) {
				await expect
					.poll(() => page.evaluate(() => window.readinessGateProbe.states.at(-1)?.clockOwner))
					.toBe("audio");
				await expect
					.poll(() => page.evaluate(() => window.readinessGateProbe.states.at(-1)?.position), {
						timeout: 15_000,
					})
					.toBeGreaterThan(3.3)
					.catch(async (error: unknown) => {
						writeFileSync(
							info.outputPath("compare-failure.json"),
							JSON.stringify(
								{ probe: await page.evaluate(() => window.readinessGateProbe), errors },
								null,
								2,
							),
						);
						await page.screenshot({ path: info.outputPath("compare-failure.png") });
						throw error;
					});
			} else {
				await expect
					.poll(
						() =>
							page
								.locator(".tl2-remotion-stage video")
								.evaluateAll((videos) =>
									videos.some(
										(video) =>
											video instanceof HTMLVideoElement &&
											video.src.startsWith("blob:") &&
											video.currentTime > 0.3 &&
											video.getVideoPlaybackQuality().totalVideoFrames > 3,
									),
								),
						{ timeout: 15_000 },
					)
					.toBe(true);
			}
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			const ruler = page.locator('[data-vui-slot="ruler"]').first();
			const rulerBox = await ruler.boundingBox();
			const clipBox = await page.locator('[data-clipid="video:901"]').boundingBox();
			if (!rulerBox || !clipBox) throw new Error("Timeline seek geometry is unavailable");
			await ruler.click({
				position: { x: clipBox.x + clipBox.width / 2 - rulerBox.x, y: rulerBox.height / 2 },
			});
			await expect(timecode).toContainText("00:04:");
			const afterSeek = await timecode.textContent();
			await play.click();
			await expect.poll(() => timecode.textContent()).not.toBe(afterSeek);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			expect(downloads).toEqual(beforeOffline);
			expect(downloads.unused ?? 0).toBe(0);
			for (const name of ["image", "late"])
				expect(downloads[name], JSON.stringify(downloads)).toBe(1);
			expect(downloads.audio).toBe(2);
			expect(downloads.muted).toBe(2);
			expect(await page.evaluate(() => [...window.readinessGateProbe.fetches].sort())).toEqual([
				"http://127.0.0.1:3031/readiness-acceptance-audio.wav",
				"http://127.0.0.1:3031/readiness-acceptance-muted.wav",
			]);
			expect(downloads.hidden).toBe(2);
			expect(writes.some((body) => /blob:|data:image/.test(body))).toBe(false);
			expect(errors).toEqual([]);
			writeFileSync(
				info.outputPath(`readiness-${compare ? "compare" : "normal"}.json`),
				JSON.stringify(
					{
						readinessWaitMs,
						resumesBeforePlay,
						downloads,
						finalState: await page.evaluate(() => window.readinessGateProbe.states.at(-1) ?? null),
						errors,
					},
					null,
					2,
				),
			);
		} finally {
			for (const release of releases.values()) release();
			await browser.close();
		}
	});
}
