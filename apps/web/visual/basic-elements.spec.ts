import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`basic elements and text keys at ${width}px ${theme}`, async ({ browser }, testInfo) => {
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
				await context.route(/\/api\/operations\/clip-templates(\?|$)/, (route) =>
					route.fulfill({
						json: {
							items: [
								{
									id: "saved-static",
									kind: "text",
									label: "Saved rectangle",
									intent: "Static shape",
									category: "text",
									base: "shape-rect",
									config: {},
								},
							],
						},
					}),
				);
				const first = editorChatProjectDetail.storyboards[0]!;
				const oldKeys = {
					tracks: {
						xPct: [
							{ t: 0, v: 8 },
							{ t: 2, v: 30 },
						],
					},
				};
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
								src: "",
							},
						],
						[],
						[
							{
								id: 77,
								content: "Existing text",
								preset: "title",
								start: 0,
								dur: 3,
								track: 0,
								layout: {
									xPct: 8,
									yPct: 18,
									widthPct: 84,
									heightPct: 34,
									fit: "contain",
									animation: oldKeys,
								},
							},
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
				page.setDefaultTimeout(10_000);
				page.on("pageerror", (error) => errors.push(error.message));
				const textClips = () => saved.clips.filter((c) => c.text);
				const close = async () => {
					const back = page.locator('.tl2-clipbar [aria-label="Back"]');
					if (phone && (await back.count())) await back.click();
				};
				const openElements = async () => {
					await close();
					if (phone) {
						const deselect = page.locator('.tl2-clipbar [aria-label="Close"]');
						if (await deselect.count()) await deselect.click();
						if (
							!(await page
								.getByRole("tablist", { name: "Element category", exact: true })
								.isVisible())
						)
							await page
								.getByRole("navigation", { name: "Editor tools", exact: true })
								.getByRole("button", { name: "Elements", exact: true })
								.tap();
					} else await page.keyboard.press("Alt+Digit5");
				};
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await page.locator('[data-clipid="text:77"]').click();
				const basics = page.getByRole("region", { name: "Basic elements", exact: true });
				for (const [index, label] of ["Text", "Rectangle", "Circle"].entries()) {
					await openElements();
					await expect(basics).toBeVisible();
					if (index === 0) {
						await expect(
							basics.locator('[data-slot="media-card"][data-variant="picker"]'),
						).toHaveCount(1);
						await expect(basics.locator(".fc-template-tile")).toHaveCount(0);
						const tabs = page.getByRole("tablist", { name: "Element category", exact: true });
						await expect(tabs.getByRole("tab")).toHaveCount(5);
						await expect(tabs.locator("svg")).toHaveCount(0);
						const searchBox = (await page.locator('[data-slot="search-field"]').boundingBox())!;
						const tabsBox = (await tabs.boundingBox())!;
						expect(tabsBox.y).toBeGreaterThanOrEqual(searchBox.y + searchBox.height);
						await tabs.getByRole("tab", { name: "All", exact: true }).focus();
						await page.keyboard.press("ArrowRight");
						await expect(page.getByRole("tabpanel", { name: "Basic", exact: true })).toBeVisible();
						await page.keyboard.press("Home");
						await expect(tabs.getByRole("tab", { name: "All", exact: true })).toHaveAttribute(
							"aria-selected",
							"true",
						);
						const row = basics.getByRole("button", { name: "Add Text", exact: true });
						const size = (await row.boundingBox())!;
						expect(size.height).toBeGreaterThanOrEqual(44);
						expect(size.width).toBeLessThanOrEqual(110);
						expect(size.height).toBeCloseTo(size.width, 0);
						await expect(basics.locator(".ui-media-copy")).toHaveCount(0);
						await page
							.getByRole("searchbox", { name: "Search elements", exact: true })
							.fill("circle");
						const shapes = page.getByRole("region", { name: "Shape elements", exact: true });
						await expect(shapes.getByRole("button")).toHaveCount(1);
						await expect(
							shapes.getByRole("button", { name: "Add Circle", exact: true }),
						).toBeVisible();
						await page.getByRole("searchbox", { name: "Search elements", exact: true }).fill("");
						await page.screenshot({ path: testInfo.outputPath("basic-elements.png") });
					}
					const source =
						label === "Text"
							? basics
							: page.getByRole("region", { name: "Shape elements", exact: true });
					const add = source.getByRole("button", { name: `Add ${label}`, exact: true });
					if (phone) await add.tap();
					else await add.click();
					await expect.poll(() => textClips().length).toBe(index + 2);
					expect(textClips().at(-1)?.text?.layout?.animation).toBeUndefined();
					expect(textClips()[0]?.text?.layout?.animation).toEqual(oldKeys);
				}
				expect(textClips().map((c) => c.text?.preset)).toEqual([
					"title",
					"plain",
					"shape-rect",
					"shape-circle",
				]);
				// Drag uses the same static preset and normal clip placement path.
				await openElements();
				const transfer = await page.evaluateHandle(() => new DataTransfer());
				await page
					.getByRole("region", { name: "Shape elements", exact: true })
					.getByRole("button", { name: "Add Rectangle", exact: true })
					.dispatchEvent("dragstart", { dataTransfer: transfer });
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();
				const lane = page.locator('[data-vui-row="lane-1"]').first(),
					box = (await lane.boundingBox())!;
				await lane.dispatchEvent("drop", {
					dataTransfer: transfer,
					clientX: box.x + 80,
					clientY: box.y + box.height / 2,
				});
				await expect.poll(() => textClips().length).toBe(5);
				const plain = textClips()[1]!;
				await page.locator(`[data-clipid="${plain.id}"]`).click();
				if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Text"]').tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Text", exact: true })
						.click();
				await expect(page.locator(".tl2-anim")).toHaveCount(0);
				await expect(page.getByRole("combobox", { name: "Weight", exact: true })).toHaveAttribute(
					"data-value",
					"400",
				);
				await expect(page.getByText("Animate", { exact: true })).toHaveCount(0);
				if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Transform", exact: true })
						.click();
				const position = page.getByRole("group", { name: "Position", exact: true });
				await position.getByRole("button", { name: "Position keyframe", exact: true }).click();
				const field = position.getByRole("spinbutton", { name: "X offset", exact: true });
				await field.fill("20");
				await field.press("Tab");
				const keys = () =>
					saved.clips.find((c) => c.id === plain.id)?.text?.layout?.animation?.tracks.xPct;
				await expect.poll(() => keys()?.[0]?.v).toBe(20);
				expect(textClips()[0]?.text?.layout?.animation).toEqual(oldKeys);
				await page.screenshot({ path: testInfo.outputPath("basic-text-keyframes.png") });
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.[0]?.v).toBe(8);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => keys()?.[0]?.v).toBe(20);
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				expect(textClips().map((c) => c.text?.preset)).toEqual([
					"title",
					"plain",
					"shape-rect",
					"shape-circle",
					"shape-rect",
				]);
				expect(keys()?.[0]?.v).toBe(20);
				expect(textClips()[0]?.text?.layout?.animation).toEqual(oldKeys);
				await page.locator('[data-clipid="text:77"]').click();
				if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Animation"]').tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Animation", exact: true })
						.click();
				const animation = page.getByRole("region", { name: "Animation settings", exact: true });
				await expect(
					animation
						.getByRole("region", { name: "Entrance", exact: true })
						.locator(".ui-insp-summary"),
				).toHaveText("Custom");
				await expect(
					animation.getByRole("button", { name: /Custom keys|Custom keyframes/ }),
				).toHaveCount(0);
				expect(textClips()[0]?.text?.layout?.animation).toEqual(oldKeys);
				await page.screenshot({ path: testInfo.outputPath("collapsed-animation.png") });
				await openElements();
				await page
					.getByRole("searchbox", { name: "Search elements", exact: true })
					.fill("Saved rectangle");
				const custom = page.getByRole("button", { name: "Add Saved rectangle", exact: true });
				await expect(custom).toBeVisible();
				await custom.dispatchEvent("contextmenu", { clientX: 100, clientY: 300 });
				await expect(
					page.locator(".fc-ctx").getByRole("button", { name: "Edit", exact: true }),
				).toBeVisible();
				await expect(
					page.locator(".fc-ctx").getByRole("button", { name: "Delete", exact: true }),
				).toBeVisible();
				await page.locator(".fc-ctx-scrim").click({ position: { x: width - 10, y: 120 } });
				await custom.click();
				await expect.poll(() => textClips().length).toBe(6);
				expect(textClips().at(-1)?.text?.preset).toBe("shape-rect");
				expect(textClips().at(-1)?.text?.layout?.animation).toBeUndefined();
				await openElements();
				await page.getByRole("searchbox", { name: "Search elements", exact: true }).fill("");
				const category = page.getByRole("tablist", { name: "Element category", exact: true });
				await category.getByRole("tab", { name: "Text", exact: true }).click();
				const title = page.getByRole("button", { name: "Add Title", exact: true });
				await expect(title).toContainText(/Launch Moment/i);
				expect(await title.textContent()).not.toContain("Existing text");
				await title.click();
				await expect.poll(() => textClips().length).toBe(7);
				expect(textClips().at(-1)?.text?.content).toBe("Launch Moment");
				expect(textClips()[0]?.text?.content).toBe("Existing text");
				expect(textClips()[0]?.text?.layout?.animation).toEqual(oldKeys);
				await openElements();
				await category.getByRole("tab", { name: "Motion", exact: true }).click();
				await expect(
					page
						.getByRole("region", { name: "Motion elements", exact: true })
						.locator(".tl2-elgroup-h")
						.getByRole("button", { name: "New motion", exact: true }),
				).toBeVisible();
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
