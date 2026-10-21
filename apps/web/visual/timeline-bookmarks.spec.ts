import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`independent bookmarks edit, navigate and reload ${width}px ${theme}`, async ({
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
				const first = editorChatProjectDetail.storyboards[0]!;
				const scenes = [1, 2].map((id) => ({
					id,
					name: `Scene ${id}`,
					shot: "Wide",
					move: "Static",
					vis: "",
					vo: "",
					img: false,
					dur: 4,
					src: "",
				}));
				let saved = {
					...first.storyboard_json,
					...toTimelineDoc(scenes),
					bookmarks: [] as Array<{ id: string; label: string; timeSec: number }>,
				};
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/storyboards(\\?|$)`),
					async (route) => {
						if (route.request().method() === "POST")
							saved = route.request().postDataJSON().storyboard_json;
						await route.fallback();
					},
				);
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
					(route) =>
						route.fulfill({
							json: {
								...editorChatProjectDetail,
								storyboards: [{ ...first, storyboard_json: saved }],
							},
						}),
				);
				const page = await context.newPage();
				const open = async () => {
					if (
						phone &&
						!(await page.getByRole("button", { name: "Bookmarks", exact: true }).isVisible())
					)
						await page.getByRole("button", { name: "More tools", exact: true }).click();
					await page.getByRole("button", { name: "Bookmarks", exact: true }).click();
				};
				const close = async () => {
					await page
						.getByRole("dialog", { name: "Bookmarks", exact: true })
						.getByRole("button", { name: "Close", exact: true })
						.click();
				};
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await open();
				await page.getByRole("button", { name: "Add at playhead", exact: true }).click();
				await page.getByLabel("Bookmark name", { exact: true }).fill("Review cut");
				await page.getByLabel("Time (seconds)", { exact: true }).fill("6.125");
				if (phone) await page.getByRole("button", { name: "Save bookmark", exact: true }).tap();
				else await page.getByLabel("Time (seconds)", { exact: true }).press("Enter");
				await expect
					.poll(() => saved.bookmarks[0])
					.toMatchObject({ label: "Review cut", timeSec: 6.125 });
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => saved.bookmarks[0]?.label).toBe("Bookmark 1");
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => saved.bookmarks[0]?.label).toBe("Review cut");
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const point = page.getByRole("button", { name: "Bookmark Review cut", exact: true });
				await point.scrollIntoViewIfNeeded();
				if (phone) await point.tap();
				else await point.click();
				await expect(page.getByRole("dialog", { name: "Bookmarks", exact: true })).toBeVisible();
				await expect(page.locator('[data-transport="timecode"]')).toContainText("00:06:13");
				await page
					.getByRole("dialog", { name: "Bookmarks", exact: true })
					.getByRole("button", { name: "Close", exact: true })
					.click();
				// Shorten scene content independently. Annotation retains exact authored time.
				saved = { ...saved, ...toTimelineDoc([scenes[0]!]) };
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await open();
				await expect(
					page.getByRole("button", { name: "Go to Review cut", exact: true }),
				).toBeDisabled();
				await expect(
					page.getByText("Review cut: outside shortened timeline. Time retained.", { exact: true }),
				).toBeVisible();
				expect(saved.bookmarks[0]?.timeSec).toBe(6.125);
				await page.getByRole("button", { name: "Edit Review cut", exact: true }).click();
				await page.getByLabel("Bookmark name", { exact: true }).fill("Review revised cut");
				await page.getByLabel("Time (seconds)", { exact: true }).fill("2");
				await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
				await expect
					.poll(() => saved.bookmarks[0])
					.toMatchObject({ label: "Review revised cut", timeSec: 2 });
				await page.getByRole("button", { name: "Go to Review revised cut", exact: true }).click();
				await expect(page.locator('[data-transport="timecode"]')).toContainText("00:02:00");
				await expect(page.locator('[data-transport="timecode"]')).toContainText("00:04:00");
				await open();
				await page.screenshot({ path: testInfo.outputPath("bookmarks.png") });
				await page.getByRole("button", { name: "Remove Review revised cut", exact: true }).click();
				await expect.poll(() => saved.bookmarks).toEqual([]);
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => saved.bookmarks[0]?.label).toBe("Review revised cut");
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => saved.bookmarks).toEqual([]);
				await open();
				await page.getByRole("button", { name: "Add at playhead", exact: true }).click();
				const longLabel =
					"Review this longer bookmark label for source pacing and narration timing";
				await page.getByLabel("Bookmark name", { exact: true }).fill(longLabel);
				await page.getByRole("button", { name: "Save bookmark", exact: true }).click();
				await expect.poll(() => saved.bookmarks[0]?.label).toBe(longLabel);
				const dialog = page.getByRole("dialog", { name: "Bookmarks", exact: true });
				const bounds = await dialog.boundingBox(),
					action = await page
						.getByRole("button", { name: `Go to ${longLabel}`, exact: true })
						.boundingBox();
				expect(action!.x + action!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width);
				await expect(
					page.getByRole("button", { name: `Remove ${longLabel}`, exact: true }),
				).toBeVisible();
				await page.screenshot({ path: testInfo.outputPath("bookmarks-long-label.png") });
			} finally {
				await context.close();
			}
		});
