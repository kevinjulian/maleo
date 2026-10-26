import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID, EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
for (const viewport of [
	{ width: 1440, height: 900, touch: false },
	{ width: 320, height: 740, touch: true },
	{ width: 844, height: 390, touch: true },
]) {
	test(`preview transforms commit once and cancel at ${viewport.width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport,
			hasTouch: viewport.touch,
			isMobile: viewport.touch,
			reducedMotion: "reduce",
		});
		try {
			await replayApi(context, HAR);
			const page = await context.newPage();
			await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
			await page.locator('[data-clipid="text:1"]').click();
			const openTransform = async (): Promise<void> => {
				if (viewport.touch)
					await page.locator('.tl2-clipbar-groups [aria-label*="Transform"]').click();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Transform", exact: true })
						.click();
			};
			await openTransform();
			const inspector = page.locator(".tl2-clippanel");
			const field = (name: string) => inspector.getByRole("spinbutton", { name, exact: true });
			await field("X offset").fill("0");
			await field("Y offset").fill("20");
			await field("Width").fill("100");
			await field("Height").fill("50");
			await inspector.getByRole("button", { name: "Lock aspect ratio", exact: true }).click();
			await field("Width").fill("80");
			await expect(field("Height")).toHaveValue("40");
			await field("Width").fill("100");
			await expect(field("Height")).toHaveValue("50");
			if (viewport.touch) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
			const box = page.locator(".tl2-clipbox");
			const rotation = page.getByRole("button", { name: "Rotate selected clip", exact: true });
			await expect(rotation).toBeVisible();
			const session = viewport.touch ? await context.newCDPSession(page) : null;
			const drag = async (dx: number, dy: number, cancel = false): Promise<void> => {
				const rect = (await rotation.boundingBox())!;
				const x = rect.x + rect.width / 2,
					y = rect.y + rect.height / 2;
				expect(
					await rotation.evaluate((el) => {
						const r = el.getBoundingClientRect();
						return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
					}),
				).toBe(true);
				if (session) {
					await session.send("Input.dispatchTouchEvent", {
						type: "touchStart",
						touchPoints: [{ x, y }],
					});
					await session.send("Input.dispatchTouchEvent", {
						type: "touchMove",
						touchPoints: [{ x: x + dx, y: y + dy }],
					});
				} else {
					await page.mouse.move(x, y);
					await page.mouse.down();
					await page.mouse.move(x + dx, y + dy, { steps: 5 });
				}
				await expect.poll(() => box.evaluate((el) => el.style.rotate)).not.toBe("0deg");
				if (cancel) await page.keyboard.press("Escape");
				if (session)
					await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
				else await page.mouse.up();
			};
			await drag(30, 20, true);
			await expect.poll(() => box.evaluate((el) => el.style.rotate)).toBe("0deg");
			await drag(30, 20);
			const rotated = await box.evaluate((el) => el.style.rotate);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect.poll(() => box.evaluate((el) => el.style.rotate)).toBe("0deg");
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(() => box.evaluate((el) => el.style.rotate)).toBe(rotated);
			if (!viewport.touch) {
				await rotation.focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => box.evaluate((el) => el.style.rotate)).not.toBe(rotated);
			}
			const size = () =>
				box.evaluate((el) => ({
					width: parseFloat(el.style.width),
					height: parseFloat(el.style.height),
				}));
			const beforeResize = await size();
			const corner = page.getByRole("button", { name: "Resize selected clip se", exact: true });
			const rect = (await corner.boundingBox())!;
			const x = rect.x + rect.width / 2,
				y = rect.y + rect.height / 2;
			await page.screenshot({ path: testInfo.outputPath("resize-before.png") });
			const hit = await corner.evaluate((el) => {
				const r = el.getBoundingClientRect();
				const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
				return {
					own: el.contains(target),
					target: target?.outerHTML,
					width: r.width,
					height: r.height,
				};
			});
			expect(hit.own, JSON.stringify(hit)).toBe(true);
			if (session) {
				await session.send("Input.dispatchTouchEvent", {
					type: "touchStart",
					touchPoints: [{ x, y }],
				});
				await session.send("Input.dispatchTouchEvent", {
					type: "touchMove",
					touchPoints: [{ x: x + 15, y: y + 20 }],
				});
				await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
			} else {
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(x + 15, y + 20, { steps: 5 });
				await page.mouse.up();
			}
			await expect.poll(async () => (await size()).width).not.toBe(beforeResize.width);
			const resized = await size();
			expect(resized.width / resized.height).toBeCloseTo(
				beforeResize.width / beforeResize.height,
				4,
			);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect.poll(size).toEqual(beforeResize);
			if (!viewport.touch) {
				await field("Rotation").fill("0");
				await field("Width").fill("40");
				await field("X offset").fill("29");
				await page.locator(".tl2-preview").evaluate((el) => {
					el.style.zoom = "1.2";
				});
				const canvas = (await page.locator(".tl2-canvas").boundingBox())!;
				const body = (await page
					.getByRole("button", { name: "Move selected clip", exact: true })
					.boundingBox())!;
				const start = { x: body.x + body.width / 2, y: body.y + body.height / 2 };
				await page.mouse.move(start.x, start.y);
				await page.mouse.down();
				await page.mouse.move(start.x + canvas.width * 0.013, start.y, { steps: 3 });
				await expect(page.locator(".tl2-snapguide.v")).toBeVisible();
				await expect.poll(() => box.evaluate((el) => el.style.left)).toBe("30%");
				await page.keyboard.press("Escape");
				await page.mouse.up();
				await expect.poll(() => box.evaluate((el) => el.style.left)).toBe("29%");
				await page.keyboard.down("Alt");
				await page.mouse.move(start.x, start.y);
				await page.mouse.down();
				await page.mouse.move(start.x + canvas.width * 0.013, start.y, { steps: 3 });
				await expect(page.locator(".tl2-snapguide.v")).toHaveCount(0);
				await expect
					.poll(() => box.evaluate((el) => parseFloat(el.style.left)))
					.toBeCloseTo(30.3, 2);
				await page.keyboard.press("Escape");
				await page.mouse.up();
				await page.keyboard.up("Alt");
				await expect.poll(() => box.evaluate((el) => el.style.left)).toBe("29%");
				const lane = await page
					.locator('[data-clipid="text:1"]')
					.evaluate((el) =>
						el.closest("[data-vui-row]")?.getAttribute("data-vui-row")?.replace("lane-", ""),
					);
				await page
					.locator(`[data-gutter-row="${lane}"]`)
					.getByRole("button", { name: "Lock track", exact: true })
					.click();
				await expect(
					page.getByRole("button", { name: "Rotate selected clip", exact: true }),
				).toHaveCount(0);
				await expect(box).toHaveAttribute("aria-label", "Selected clip, track locked");
			}
			await page.screenshot({ path: testInfo.outputPath("preview-transform.png") });
		} finally {
			await context.close();
		}
	});
}

test("text clip transform controls change rendered rotation and opacity", async ({
	page,
	context,
}, testInfo) => {
	await replayApi(context, resolve(dirname(HAR), "api-editor-chat.har"));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page.locator('[data-clipid="text:1"]').click();
	const inspector = page.locator(".tl2-clippanel");
	await inspector.getByRole("button", { name: "Transform", exact: true }).click();
	await inspector
		.getByRole("group", { name: "Rotation", exact: true })
		.getByRole("spinbutton")
		.fill("30");
	await inspector.getByRole("button", { name: "Blending", exact: true }).click();
	await inspector
		.getByRole("group", { name: "Opacity", exact: true })
		.getByRole("spinbutton")
		.fill("50");
	const rendered = () =>
		page
			.locator(".tl2-remotion-stage")
			.evaluate(
				(stage) =>
					Array.from(stage.querySelectorAll<HTMLElement>("div")).find(
						(el) => el.style.rotate === "30deg",
					)?.style.opacity,
			);
	await page.getByRole("button", { name: "Play", exact: true }).click();
	await expect
		.poll(async () => {
			const opacity = Number(await rendered());
			return opacity > 0.01 && opacity <= 0.5;
		})
		.toBe(true);
	await page.getByRole("button", { name: "Pause", exact: true }).click();
	await page.screenshot({ path: testInfo.outputPath("text-transform.png") });
});

for (const viewport of [
	{ width: 320, height: 740 },
	{ width: 844, height: 390 },
]) {
	test(`locked preview refuses touch manipulation at ${viewport.width}px`, async ({ browser }) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport,
			hasTouch: true,
			isMobile: true,
			reducedMotion: "reduce",
		});
		try {
			await replayApi(context, resolve(dirname(HAR), "api-editor-chat.har"));
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_FIXTURE_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							storyboards: editorChatProjectDetail.storyboards.map((storyboard) => ({
								...storyboard,
								storyboard_json: {
									...storyboard.storyboard_json,
									trackFlags: { 1: { locked: true } },
								},
							})),
						},
					}),
			);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const clip = page.locator('[data-clipid="text:1"]');
			await expect(clip).not.toHaveAttribute("aria-disabled", "true");
			await expect(clip).toHaveAccessibleName(/locked/);
			/* A landscape phone leaves the timeline ~120px; with lane heights following
			 * lane groups the text lane sits below that, so bring it into view first. */
			await clip.scrollIntoViewIfNeeded();
			const rect = (await clip.boundingBox())!;
			const session = await context.newCDPSession(page);
			await session.send("Input.dispatchTouchEvent", {
				type: "touchStart",
				touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }],
			});
			await session.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: [{ x: rect.x + rect.width / 2 + 15, y: rect.y + rect.height / 2 }],
			});
			await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
			await expect(
				page.getByRole("button", { name: "Rotate selected clip", exact: true }),
			).toHaveCount(0);
			await expect(
				page.getByRole("group", { name: "Selected clip, track locked", exact: true }),
			).toBeVisible();
			await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
			await expect(
				page.getByText("Track locked. Unlock the track to edit this clip.", { exact: true }),
			).toBeVisible();
		} finally {
			await context.close();
		}
	});
}
