import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`reverse source cancel, undo and reload at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			const phone = width !== 1440;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: width === 320 ? 740 : width === 844 ? 390 : 900 },
				hasTouch: phone,
				isMobile: phone,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, HAR);
				const bytes = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=32x32:r=30:d=8",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-movflags",
					"frag_keyframe+empty_moov",
					"-f",
					"mp4",
					"pipe:1",
				]);
				const sourceId = "11111111-1111-4111-8111-111111111111",
					derivativeId = "22222222-2222-4222-8222-222222222222",
					jobId = "33333333-3333-4333-8333-333333333333";
				const url = `/api/media/${sourceId}`,
					output = `/api/media/${derivativeId}`;
				await context.route("**/api/media/*", (route) =>
					route.fulfill({ body: bytes, contentType: "video/mp4" }),
				);
				const first = editorChatProjectDetail.storyboards[0]!;
				let saved = {
					...first.storyboard_json,
					...toTimelineDoc(
						[
							{
								id: 1,
								name: "Base",
								shot: "Wide",
								move: "Static",
								vis: "",
								vo: "",
								img: true,
								dur: 8,
								src: "",
							},
						],
						[
							{
								id: 98,
								kind: "video",
								url,
								mediaAssetId: "original",
								label: "Camera",
								start: 0,
								dur: 2,
								mediaStartSec: 1,
								track: 0,
								volume: 0.5,
							},
						],
					),
				};
				const asset = {
					id: "original",
					kind: "video",
					url,
					source: "upload",
					label: "Camera",
					dur: 8,
				};
				let library: unknown[] = [asset];
				await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
					stored: () => saved,
					onSave: (next) => {
						saved = next as typeof saved;
					},
					media: () => library as never,
					onMedia: (next) => {
						library = next;
					},
				});
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
					(route) =>
						route.fulfill({
							json: {
								...editorChatProjectDetail,
								mediaAssets: library,
								storyboards: [{ ...first, storyboard_json: saved }],
							},
						}),
				);
				let ready = false,
					cancelled = 0,
					submitted = 0;
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/media/processing`),
					async (route) => {
						if (route.request().method() === "POST") {
							const request = route.request().postDataJSON();
							expect(request).toMatchObject({
								sourceMediaId: sourceId,
								sourceRevision: sourceId,
								operation: { type: "reverse", startSec: 1, durationSec: 2 },
							});
							submitted++;
							await route.fulfill({ status: 202, json: { id: jobId } });
							return;
						}
						if (route.request().method() === "DELETE") {
							cancelled++;
							await route.fulfill({ json: { ok: true } });
							return;
						}
						await route.fulfill({
							json: {
								id: jobId,
								status: ready ? "ready" : "processing",
								sourceMediaId: sourceId,
								sourceRevision: sourceId,
								operation: { type: "reverse", startSec: 1, durationSec: 2 },
								error: null,
								...(ready
									? {
											url: output,
											metadata: {
												originalFilename: "Reverse.mp4",
												byteSize: bytes.length,
												kind: "video",
												duration: 2,
											},
										}
									: {}),
							},
						});
					},
				);
				const page = await context.newPage();
				const open = async () => {
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await page.locator('[data-clipid="video:98"]').click();
					if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Timing"]').tap();
					else
						await page
							.locator(".tl2-clippanel")
							.getByRole("button", { name: "Timing", exact: true })
							.click();
					const playback = page.getByRole("button", { name: /^Playback/ });
					if ((await playback.getAttribute("aria-expanded")) !== "true") await playback.click();
				};
				const clip = () => saved.clips.find((clip) => clip.id === "video:98")?.video;
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await open();
				const control = page.getByRole("button", { name: "Reverse", exact: true });
				await control.click();
				await expect(
					page.getByRole("button", { name: "Cancel reverse", exact: true }),
				).toBeVisible();
				await expect(control).toBeDisabled();
				expect(clip()?.layout?.reverse).not.toBe(true);
				if (!phone) {
					await page.getByRole("button", { name: "Export Video", exact: true }).click();
					await expect(
						page.getByText("Camera: source processing is still pending", { exact: false }),
					).toBeVisible();
					await expect(page.getByRole("menuitem", { name: /Server render/ })).toBeDisabled();
					await expect(page.getByRole("menuitem", { name: /Fast render/ })).toBeDisabled();
					await page.getByRole("button", { name: "Export Video", exact: true }).click();
				}
				await page.getByRole("button", { name: "Cancel reverse", exact: true }).click();
				await expect.poll(() => cancelled).toBe(1);
				await expect(control).toBeEnabled();
				ready = true;
				if (phone) await control.tap();
				else {
					await control.focus();
					await control.press("Enter");
				}
				await expect(control).toHaveAttribute("aria-pressed", "true");
				await expect.poll(() => clip()?.layout?.reverseMedia?.url).toBe(output);
				expect(clip()?.url).toBe(url);
				expect(clip()?.mediaStartSec).toBe(1);
				expect(clip()?.dur).toBe(2);
				expect(clip()?.volume).toBe(0.5);
				if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => clip()?.layout?.reverse).not.toBe(true);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => clip()?.layout?.reverse).toBe(true);
				await page.reload();
				await open();
				await expect(control).toHaveAttribute("aria-pressed", "true");
				await control.click();
				await expect.poll(() => clip()?.layout?.reverse).toBe(false);
				await control.click();
				await expect.poll(() => clip()?.layout?.reverse).toBe(true);
				await page.screenshot({ path: testInfo.outputPath("reverse-ready.png") });
				expect(submitted).toBe(2); // Finished immutable derivative is reused.
			} finally {
				await context.close();
			}
		});
