import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

test("production preview plays and seeks complete local video with network blocked", async ({
	page,
	context,
}, info) => {
	const file = info.outputPath("offline.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc=size=160x96:rate=12",
			"-t",
			"5",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			file,
		],
		{ stdio: "pipe" },
	);
	await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
	let downloads = 0;
	const requests: Array<{ type: string; range: string | undefined }> = [];
	let blocked = false;
	await context.route("**/offline.mp4", (route) => {
		downloads++;
		requests.push({ type: route.request().resourceType(), range: route.request().headers().range });
		if (blocked) return route.abort();
		return route.fulfill({ path: file, contentType: "video/mp4" });
	});
	await page.addInitScript(() => {
		const original = globalThis.fetch;
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
						durationSec: 5,
						track: 0,
						video: {
							id: 900,
							kind: "video",
							start: 0,
							dur: 5,
							track: 0,
							url: location.origin + "/offline.mp4",
							sourceDurationSec: 5,
							volume: 0,
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
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await expect(page.locator(".tl2-timeline")).toBeVisible();
	const video = page.locator(".tl2-canvas video").first();
	await expect(video).toHaveAttribute("src", /^blob:/);
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.readyState))
		.toBeGreaterThanOrEqual(2);
	expect(requests.filter((request) => request.type === "fetch")).toHaveLength(1);
	const beforeOffline = downloads;
	blocked = true;
	await context.setOffline(true);
	const play = page.locator(".tl2-timeline [data-transport='play']");
	const head = page.locator("[data-vui-slot='playhead']");
	const before = await head.getAttribute("style");
	await play.click();
	await expect(play).toHaveAttribute("aria-label", "Pause");
	await expect.poll(() => head.getAttribute("style")).not.toBe(before);
	await expect
		.poll(() =>
			video.evaluate((el: HTMLVideoElement) => el.getVideoPlaybackQuality().totalVideoFrames),
		)
		.toBeGreaterThan(3);
	await play.click();
	const ruler = page.locator(".tl2-timeline [data-vui-slot='ruler']");
	const box = await ruler.boundingBox();
	if (!box) throw new Error("Timeline ruler missing");
	await ruler.click({ position: { x: box.width * 0.6, y: box.height / 2 } });
	await expect
		.poll(() => video.evaluate((el: HTMLVideoElement) => el.currentTime))
		.toBeGreaterThan(2);
	await play.click();
	const seekFrameCount = await video.evaluate(
		(el: HTMLVideoElement) => el.getVideoPlaybackQuality().totalVideoFrames,
	);
	await expect
		.poll(() =>
			video.evaluate((el: HTMLVideoElement) => el.getVideoPlaybackQuality().totalVideoFrames),
		)
		.toBeGreaterThan(seekFrameCount + 2);
	expect(downloads).toBe(beforeOffline);
	await play.click();
	await context.setOffline(false);
});
