import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { writeFileSync } from "node:fs";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

for (const width of [1440, 320]) {
	test(`clip preview state and shared-source Retry preserve editing at ${width}px`, async ({
		browser,
	}, info) => {
		test.setTimeout(90_000);
		const fixtures = info.outputPath("sources");
		execFileSync(
			"bun",
			[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
			{ stdio: "pipe" },
		);
		const context = await browser.newContext({
			viewport: { width, height: 900 },
			reducedMotion: "reduce",
			hasTouch: width === 320,
			isMobile: width === 320,
		});
		let finishHeld = () => {};
		try {
			await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
			let repaired = false;
			const downloads: string[] = [];
			const held = new Promise<void>((resolve) => {
				finishHeld = resolve;
			});
			await context.route("**/clip-readiness-*.png", async (route) => {
				const name = new URL(route.request().url()).pathname;
				if (route.request().resourceType() === "fetch") downloads.push(name);
				if (name.endsWith("held.png")) await held;
				if (name.endsWith("shared.png") && !repaired)
					return route.fulfill({ status: 503, body: "Synthetic source unavailable" });
				return route.fulfill({
					path: join(import.meta.dirname, "../static/maleo-favicon-32.png"),
					contentType: "image/png",
				});
			});
			await context.route("**/clip-readiness-video.mp4", (route) =>
				route.fulfill({
					path: join(fixtures, "vfr-silent.mp4"),
					contentType: "video/mp4",
				}),
			);
			await context.route("**/clip-readiness-audio.wav", (route) =>
				route.fulfill({
					path: join(fixtures, "impulses-48000.wav"),
					contentType: "audio/wav",
				}),
			);
			const page = await context.newPage(),
				writes: string[] = [],
				errors: string[] = [];
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
						const doc = detail.storyboards[0].storyboard_json;
						const shared = location.origin + "/clip-readiness-shared.png";
						doc.clips = [
							{
								id: "scene:900",
								type: "image",
								startSec: 0,
								durationSec: 2,
								track: 0,
								markerId: 900,
								scene: {
									id: 900,
									name: "Shared source scene",
									start: 0,
									dur: 2,
									src: shared,
									endSrc: location.origin + "/clip-readiness-ready.png",
									img: true,
								},
							},
							{
								id: "video:901",
								type: "image",
								startSec: 3,
								durationSec: 0.1,
								track: 0,
								video: { id: 901, kind: "image", start: 3, dur: 0.1, track: 0, url: shared },
							},
							{
								id: "video:902",
								type: "video",
								startSec: 0,
								durationSec: 2,
								track: 1,
								video: {
									id: 902,
									kind: "video",
									start: 0,
									dur: 2,
									track: 1,
									url: location.origin + "/clip-readiness-video.mp4",
									sourceDurationSec: 2,
									volume: 0,
								},
							},
							{
								id: "audio:903",
								type: "audio",
								startSec: 0,
								durationSec: 2,
								track: 2,
								audio: {
									id: 903,
									kind: "voiceover",
									content: "Muted impulses",
									start: 0,
									dur: 2,
									track: 2,
									originalDur: 2,
									volume: 0,
									url: location.origin + "/clip-readiness-audio.wav",
								},
							},
							{
								id: "video:904",
								type: "image",
								startSec: 4,
								durationSec: 1,
								track: 0,
								video: {
									id: 904,
									kind: "image",
									start: 4,
									dur: 1,
									track: 0,
									url: location.origin + "/clip-readiness-ready.png",
								},
							},
						];
						doc.markers = [
							{
								id: 900,
								title: "Shared source scene",
								clipIds: ["scene:900"],
								startSec: 0,
								endSec: 2,
							},
						];
						doc.trackFlags = { 1: { hidden: true }, 2: { muted: true } };
						return new Response(JSON.stringify(detail), {
							status: response.status,
							headers: { "content-type": "application/json" },
						});
					},
					original,
				);
			});
			await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
			const clip = (id: string) => page.locator(`[data-clipid="${id}"]`).first();
			for (const id of ["scene:900", "video:901"])
				await expect(clip(id).getByRole("img", { name: /Preview failed:/ })).toBeVisible();
			for (const id of ["video:902", "audio:903", "video:904"])
				// Ready clips show no preview badge.
				await expect(clip(id).locator(".tl2-clip-upload[data-preview-state]")).toHaveCount(0);
			const geometry = await clip("video:901").getAttribute("style");
			// The readiness status lives in the toolbar row: the lanes must not move when it clears.
			const boxes = () =>
				Promise.all(
					[
						page.locator('[data-vui-slot="ruler"]').first(),
						page.locator(".tl2-lanes [data-vui-row^='lane-']").first(),
						clip("video:904"),
					].map((locator) => locator.boundingBox()),
				);
			const play = page.getByRole("button", { name: "Play", exact: true });
			const timecode = page.locator('[data-transport="timecode"]').first();
			const blockedTime = await timecode.textContent();
			await expect(play).toBeDisabled();
			await expect(play).toHaveAccessibleDescription(/Preview unavailable:.*HTTP 503/);
			await page.keyboard.press("Space");
			await page.keyboard.press("k");
			await expect(timecode).toHaveText(blockedTime!);
			await expect(page).toHaveScreenshot(`preview-readiness-${width}.png`);
			await expect(clip("video:902")).toHaveClass(/hidden/);
			const readyDownloads = downloads.filter((name) => name.endsWith("ready.png")).length;
			// URL-only fixture clips first receive durable media identities on load.
			await expect
				.poll(() =>
					writes.some((body) =>
						JSON.parse(body).commands?.some(
							({ command }: { command: { type: string; scope?: { mediaAssets?: unknown[] } } }) =>
								command.type === "scope.replace" && command.scope?.mediaAssets?.length === 4,
						),
					),
				)
				.toBe(true);
			const baselineWrites = writes.length;
			if (width === 320) {
				await clip("video:901").tap();
				await page.getByRole("button", { name: "Clip actions", exact: true }).tap();
			} else {
				await clip("video:901").click({ button: "right" });
			}
			await expect(page.getByText("Preview failed:").last()).toBeVisible();
			await page.screenshot({ path: info.outputPath(`clip-failure-${width}.png`) });
			await expect(page).toHaveScreenshot(`preview-clip-actions-${width}.png`);
			// Measured after the clip tap: at 320 px the tap scrolls the centred timeline.
			const blockedBoxes = await boxes();
			repaired = true;
			const retry = page.getByRole(width === 320 ? "button" : "menuitem", {
				name: "Retry preview",
				exact: true,
			});
			if (width === 320) await retry.tap();
			else await retry.press("Enter");
			for (const id of ["scene:900", "video:901", "video:902", "audio:903", "video:904"])
				// Ready clips show no preview badge.
				await expect(clip(id).locator(".tl2-clip-upload[data-preview-state]")).toHaveCount(0);
			expect(await clip("video:901").getAttribute("style")).toBe(geometry);
			const readyBoxes = await boxes();
			writeFileSync(
				info.outputPath(`readiness-geometry-${width}.json`),
				JSON.stringify({ ruler_lane_clip: { blocked: blockedBoxes, ready: readyBoxes } }, null, 2),
			);
			expect(blockedBoxes.every(Boolean)).toBe(true);
			expect(readyBoxes).toEqual(blockedBoxes);
			expect(downloads.filter((name) => name.endsWith("ready.png")).length).toBe(readyDownloads);
			expect(writes.length, JSON.stringify(writes)).toBe(baselineWrites);
			const readinessWrites = writes.length - baselineWrites;
			await expect(play).toBeEnabled();
			const description = await play.getAttribute("aria-describedby");
			expect(description).toBeNull();
			const chatInput = page.getByPlaceholder(/Describe a change/).first();
			if (width === 1440) {
				await chatInput.fill("check");
				await chatInput.press("Space");
				await chatInput.press("k");
				await expect(chatInput).toHaveValue("check k");
				await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
			}
			const pausedTime = await timecode.textContent();
			// A prior blocked command must not restart playback when Retry completes.
			await page.waitForTimeout(350);
			await expect(timecode).toHaveText(pausedTime!);
			await context.setOffline(true);
			await play.click();
			await expect.poll(() => timecode.textContent()).not.toBe(pausedTime);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			await context.setOffline(false);
			await play.click();
			const beforeIds = await page
				.locator('[data-clipid^="video:"]')
				.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-clipid")));
			const transfer = await page.evaluateHandle(() => {
				const data = new DataTransfer();
				data.setData("text/maleo-media-url", location.origin + "/clip-readiness-held.png");
				data.setData("text/maleo-media-kind", "image");
				data.setData("text/maleo-media-dur", "1");
				data.setData("text/maleo-media-label", "Held source");
				data.setData("text/maleo-media-source", "stock");
				return data;
			});
			const lane = page.locator('[data-vui-row="lane-0"]').first();
			const box = (await lane.boundingBox())!;
			await lane.dispatchEvent("drop", {
				dataTransfer: transfer,
				clientX: box.x + 20,
				clientY: box.y + box.height / 2,
			});
			let addedId: string | null = null;
			await expect
				.poll(async () => {
					const ids = await page
						.locator('[data-clipid^="video:"]')
						.evaluateAll((elements) =>
							elements.map((element) => element.getAttribute("data-clipid")),
						);
					addedId = ids.find((id) => !beforeIds.includes(id)) ?? null;
					return addedId;
				})
				.not.toBeNull();
			await expect(play).toBeDisabled();
			await expect(
				clip(addedId!).getByRole("img", { name: /Preview queued|Loading preview/ }),
			).toBeVisible();
			const loadingTime = await timecode.textContent();
			if (width === 320) {
				await page.getByRole("button", { name: "Clip actions", exact: true }).tap();
				await page.getByRole("button", { name: "Delete", exact: true }).last().tap();
			} else {
				await page.keyboard.press("Delete");
			}
			await expect(clip(addedId!)).toHaveCount(0);
			await expect(play).toBeEnabled();
			finishHeld();
			await page.waitForTimeout(350);
			await expect(timecode).toHaveText(loadingTime!);
			await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);
			expect(errors).toEqual([]);
			await expect.poll(() => writes.length).toBeGreaterThan(baselineWrites + readinessWrites);
			await page.screenshot({ path: info.outputPath(`clip-ready-${width}.png`) });
			writeFileSync(
				info.outputPath(`clip-readiness-${width}.json`),
				JSON.stringify(
					{
						downloads,
						geometry,
						readinessWrites,
						editingWrites: writes.length - baselineWrites - readinessWrites,
						errors,
					},
					null,
					2,
				),
			);
		} finally {
			finishHeld();
			await context.close();
		}
	});
}
