import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320])
	test(`source crop and flip undo, reset and reload at ${width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await replayApi(context, HAR);
			const source = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=red:s=64x32",
				"-frames:v",
				"1",
				"-c:v",
				"png",
				"-f",
				"image2pipe",
				"pipe:1",
			]);
			const url = "/api/media/00000000-0000-0000-0000-000000000098";
			await context.route(`**${url}`, (route) =>
				route.fulfill({ body: source, contentType: "image/png" }),
			);
			// Preview loads complete local bytes through a signature, then draws from a blob URL.
			await context.route(`**${url}/sign`, (route) => route.fulfill({ json: { url } }));
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
							kind: "image",
							url,
							label: "Crop source",
							start: 0,
							dur: 8,
							track: 0,
							layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "stretch" },
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
			const page = await context.newPage();
			const open = async () => {
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await page.locator('[data-clipid="video:98"]').click();
				if (width === 320) await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Transform", exact: true })
						.click();
				await page.getByRole("button", { name: "Crop", exact: true }).click();
			};
			const layout = () => saved.clips.find((clip) => clip.id === "video:98")?.video?.layout;
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await open();
			const field = page.getByRole("spinbutton", { name: "Crop width", exact: true });
			await field.fill("50");
			await field.press("Tab");
			await expect.poll(() => layout()?.crop?.widthPct).toBe(50);
			expect(saved.clips.find((clip) => clip.id === "video:98")?.video?.url).toBe(url);
			if (width === 1440) {
				const image = page.locator('.tl2-canvas img[src^="blob:"]').first();
				await expect(image).toBeVisible();
				await expect
					.poll(
						async () =>
							(await image.boundingBox())!.width /
							(await page.locator(".tl2-canvas").boundingBox())!.width,
					)
					.toBeCloseTo(2, 1);
			}
			await page.getByRole("button", { name: "Flip horizontal", exact: true }).click();
			await expect.poll(() => layout()?.flipX).toBe(true);
			if (width === 320) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect.poll(() => layout()?.flipX).toBe(false);
			expect(layout()?.crop?.widthPct).toBe(50);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(() => layout()?.flipX).toBe(true);
			await page.reload();
			await open();
			await expect(field).toHaveValue("50");
			await expect(
				page.getByRole("button", { name: "Flip horizontal", exact: true }),
			).toHaveAttribute("aria-pressed", "true");
			await page.getByRole("button", { name: "Flip vertical", exact: true }).click();
			await expect.poll(() => layout()?.flipY).toBe(true);
			const reset = page.getByRole("button", { name: "Reset crop", exact: true });
			await reset.scrollIntoViewIfNeeded();
			if (width === 320) {
				expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
				await reset.tap();
			} else {
				await reset.focus();
				await page.keyboard.press("Enter");
			}
			await expect.poll(() => layout()?.crop).toBeUndefined();
			await expect(field).toHaveValue("100");
			// Flips live on the Rotation row now, so resetting the crop leaves them.
			expect(layout()?.flipX).toBe(true);
			await page.getByRole("button", { name: "Flip horizontal", exact: true }).click();
			await page.getByRole("button", { name: "Flip vertical", exact: true }).click();
			await expect.poll(() => layout()?.flipX).toBe(false);
			await expect.poll(() => layout()?.flipY).toBe(false);
			const bytes = await page.evaluate(
				async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
				url,
			);
			expect(Buffer.from(bytes)).toEqual(source);
			await page.screenshot({ path: testInfo.outputPath("crop-reset.png") });
		} finally {
			await context.close();
		}
	});
