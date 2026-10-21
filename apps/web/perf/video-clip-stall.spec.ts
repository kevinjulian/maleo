import { devices, expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");
let videoPath: string;
type AudioRecoveryState = typeof globalThis & { __freezeNextAudioResume?: boolean };

test.beforeAll(async ({ browserName }, testInfo) => {
	console.log(`STALL_BROWSER ${browserName}`);
	try {
		execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
	} catch {
		test.skip(true, "ffmpeg is required");
	}
	videoPath = testInfo.outputPath("stall-probe.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc=size=640x360:rate=30",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440",
			"-t",
			"5",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-movflags",
			"+faststart",
			videoPath,
		],
		{ stdio: "pipe" },
	);
});

test("Play unlocks shared audio tags during a trusted click", async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	const transport = page.locator(".tl2-timeline [data-transport='play']");
	await expect(transport).toBeEnabled();
	await page.evaluate(() => {
		const play = HTMLMediaElement.prototype.play;
		HTMLMediaElement.prototype.play = function () {
			if (this instanceof HTMLAudioElement && this.src.startsWith("data:audio/")) {
				this.dataset.unlockedByGesture = String(navigator.userActivation.isActive);
			}
			return play.call(this);
		};
	});
	await transport.click();
	await expect(transport).toHaveAttribute("aria-label", "Pause");
	await expect(page.locator('audio[data-unlocked-by-gesture="true"]')).toHaveCount(5);
	await transport.click();
	await expect(transport).toHaveAttribute("aria-label", "Play");
});

for (const variant of ["desktop", "phone", "recovery", "phone recovery", "audio recovery"]) {
	const phone = variant.includes("phone");
	const audioRecovery = variant === "audio recovery";
	const recovery = variant.includes("recovery") && !audioRecovery;
	test.describe(variant, () => {
		if (phone) {
			const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 15"];
			test.use({
				viewport: recovery ? { width: 320, height: 844 } : viewport,
				userAgent,
				deviceScaleFactor,
				isMobile,
				hasTouch,
			});
		}
		test(
			recovery || audioRecovery ? "preview stall recovery" : "video clip stall",
			async ({ page, context }, testInfo) => {
				await replayApi(context, HAR);
				if (audioRecovery)
					await page.addInitScript(() => {
						const audioProbe = globalThis as AudioRecoveryState;
						const resume = AudioContext.prototype.resume;
						const getTimestamp = AudioContext.prototype.getOutputTimestamp;
						let frozen: AudioTimestamp | null = null;
						AudioContext.prototype.getOutputTimestamp = function () {
							return frozen ?? getTimestamp.call(this);
						};
						AudioContext.prototype.resume = function () {
							if (audioProbe.__freezeNextAudioResume) {
								audioProbe.__freezeNextAudioResume = false;
								frozen = getTimestamp.call(this);
							} else frozen = null;
							return resume.call(this);
						};
					});
				const delayMs = Number(process.env.STALL_PROBE_DELAY_MS ?? (phone ? 1500 : 800));
				let releaseMedia = () => {};
				const mediaReady = new Promise<void>((resolve) => {
					releaseMedia = resolve;
				});
				await context.route("**/stall-probe.mp4*", async (route) => {
					console.log(`STALL_REQUEST ${JSON.stringify({ delayMs, url: route.request().url() })}`);
					if (recovery) await mediaReady;
					else await new Promise((resolve) => setTimeout(resolve, delayMs));
					await route.fulfill({ path: videoPath, contentType: "video/mp4" });
				});
				await page.addInitScript((secondClip) => {
					const realFetch = globalThis.fetch;
					globalThis.fetch = Object.assign(
						async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
							const response = await realFetch(input, init);
							const url =
								typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
							if (!/\/api\/operations\/projects\/[^/?]+(\?|$)/.test(url)) return response;
							const detail = await response
								.clone()
								.json()
								.catch(() => null);
							const clips = detail?.storyboards?.[0]?.storyboard_json?.clips;
							if (!Array.isArray(clips)) return response;
							clips.push({
								id: "video:900",
								type: "video",
								startSec: 3,
								durationSec: 3,
								track: 0,
								video: {
									id: 900,
									kind: "video",
									start: 3,
									dur: 3,
									track: 0,
									url: location.origin + "/stall-probe.mp4",
									sourceDurationSec: 5,
									volume: 1,
								},
							});
							if (secondClip)
								clips.push({
									id: "video:901",
									type: "video",
									startSec: 6.5,
									durationSec: 3,
									track: 0,
									video: {
										id: 901,
										kind: "video",
										start: 6.5,
										dur: 3,
										track: 0,
										url: location.origin + "/stall-probe.mp4?clip=901",
										sourceDurationSec: 5,
										volume: 1,
									},
								});
							return new Response(JSON.stringify(detail), {
								status: response.status,
								headers: { "content-type": "application/json" },
							});
						},
						realFetch,
					);
				}, phone);
				await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
				await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
				await page.waitForTimeout(1500);
				if (audioRecovery) {
					const transport = page.locator(".tl2-timeline [data-transport='play']");
					const head = page.locator("[data-vui-slot='playhead']");
					await transport.click();
					await page.waitForTimeout(700);
					await transport.click();
					await expect(transport).toHaveAttribute("aria-label", "Play");
					await page.evaluate(() => {
						(globalThis as AudioRecoveryState).__freezeNextAudioResume = true;
					});
					await transport.click();
					const frozen = await head.getAttribute("style");
					await page.waitForTimeout(700);
					expect(await head.getAttribute("style")).toBe(frozen);
					await expect.poll(() => head.getAttribute("style"), { timeout: 4000 }).not.toBe(frozen);
					await expect(transport).toHaveAttribute("aria-label", "Pause");
					await expect(
						page.getByRole("status").filter({ hasText: "Preview cannot play this clip" }),
					).toHaveCount(0);
					console.log("RECOVERY audio clock advanced after automatic restart");
					return;
				}
				if (recovery) {
					const labels = await page.evaluate(async () => {
						const transport = document.querySelector<HTMLButtonElement>(
							".tl2-timeline [data-transport='play']",
						)!;
						const events: string[] = [];
						const observer = new MutationObserver(() => {
							events.push(transport.getAttribute("aria-label") ?? "");
						});
						observer.observe(transport, { attributes: true, attributeFilter: ["aria-label"] });
						transport.click();
						await new Promise((resolve) => setTimeout(resolve, 9000));
						observer.disconnect();
						return events;
					});
					console.log(`RECOVERY ${JSON.stringify({ variant, labels })}`);
					expect(labels.filter((label) => label === "Pause")).toHaveLength(3);
					expect(labels.filter((label) => label === "Play")).toHaveLength(3);
					const notice = page
						.getByRole("status")
						.filter({ hasText: "Preview cannot play this clip" });
					await expect(notice).toBeVisible();
					const noticeBox = (await notice.boundingBox())!;
					const canvasBox = (await page.locator(".tl2-canvas").boundingBox())!;
					expect(noticeBox.y + noticeBox.height).toBeLessThanOrEqual(canvasBox.y);
					await page.screenshot({ path: testInfo.outputPath("preview-stalled.png") });
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					).toBe(true);
					releaseMedia();
					const transport = page.locator(".tl2-timeline [data-transport='play']");
					if (phone) await transport.click();
					else {
						await transport.focus();
						await page.keyboard.press("Space");
					}
					await expect(notice).toHaveCount(0);
					const playhead = page.locator("[data-vui-slot='playhead']");
					const initial = await playhead.getAttribute("style");
					await expect.poll(() => playhead.getAttribute("style")).not.toBe(initial);
					return;
				}
				const result = await page.evaluate(
					async (sampleMs) => {
						const head = document.querySelector<HTMLElement>("[data-vui-slot='playhead']")!;
						const transport = document.querySelector<HTMLButtonElement>(
							".tl2-timeline [data-transport='play']",
						)!;
						const read = (): number => {
							const match = /translateX\(([-0-9.]+)px\)/.exec(head.style.transform);
							return match ? Number(match[1]) : 0;
						};
						let lastPx = read();
						let changedAt = performance.now();
						let worstMs = 0;
						let atPx = lastPx;
						let moved = false;
						const decodedFrames: Record<string, number> = {};
						let running = true;
						const tick = (): void => {
							if (!running) return;
							const now = performance.now();
							const px = read();
							if (transport.getAttribute("aria-label") !== "Pause") {
								changedAt = now;
								lastPx = px;
								requestAnimationFrame(tick);
								return;
							}
							for (const video of document.querySelectorAll<HTMLVideoElement>("video")) {
								if (video.src.includes("stall-probe.mp4")) {
									const id = new URL(video.src).searchParams.get("clip") ?? "900";
									decodedFrames[id] = Math.max(
										decodedFrames[id] ?? 0,
										video.getVideoPlaybackQuality().totalVideoFrames,
									);
								}
							}
							const interval = now - changedAt;
							if (interval > worstMs) {
								worstMs = interval;
								atPx = lastPx;
							}
							if (px !== lastPx) {
								moved = true;
								lastPx = px;
								changedAt = now;
							}
							requestAnimationFrame(tick);
						};
						transport.click();
						requestAnimationFrame(tick);
						await new Promise((resolve) => setTimeout(resolve, sampleMs));
						running = false;
						const label = transport.getAttribute("aria-label");
						transport.click();
						return { worstMs: Math.round(worstMs), atPx, transport: label, moved, decodedFrames };
					},
					phone ? 11000 : 7000,
				);
				console.log(`STALL ${JSON.stringify(result)}`);
				expect(result.moved).toBe(true);
				expect(result.decodedFrames["900"]).toBeGreaterThan(1);
				if (phone) expect(result.decodedFrames["901"]).toBeGreaterThan(1);
				expect(result.worstMs).toBeLessThanOrEqual(250);
			},
		);
	});
}
