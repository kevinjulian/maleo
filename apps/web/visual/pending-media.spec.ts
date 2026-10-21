/* A file in use while it uploads (use-media-while-uploading 5.2): its asset card and
 * the clip that uses it report uploading with byte progress, then processing, then
 * resolve in place — at desktop and phone width, in both themes. Upload progress is
 * real: the browser's upload is throttled, so XHR reports partial bytes. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { DEFAULT_MEDIA_IMPORT_LIMITS } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
const PROJECT = `/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}`;

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`a dropped file reports upload, processing and ready on its card and clip at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(90_000);
			const phone = width === 320;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: phone ? 740 : 900 },
				hasTouch: phone,
				isMobile: phone,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, HAR);
				// Two seconds of noise, so the encoded file is big enough to watch upload.
				const video = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"testsrc2=s=640x360:r=30:d=2",
					"-c:v",
					"libx264",
					"-preset",
					"ultrafast",
					"-crf",
					"10",
					"-pix_fmt",
					"yuv420p",
					"-movflags",
					"frag_keyframe+empty_moov",
					"-f",
					"mp4",
					"pipe:1",
				]);
				const mediaId = randomUUID();
				let status: "processing" | "ready" = "processing";
				const job = { id: randomUUID(), filename: "camera.mp4" };
				const result = () => ({
					id: job.id,
					filename: job.filename,
					status,
					error: null,
					asset:
						status === "ready"
							? {
									id: job.id,
									label: job.filename,
									url: `/api/media/${mediaId}`,
									kind: "video",
									source: "upload",
									dur: 2,
									metadata: {
										originalFilename: job.filename,
										byteSize: video.length,
										kind: "video",
										width: 640,
										height: 360,
										duration: 2,
										hasAudio: false,
									},
									compatibility: {
										preview: { status: "supported" },
										render: { status: "supported" },
									},
									importedSource: {
										revision: randomUUID(),
										fingerprint: "a".repeat(64),
										originalMediaId: mediaId,
										playbackMediaId: mediaId,
									},
								}
							: null,
				});
				await context.route("**/api/media/*", (route) =>
					route.fulfill({ body: video, contentType: "video/mp4" }),
				);
				/* The upload goes to a real socket, so the browser's network throttle applies to
				 * it (a fulfilled route never reaches the network). */
				const upstream: Server = createServer((request, response) => {
					request.resume();
					request.on("end", () => {
						response.writeHead(202, { "content-type": "application/json" });
						response.end(JSON.stringify(result()));
					});
				});
				await new Promise<void>((done) => upstream.listen(0, "127.0.0.1", done));
				const port = (upstream.address() as { port: number }).port;
				await context.route(new RegExp(`${PROJECT}/media/import`), async (route) => {
					const request = route.request(),
						path = new URL(request.url()).pathname;
					if (path.endsWith("/readiness"))
						return route.fulfill({
							json: { available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS },
						});
					if (request.method() === "GET" && path.endsWith("/media/import"))
						return route.fulfill({ json: { items: [], nextCursor: null } });
					if (path.includes("/request/"))
						return route.fulfill({ status: 404, json: { error: "not_found" } });
					if (request.method() === "POST")
						return route.continue({ url: `http://127.0.0.1:${port}/upload` });
					return route.fulfill({ json: result() });
				});
				const page = await context.newPage();
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const assets = page
					.getByRole("navigation", { name: "Editor tools" })
					.getByRole("button", { name: "Assets", exact: true });
				await assets.click();
				await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();

				// Throttle the upload so the browser reports partial progress.
				const cdp = await context.newCDPSession(page);
				await cdp.send("Network.enable");
				await cdp.send("Network.emulateNetworkConditions", {
					offline: false,
					latency: 20,
					downloadThroughput: -1,
					uploadThroughput: Math.round(video.length / 4),
				});
				const transfer = await page.evaluateHandle(
					(bytes) => {
						const data = new DataTransfer();
						data.items.add(new File([new Uint8Array(bytes)], "camera.mp4", { type: "video/mp4" }));
						return data;
					},
					[...video],
				);
				const lane = page.locator('[data-vui-row="lane-1"]').first(),
					box = (await lane.boundingBox())!;
				const before = await page.locator("[data-clipid]").count();
				await lane.dispatchEvent("drop", {
					dataTransfer: transfer,
					clientX: box.x + 40,
					clientY: box.y + box.height / 2,
				});

				// The clip exists at once and says it is uploading, with byte progress.
				await expect(page.locator("[data-clipid]")).toHaveCount(before + 1);
				const badge = page.locator(".tl2-clip-upload").first();
				await expect(badge).toHaveAttribute("aria-label", /^Uploading \d+%$/);
				await page.screenshot({ path: testInfo.outputPath("uploading.png") });
				await cdp.send("Network.emulateNetworkConditions", {
					offline: false,
					latency: 0,
					downloadThroughput: -1,
					uploadThroughput: -1,
				});
				await expect(badge).toHaveAttribute("aria-label", "Processing");

				if (phone) {
					// A drop selects its clip, so the phone clip bar and its actions sheet carry the state too.
					await expect(page.locator(".tl2-clipbar .tl2-clip-upload")).toHaveAttribute(
						"aria-label",
						"Processing",
					);
					await page
						.getByRole("button", { name: "Clip actions", exact: true })
						.click({ timeout: 10_000 });
					await expect(page.locator(".tl2-clipactions-status")).toHaveText("Processing");
					await page.screenshot({ path: testInfo.outputPath("actions-sheet.png") });
					await page.locator('.tl2-clipbar [aria-label="Back"]').click({ timeout: 10_000 });
					await page.locator('.tl2-clipbar [aria-label="Close"]').click({ timeout: 10_000 });
				}

				// Its card in All Media says the same.
				await assets.click();
				const card = page.locator("[data-upload-state]").filter({ hasText: "camera.mp4" });
				await expect(card).toHaveAttribute("data-upload-state", "processing");
				await expect(card).toContainText("Processing");
				await page.screenshot({ path: testInfo.outputPath("processing-card.png") });
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();

				if (!phone) {
					// Export during the upload: the server render waits and names the file; the draft discloses the local copy.
					await page.getByRole("button", { name: "Export Video" }).click();
					const menu = page.getByRole("menu");
					await expect(menu).toContainText(
						"camera.mp4 is still uploading. Wait for it to finish before export.",
					);
					await expect(menu).toContainText(
						"Fast render uses this browser's copy of 1 file still uploading",
					);
					await expect(menu.getByRole("menuitem", { name: /Server render/ })).toBeDisabled();
					await expect(menu.getByRole("menuitem", { name: /Fast render/ })).toBeEnabled();
					await page.screenshot({ path: testInfo.outputPath("export-menu.png") });
					await page.keyboard.press("Escape");
					if (await menu.isVisible())
						await page.getByRole("button", { name: "Export Video" }).click();
					await expect(menu).toHaveCount(0);
				}

				// Ready: the badge goes, the clip stays where it was, and nothing was added to undo.
				const clip = page.locator('[data-clipid^="video:"]').last();
				const placed = await clip.boundingBox();
				status = "ready";
				await expect(page.locator(".tl2-clip-upload")).toHaveCount(0, { timeout: 15_000 });
				expect(await clip.boundingBox()).toEqual(placed);
				await assets.click();
				await expect(
					page.locator("[data-upload-state]").filter({ hasText: "camera.mp4" }),
				).toHaveCount(0);
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();
				if (!phone) {
					// Once ready, the server render is no longer refused for it.
					await page.getByRole("button", { name: "Export Video" }).click();
					await expect(page.getByRole("menu")).not.toContainText("still uploading");
					await page.getByRole("button", { name: "Export Video" }).click();
				}
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect(page.locator("[data-clipid]")).toHaveCount(before);
				upstream.close();
			} finally {
				await context.close();
			}
		});
