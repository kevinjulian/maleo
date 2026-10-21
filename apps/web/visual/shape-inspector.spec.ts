import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`shape styles, locks and reload at ${width}px ${theme}`, async ({ browser }, info) => {
			test.setTimeout(90_000);
			const phone = width === 320;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: 900 },
				hasTouch: phone,
				isMobile: phone,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, resolve(import.meta.dirname, "fixtures/api-editor-chat.har"));
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
								dur: 12,
								src: "",
							},
						],
						[],
						[
							{
								id: 77,
								content: "",
								preset: "shape-rect",
								start: 0,
								dur: 10,
								track: 0,
								params: { fill: "#ff0000", stroke: "#00ff00", strokeWidth: 5, radius: 12 },
								layout: { xPct: 8, yPct: 18, widthPct: 84, heightPct: 34, fit: "contain" },
							},
							{ id: 78, content: "", preset: "shape-circle", start: 0, dur: 10, track: 1 },
						],
					),
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
				const page = await context.newPage(),
					errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				const rectangle = () => saved.clips.find((clip) => clip.id === "text:77")?.text;
				const close = async () => {
					if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				};
				const group = async (name: string) => {
					if (phone) await page.locator(`.tl2-clipbar-groups [aria-label="${name}"]`).click();
					else
						await page.locator(".tl2-clippanel").getByRole("button", { name, exact: true }).click();
				};
				const open = async (id = 77) => {
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await page.locator(`[data-clipid="text:${id}"]`).click();
					await group("Shape");
				};
				const fill = async (label: string, value: string) => {
					const input = page.getByRole("spinbutton", { name: label, exact: true });
					await input.fill(value);
					await input.press("Tab");
				};
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await open();
				await expect(page.getByRole("region", { name: "Shape", exact: true })).toBeVisible();
				await expect(page.getByRole("combobox", { name: "Font", exact: true })).toHaveCount(0);
				await expect(page.getByRole("textbox", { name: "Text", exact: true })).toHaveCount(0);
				await fill("Stroke width", "0");
				await fill("Corner radius", "0");
				await page.getByRole("button", { name: "Shape fill color", exact: true }).click();
				await page.getByRole("button", { name: "Transparent", exact: true }).click();
				await page.getByRole("button", { name: "Done", exact: true }).click();
				await expect
					.poll(() => rectangle()?.params)
					.toMatchObject({ fill: "transparent", strokeWidth: 0, radius: 0 });
				await page.screenshot({ path: info.outputPath("shape-controls.png") });
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => rectangle()?.params?.fill).toBe("#ff0000");
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => rectangle()?.params?.fill).toBe("transparent");
				await group("Blending");
				await fill("Opacity", "0");
				await expect.poll(() => rectangle()?.layout?.opacity).toBe(0);
				await page.getByRole("button", { name: "Opacity keyframe", exact: true }).click();
				await fill("Opacity", "25");
				await expect.poll(() => rectangle()?.layout?.animation?.tracks.opacity?.[0]?.v).toBe(0.25);
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => rectangle()?.layout?.animation?.tracks.opacity?.[0]?.v).toBe(0);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => rectangle()?.layout?.animation?.tracks.opacity?.[0]?.v).toBe(0.25);
				await open(78);
				await expect(
					page
						.getByRole("region", { name: "Shape", exact: true })
						.getByText("Circle", { exact: true }),
				).toBeVisible();
				await expect(
					page.getByRole("spinbutton", { name: "Corner radius", exact: true }),
				).toHaveCount(0);
				await close();
				await page.reload();
				await open();
				await expect(
					page.getByRole("spinbutton", { name: "Stroke width", exact: true }),
				).toHaveValue("0");
				await expect(
					page.getByRole("spinbutton", { name: "Corner radius", exact: true }),
				).toHaveValue("0");
				expect(rectangle()?.params?.fill).toBe("transparent");
				expect(rectangle()?.preset).toBe("shape-rect");
				if (!phone) {
					await page.locator('[data-gutter-row="1"] [title="Lock track"]').click();
					await expect(
						page.getByRole("spinbutton", { name: "Stroke width", exact: true }),
					).toBeDisabled();
					await expect(
						page.getByRole("button", { name: "Shape fill color", exact: true }),
					).toBeDisabled();
					for (const name of ["Transform", "Animation", "Blending", "Timing"]) {
						await group(name);
						await expect(
							page.getByText("Track locked. Unlock the track to edit this clip.", { exact: true }),
						).toBeVisible();
					}
					expect(rectangle()?.params).toMatchObject({
						fill: "transparent",
						strokeWidth: 0,
						radius: 0,
					});
				}
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
