import { chooseOption } from "./options.ts";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { toTimelineDoc, type TrackFlags } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`compositing controls, mask canvas, reset and reload at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(90_000);
			const phone = width !== 1440,
				context = await browser.newContext({
					baseURL: "http://127.0.0.1:3031",
					viewport: { width, height: width === 844 ? 390 : phone ? 740 : 900 },
					hasTouch: phone,
					isMobile: phone,
					colorScheme: theme,
					reducedMotion: "reduce",
				});
			try {
				await replayApi(context, HAR);
				const first = editorChatProjectDetail.storyboards[0]!;
				const baseImage = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(80,120,160)"/></svg>')}`;
				const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="rgb(160,80,40)"/></svg>')}`;
				/* Read back after a save; the fixture starts with no flags set. */
				const noTrackFlags: TrackFlags = {};
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
								dur: 4,
								src: baseImage,
							},
						],
						[
							{
								id: 98,
								kind: "image",
								url: image,
								label: "Imported image with a deliberately long label for narrow inspector",
								start: 0,
								dur: 4,
								track: 0,
							},
						],
					),
					trackFlags: noTrackFlags,
				};
				let failSave = false;
				await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
					stored: () => saved,
					onSave: (next) => {
						saved = next as typeof saved;
					},
					fail: () => {
						const fail = failSave;
						failSave = false;
						return fail;
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
				page.on("pageerror", (error) => errors.push(error.message));
				const layout = () => saved.clips.find((c) => c.id === "video:98")?.video?.layout;
				const close = async () => {
					if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				};
				const group = async (name: "Masks" | "Blending" | "Adjust") => {
					if (phone) await page.locator(`.tl2-clipbar-groups [aria-label="${name}"]`).tap();
					else
						await page.locator(".tl2-clippanel").getByRole("button", { name, exact: true }).click();
				};
				const open = async (name: "Masks" | "Blending" | "Adjust" = "Masks") => {
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await page.locator('[data-clipid="video:98"]').click();
					await group(name);
				};
				// The phone bar shows one group at a time: go back to the group list first.
				const switchTo = async (name: "Masks" | "Blending" | "Adjust") => {
					await close();
					await group(name);
				};
				const fill = async (name: string, value: string) => {
					const field = page.getByRole("spinbutton", { name, exact: true });
					await field.fill(value);
					await field.press("Tab");
				};
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await open();
				await chooseOption(
					page.getByRole("combobox", { name: "Mask shape", exact: true }),
					"ellipse",
				);
				await close();
				const canvas = page.locator(".tl2-remotion-stage");
				await expect
					.poll(() => canvas.locator('div[style*="mask-image"]').count())
					.toBeGreaterThan(0);
				await canvas.screenshot({ path: testInfo.outputPath("mask-preview-pixels.png") });
				for (const [fraction, expected] of [
					[0.5, [160, 80, 40]],
					[0.1, [80, 120, 160]],
				] as const) {
					await expect
						.poll(async () => {
							const pixel = execFileSync(
								"ffmpeg",
								[
									"-v",
									"error",
									"-i",
									"pipe:0",
									"-vf",
									`crop=1:1:iw*${fraction}:ih*0.5`,
									"-threads",
									"1",
									"-f",
									"rawvideo",
									"-pix_fmt",
									"rgb24",
									"pipe:1",
								],
								{
									input: await canvas.screenshot({
										style: ".tl2-clipbox, .tl2-snapguides { visibility: hidden !important; }",
									}),
								},
							);
							return [...pixel.subarray(0, 3)];
						})
						.toEqual(expected);
				}
				await open();
				await fill("Mask X", "20");
				await fill("Mask width", "60");
				await fill("Mask rotation", "30");
				await fill("Mask feather", "12");
				await page.getByRole("button", { name: "Invert mask", exact: true }).click();
				await switchTo("Blending");
				await chooseOption(
					page.getByRole("combobox", { name: "Blend mode", exact: true }),
					"screen",
				);
				await switchTo("Adjust");
				// Three fields share the Adjust row; at 320px they wrap two and one, with no sideways scroll.
				const tops = await Promise.all(
					["brightness", "contrast", "saturation"].map(async (name) =>
						Math.round(
							(await page.getByRole("spinbutton", { name, exact: true }).boundingBox())!.y,
						),
					),
				);
				if (width === 320) {
					expect(tops[0]).toBe(tops[1]);
					expect(tops[2]).toBeGreaterThan(tops[0]!);
				} else if (width === 1440) expect(new Set(tops).size).toBe(1);
				expect(
					await page
						.locator(".tl2-clippanel")
						.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
				).toBe(true);
				await fill("brightness", "50");
				await fill("contrast", "120");
				await fill("saturation", "150");
				await expect.poll(layout).toMatchObject({
					mask: {
						shape: "ellipse",
						xPct: 20,
						widthPct: 60,
						rotationDeg: 30,
						featherPct: 12,
						inverted: true,
					},
					blendMode: "screen",
					color: { brightness: 0.5, contrast: 1.2, saturation: 1.5 },
				});
				await page.screenshot({ path: testInfo.outputPath("compositing-controls.png") });
				await page.getByRole("button", { name: "Reset color adjustment", exact: true }).click();
				await expect
					.poll(() => layout()?.color)
					.toEqual({ brightness: 1, contrast: 1, saturation: 1 });
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.color?.brightness).toBe(0.5);
				await open();
				await page.getByRole("button", { name: "Edit mask on canvas", exact: true }).click();
				const move = page.getByRole("button", { name: "Move clip mask", exact: true });
				await expect(move).toBeVisible();
				await move.focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => layout()?.mask?.xPct).toBe(21);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.xPct).toBe(20);
				const handle = page.getByRole("button", { name: "Rotate clip mask", exact: true });
				expect(
					await handle.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
					}),
				).toBe(true);
				await handle.focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => layout()?.mask?.rotationDeg).toBe(31);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.rotationDeg).toBe(30);
				const rect = (await move.boundingBox())!,
					x = rect.x + rect.width / 2,
					y = rect.y + rect.height / 2;
				expect(
					await move.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
					}),
				).toBe(true);
				const distance = (await page.locator(".tl2-canvas").boundingBox())!.width * 0.1;
				const cdp = phone ? await context.newCDPSession(page) : null;
				const draftBox = page.locator(".tl2-clipbox"),
					originalLeft = await draftBox.evaluate((el) => el.style.left);
				const drag = async (cancel: boolean) => {
					if (cdp) {
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchStart",
							touchPoints: [{ x, y }],
						});
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchMove",
							touchPoints: [{ x: x + distance, y }],
						});
						await expect
							.poll(() => draftBox.evaluate((el) => el.style.left))
							.not.toBe(originalLeft);
						await cdp.send("Input.dispatchTouchEvent", {
							type: cancel ? "touchCancel" : "touchEnd",
							touchPoints: [],
						});
					} else {
						await page.mouse.move(x, y);
						await page.mouse.down();
						await page.mouse.move(x + distance, y, { steps: 5 });
						if (cancel) await page.keyboard.press("Escape");
						await page.mouse.up();
					}
				};
				await drag(true);
				await expect.poll(() => layout()?.mask?.xPct).toBe(20);
				await drag(false);
				await expect.poll(() => layout()?.mask?.xPct).toBeGreaterThan(20);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.xPct).toBe(20);
				const resize = page.getByRole("button", { name: "Resize clip mask se", exact: true });
				await resize.focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => layout()?.mask?.widthPct).toBeCloseTo(61, 6);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.widthPct).toBeCloseTo(60, 6);
				await page.screenshot({ path: testInfo.outputPath("mask-canvas.png") });
				await page.reload();
				await open();
				await expect(
					page.getByRole("spinbutton", { name: "Mask feather", exact: true }),
				).toHaveValue("12");
				await switchTo("Blending");
				await expect(
					page.getByRole("combobox", { name: "Blend mode", exact: true }),
				).toHaveAttribute("data-value", "screen");
				await switchTo("Adjust");
				await expect(page.getByRole("spinbutton", { name: "brightness", exact: true })).toHaveValue(
					"50",
				);
				await switchTo("Masks");
				await page.getByRole("button", { name: "Reset mask", exact: true }).click();
				await expect.poll(() => layout()?.mask?.rotationDeg).toBe(0);
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.rotationDeg).toBe(30);
				await open();
				await page.getByRole("button", { name: "Remove mask", exact: true }).click();
				await expect.poll(() => layout()?.mask).toBeNull();
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => layout()?.mask?.shape).toBe("ellipse");
				await page.getByRole("button", { name: /Export [Vv]ideo/ }).click();
				await expect(
					page.getByText(
						"Simplified draft omits masks, blending, and color adjustment. Use production export for composited clips.",
						{ exact: true },
					),
				).toBeVisible();
				await page.getByRole("button", { name: /Export [Vv]ideo/ }).click();
				await open();
				failSave = true;
				await fill("Mask feather", "13");
				await close();
				await page.getByRole("button", { name: "Retry save", exact: true }).click();
				await expect.poll(() => layout()?.mask?.featherPct).toBe(13);
				await page.reload();
				await open();
				await expect(
					page.getByRole("spinbutton", { name: "Mask feather", exact: true }),
				).toHaveValue("13");
				await close();
				if (!(await page.locator(".tl2-gutter").count())) {
					if (phone) await page.getByRole("button", { name: "More tools", exact: true }).click();
					await page.getByRole("button", { name: "Track headers", exact: true }).click();
					if (phone)
						await page
							.getByRole("dialog", { name: "Timeline tools", exact: true })
							.getByRole("button", { name: "Close", exact: true })
							.click();
				}
				const track = saved.clips.find((c) => c.id === "video:98")!.track;
				await page.locator(`[data-gutter-row="${track}"] [title="Lock track"]`).click();
				await expect.poll(() => saved.trackFlags?.[track]?.locked).toBe(true);
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await page.locator('[data-clipid="video:98"]').focus();
				await page.keyboard.press("Enter");
				await group("Masks");
				await expect(
					page.getByText("Track locked. Unlock the track to edit this clip.", { exact: true }),
				).toBeVisible();
				await expect(page.getByRole("combobox", { name: "Mask shape", exact: true })).toHaveCount(
					0,
				);
				expect(errors).toEqual([]);
			} finally {
				await context.close().catch(() => {});
			}
		});
