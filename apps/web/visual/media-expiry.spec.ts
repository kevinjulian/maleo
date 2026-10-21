import { expect, test } from "@playwright/test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";
test.use({ serviceWorkers: "block" });

test("timeline renews managed video after signature expiry and project reload", async ({
	page,
	context,
}) => {
	test.setTimeout(60_000);
	const temp = await mkdtemp(join(tmpdir(), "maleo-editor-media-"));
	let server: ReturnType<typeof createServer> | undefined;
	try {
		const videoPath = join(temp, "clip.mp4");
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=red:s=64x64:d=4",
			"-c:v",
			"libx264",
			"-movflags",
			"+faststart",
			"-y",
			videoPath,
		]);
		const bytes = await readFile(videoPath);
		const har = JSON.parse(await readFile(HAR, "utf8")) as {
			log: {
				entries: Array<{ request: { url: string }; response: { content: { text: string } } }>;
			};
		};
		const entry = har.log.entries.find((item) =>
			item.request.url.endsWith(`/api/operations/projects/${FIXTURE_PROJECT_ID}`),
		);
		if (!entry) throw new Error("project fixture missing");
		const detail = JSON.parse(entry.response.content.text) as {
			storyboards: Array<{ storyboard_json: { clips: unknown[] } }>;
		};
		detail.storyboards[0]!.storyboard_json.clips.unshift({
			id: "video:9",
			type: "video",
			startSec: 0,
			durationSec: 4,
			track: 0,
			video: { id: 9, url: `/api/media/${MEDIA_ID}`, kind: "video", start: 0, dur: 4 },
		});
		await replayApi(context, HAR);
		await context.route("**/api/operations/projects/*", (route) =>
			new URL(route.request().url()).pathname === `/api/operations/projects/${FIXTURE_PROJECT_ID}`
				? route.fulfill({ json: detail })
				: route.fallback(),
		);
		let signatures = 0;
		server = createServer((request, response) => {
			const url = new URL(request.url ?? "/", "http://127.0.0.1");
			const headers: Record<string, string> = {
				"access-control-allow-origin": "*",
				"access-control-expose-headers": "content-range, content-length, accept-ranges",
				"content-type": "video/mp4",
				"accept-ranges": "bytes",
			};
			if (Date.now() - Number(url.searchParams.get("issued")) > 1000) {
				response.writeHead(403, headers).end();
				return;
			}
			const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
			const start = range ? Number(range[1]) : 0;
			const end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
			response
				.writeHead(range ? 206 : 200, {
					...headers,
					"content-length": String(end - start + 1),
					...(range ? { "content-range": `bytes ${start}-${end}/${bytes.length}` } : {}),
				})
				.end(bytes.subarray(start, end + 1));
		});
		await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
		const mediaBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}/media`;
		let firstSigned = "";
		await context.route(`**/api/media/${MEDIA_ID}`, (route) => {
			const signed = `${mediaBase}?issued=${Date.now()}`;
			firstSigned ||= signed;
			signatures++;
			return route.fulfill({
				status: 302,
				headers: { location: signed, "cache-control": "private, no-store" },
			});
		});
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`, { waitUntil: "domcontentloaded" });
		await page.locator(".tl2-timeline").waitFor({ state: "visible" });
		await expect(page.locator(".tl2-remotion-stage video").first()).toBeVisible();
		await page.waitForTimeout(1500);
		expect((await fetch(firstSigned)).status).toBe(403);
		const firstSignatures = signatures;
		const before = await page.locator("[data-transport='timecode']").first().textContent();
		const ruler = (await page.locator(".tl2-ruler").boundingBox())!;
		await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + ruler.height / 2);
		await expect(page.locator("[data-transport='timecode']").first()).not.toHaveText(before ?? "");
		await page.reload();
		await page.locator(".tl2-timeline").waitFor({ state: "visible" });
		await expect(page.locator(".tl2-remotion-stage video").first()).toBeVisible();
		expect(signatures).toBeGreaterThan(firstSignatures);
	} finally {
		await new Promise<void>((resolve) => server?.close(() => resolve()) ?? resolve());
		await rm(temp, { recursive: true, force: true });
	}
});
