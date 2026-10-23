import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`animation inspector and transition cleanup at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(90_000);
			const phone = width < 1000;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: width === 844 ? 390 : phone ? 740 : 900 },
				hasTouch: phone,
				isMobile: phone,
				colorScheme: theme,
			});
			try {
				await replayApi(context, HAR);
				const first = editorChatProjectDetail.storyboards[0]!;
				const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="orange"/></svg>')}`;
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
								dur: 12,
								src: image,
							},
						],
						[
							{ id: 98, label: "A", kind: "image", url: image, start: 0, dur: 4, track: 0 },
							{ id: 99, label: "B", kind: "image", url: image, start: 4, dur: 4, track: 0 },
						],
					),
				};
				await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
					stored: () => saved,
					onSave: (next) => {
						saved = next as typeof saved;
					},
				});
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
				const page = await context.newPage(),
					errors: string[] = [];
				page.on("pageerror", (e) => errors.push(e.message));
				page.setDefaultTimeout(10_000);
				const layout = () => saved.clips.find((c) => c.id === "video:98")?.video?.layout;
				const transitions = () => saved.clips.filter((c) => c.transition);
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const clip = page.locator('[data-clipid="video:98"]');
				await clip.click();
				if (phone) {
					await page.locator('.tl2-clipbar-groups [aria-label="Animation"]').tap();
				} else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Animation", exact: true })
						.click();
				const inspector = page.getByRole("region", { name: "Animation settings", exact: true });
				const entrance = inspector.getByRole("region", { name: "Entrance", exact: true });
				const exit = inspector.getByRole("region", { name: "Exit", exact: true });
				await expect(exit).toHaveCount(1);
				await expect(page.getByRole("group", { name: "Animation edge", exact: true })).toHaveCount(
					0,
				);
				await expect(page.locator(".tl2-animation-edges, .tl2-animation-edge")).toHaveCount(0);
				await expect(entrance).toBeVisible();
				await expect(clip).toHaveAttribute("aria-selected", "true");
				expect(layout()?.animation).toBeUndefined();
				await expect(entrance.locator(".ui-insp-toggle")).toHaveAttribute("aria-expanded", "false");
				await expect(entrance.locator(".ui-insp-summary")).toHaveCount(0);
				await entrance.locator(".ui-insp-toggle").click();
				await entrance.getByRole("button", { name: "Fade", exact: true }).click();
				await expect(entrance.getByRole("button", { name: "Fade", exact: true })).toHaveAttribute(
					"aria-pressed",
					"true",
				);
				await expect.poll(() => layout()?.animation?.tracks.opacity?.length).toBe(2);
				const duration = entrance.getByRole("spinbutton", {
					name: "Entrance duration",
					exact: true,
				});
				await duration.fill("0.7");
				await duration.press("Tab");
				await expect.poll(() => layout()?.animation?.tracks.opacity?.[1]?.t).toBe(0.7);
				await entrance.getByRole("button", { name: "Replay in preview", exact: true }).click();
				await expect
					.poll(
						async () =>
							(await page.locator('[data-transport="timecode"]').first().textContent())?.split(
								" /",
							)[0],
					)
					.not.toBe("00:00:00");
				if (!phone) {
					const transport = page.locator('[data-transport="play"]').first();
					await expect(transport).toHaveAttribute("aria-label", "Play");
					await transport.click();
					await expect(page.locator('[data-transport="timecode"]').first()).toContainText("00:02:");
					await transport.click();
				}
				await expect(page.locator(".tl2-stage")).toBeVisible();
				await expect(page.getByRole("dialog", { name: /animation|transition/i })).toHaveCount(0);
				expect(await entrance.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
				await entrance.locator(".ui-insp-toggle").click();
				await expect(entrance.locator(".ui-insp-summary")).toHaveText("Fade");
				await entrance.locator(".ui-insp-toggle").click();
				await expect(entrance.locator(".ui-insp-summary")).toHaveCount(0);
				await expect(exit.locator(".ui-insp-toggle")).toHaveAttribute("aria-expanded", "false");
				await exit.locator(".ui-insp-toggle").click();
				await exit.getByRole("button", { name: "Fade", exact: true }).click();
				const exitDuration = exit.getByRole("spinbutton", { name: "Exit duration", exact: true });
				await exitDuration.fill("0.5");
				await exitDuration.press("Tab");
				await expect
					.poll(() => layout()?.animation?.tracks.opacity?.map((k) => k.t))
					.toEqual([0, 0.7, 3.5, 4]);
				expect(Number(await duration.inputValue())).toBe(0.7);
				await exit.getByRole("button", { name: "None", exact: true }).click();
				await expect
					.poll(() => layout()?.animation?.tracks.opacity?.map((k) => k.t))
					.toEqual([0, 0.7]);
				await entrance
					.getByRole("heading", { name: "Entrance", exact: true })
					.scrollIntoViewIfNeeded();
				await page.screenshot({ path: testInfo.outputPath("animation-inspector.png") });
				await entrance.getByRole("button", { name: "None", exact: true }).click();
				await expect.poll(() => layout()?.animation?.tracks.opacity?.length ?? 0).toBe(0);
				await entrance.getByRole("button", { name: "Fade", exact: true }).click();
				await expect.poll(() => layout()?.animation?.tracks.opacity?.[1]?.t).toBe(0.7);
				if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				const junction = page.getByRole("button", { name: "Transition · A → B", exact: true });
				await junction.click();
				const transition = page.getByRole("region", { name: "Transition settings", exact: true });
				expect(transitions()).toHaveLength(0);
				expect(await transition.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
				await transition.locator(".ui-insp-toggle").click();
				await transition.getByRole("button", { name: "Dissolve", exact: true }).click();
				await expect.poll(() => transitions().length).toBe(1);
				await transition.getByRole("button", { name: "None", exact: true }).click();
				await expect.poll(() => transitions().length).toBe(0);
				await transition.getByRole("button", { name: "Slide", exact: true }).click();
				await expect.poll(() => transitions()[0]?.transition?.type).toBe("slide");
				if (phone && (await page.locator('.tl2-clipbar [aria-label="Back"]').isVisible()))
					await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				const moving = page.locator('[data-clipid="video:99"]');
				await moving.click();
				const box = (await moving.boundingBox())!,
					x = box.x + Math.min(box.width / 2, 35),
					y = box.y + box.height / 2;
				const cdp = phone ? await context.newCDPSession(page) : null;
				const drag = async (cancel: boolean) => {
					if (cdp) {
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchStart",
							touchPoints: [{ x, y }],
						});
						await page.waitForTimeout(350);
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchMove",
							touchPoints: [{ x: x + 65, y }],
						});
					} else {
						await page.mouse.move(x, y);
						await page.mouse.down();
						await page.mouse.move(x + 65, y, { steps: 8 });
					}
					await expect(
						page.getByRole("status").filter({ hasText: "Transition will be removed on drop" }),
					).toBeVisible();
					expect(transitions()).toHaveLength(1);
					expect((await moving.boundingBox())!.y).toBeCloseTo(box.y, 0);
					if (cdp)
						await cdp.send("Input.dispatchTouchEvent", {
							type: cancel ? "touchCancel" : "touchEnd",
							touchPoints: [],
						});
					else {
						if (cancel) await page.keyboard.press("Escape");
						await page.mouse.up();
					}
				};
				await drag(true);
				await expect(junction).toBeVisible();
				expect(transitions()).toHaveLength(1);
				await drag(false);
				await expect.poll(() => transitions().length).toBe(0);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => transitions().length).toBe(1);
				await expect.poll(() => saved.clips.find((c) => c.id === "video:99")?.startSec).toBe(4);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => transitions().length).toBe(0);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => transitions().length).toBe(1);
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await expect(junction).toBeVisible();
				expect(layout()?.animation?.tracks.opacity?.[1]?.t).toBe(0.7);
				await page.locator('[data-clipid="video:98"]').click();
				if (phone) {
					await page.locator('.tl2-clipbar-groups [aria-label="Animation"]').tap();
				} else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Animation", exact: true })
						.click();
				await expect(
					inspector.getByRole("button", { name: /Custom keys|Custom keyframes/ }),
				).toHaveCount(0);
				await expect(entrance.locator(".ui-insp-summary")).toHaveText("Fade");
				expect(layout()?.animation?.tracks.opacity?.[1]?.t).toBe(0.7);
				expect(errors).toEqual([]);
			} finally {
				await context.close().catch(() => {});
			}
		});
