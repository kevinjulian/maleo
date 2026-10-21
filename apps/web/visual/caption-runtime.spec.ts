/* Opt-in: API test owns throwaway Postgres plus actual import and caption worker jobs. */
import { test, expect } from "@playwright/test";
import { resolve } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { replayApi } from "./har.ts";
import { chooseOption } from "./options.ts";
const projects: Array<{ width: number; id: string }> = JSON.parse(
	process.env.MALEO_CAPTION_BROWSER_PROJECTS ?? "[]",
);
for (const { width, id } of projects) {
	test.describe(`real caption workflow ${width}`, () => {
		test.use({
			viewport: { width, height: 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
		});
		test("imports talking head, recognizes, corrects and reloads canonical captions", async ({
			page,
			context,
		}) => {
			const api = process.env.MALEO_CAPTION_BROWSER_API!;
			await replayApi(context, resolve(import.meta.dirname, "fixtures/api-editor-chat.har"));
			await context.route(
				new RegExp(`/api/operations/projects/${id}(?:/|\\?|$)`),
				async (route) => {
					const source = new URL(route.request().url());
					await route.continue({ url: `${api}${source.pathname}${source.search}` });
				},
			);
			await context.route(/\/api\/media\/[0-9a-f-]+/, async (route) => {
				const source = new URL(route.request().url());
				await route.continue({ url: `${api}${source.pathname}${source.search}` });
			});
			await page.goto(`/content/${id}?workspace=default`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await page.getByRole("button", { name: "Assets", exact: true }).click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			const uploaded = page.waitForResponse(
				(response) =>
					response.url().includes("/media/import") && response.request().method() === "POST",
			);
			await page
				.getByLabel("Choose media files", { exact: true })
				.setInputFiles(process.env.MALEO_CAPTION_BROWSER_VIDEO!);
			const uploadResponse = await uploaded;
			expect(uploadResponse.status()).toBe(202);
			const add = page.getByRole("button", {
				name: "Add talking-head.mp4 to timeline",
				exact: true,
			});
			await expect(add).toBeEnabled();
			await add.click();
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			const video = page.locator('[data-clipid^="video:"]').first();
			await expect(video).toBeVisible();
			await video.click();
			await page.getByRole("button", { name: "Audio", exact: true }).click();
			await page.screenshot({
				path: `/tmp/maleo-caption-runtime/import-${width}.png`,
				fullPage: true,
			});
			// The inspector's native audio default is silent; enable its existing gain control.
			const volume = page.getByRole("spinbutton", { name: "Volume", exact: true });
			await expect(volume).toBeVisible();
			await volume.fill("100");
			await volume.press("Enter");
			await page.keyboard.press("Escape");
			if (width === 320)
				await page.getByRole("button", { name: "Clip actions", exact: true }).click();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await chooseOption(
				page.getByRole("combobox", { name: "Caption language", exact: true }),
				"en",
			);
			await page.getByRole("button", { name: "Generate captions", exact: true }).click();
			const rows = page.locator("[data-caption-row]");
			await expect(rows.first()).toBeVisible();
			const cueId = await rows.first().getAttribute("data-caption-row");
			const input = rows.first().getByRole("textbox", { name: "Caption text", exact: true });
			const recognized = await input.inputValue();
			expect(recognized.length).toBeGreaterThan(0);
			await input.fill(`${recognized} corrected`);
			await input.press("ArrowLeft");
			await expect(input).toBeFocused();
			await rows.first().getByRole("button").first().click();
			await expect(rows.first().getByText("Estimated word timing", { exact: true })).toBeVisible();
			const count = await rows.count();
			expect(count).toBeGreaterThan(1);
			await rows.first().getByRole("button", { name: "Merge next", exact: true }).click();
			await expect(rows).toHaveCount(count - 1);
			const merged = rows.first().getByRole("textbox", { name: "Caption text", exact: true });
			await merged.evaluate((el) => {
				const area = el as HTMLTextAreaElement;
				const at = area.value.indexOf(" ") + 1;
				area.focus();
				area.setSelectionRange(at, at);
			});
			await merged.press("Enter");
			await expect(rows).toHaveCount(count);
			await page.keyboard.press("ControlOrMeta+z");
			await page.keyboard.press("ControlOrMeta+z");
			await expect(rows.first()).toHaveAttribute("data-caption-row", cueId!);
			await page.getByRole("tab", { name: "Style", exact: true }).click();
			await chooseOption(
				page.getByRole("combobox", { name: "Caption style", exact: true }),
				"Word pop",
			);
			await expect
				.poll(async () => {
					const detail = await (
						await context.request.get(`${api}/api/operations/projects/${id}`)
					).json();
					return detail.storyboards?.[0]?.storyboard_json?.clips?.find(
						(clip: { id: string }) => clip.id === cueId,
					)?.caption?.text;
				})
				.toBe(`${recognized} corrected`);
			await page.reload({ waitUntil: "domcontentloaded" });
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(rows.first()).toHaveAttribute("data-caption-row", cueId!);
			await expect(
				rows.first().getByRole("textbox", { name: "Caption text", exact: true }),
			).toHaveValue(`${recognized} corrected`);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await video.click();
			const beforeDrag = await video.getAttribute("style");
			const bounds = (await video.boundingBox())!;
			const x = bounds.x + 32,
				y = bounds.y + bounds.height / 2;
			if (width === 320) {
				await video.dispatchEvent("pointerdown", {
					pointerId: 42,
					pointerType: "touch",
					isPrimary: true,
					button: 0,
					buttons: 1,
					clientX: x,
					clientY: y,
				});
				await page.waitForTimeout(140);
				await video.dispatchEvent("pointermove", {
					pointerId: 42,
					pointerType: "touch",
					isPrimary: true,
					buttons: 1,
					clientX: x + 24,
					clientY: y,
				});
				await video.dispatchEvent("pointerup", {
					pointerId: 42,
					pointerType: "touch",
					isPrimary: true,
					button: 0,
					buttons: 0,
					clientX: x + 24,
					clientY: y,
				});
			} else {
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(x + 24, y, { steps: 4 });
				await page.mouse.up();
			}
			await expect(video).not.toHaveAttribute("style", beforeDrag!);
			await video.focus();
			await video.press("ControlOrMeta+z");
			await expect(video).toHaveAttribute("style", beforeDrag!);
			await video.focus();
			await video.press("ArrowRight");
			await video.press("ControlOrMeta+z");
			await video.press("ControlOrMeta+Shift+z");
			await video.press("ControlOrMeta+z");
			await page.getByRole("button", { name: "Timing", exact: true }).click();
			await page.getByRole("button", { name: "Out back one frame", exact: true }).click();
			const rate = page.getByRole("spinbutton", { name: "Rate (%)", exact: true });
			await rate.fill("125");
			await rate.press("Enter");
			await expect(rate).toHaveValue("125");
			await expect
				.poll(async () => {
					const detail = await (
						await context.request.get(`${api}/api/operations/projects/${id}`)
					).json();
					return detail.storyboards?.[0]?.storyboard_json?.clips?.find(
						(clip: { type: string }) => clip.type === "video",
					)?.video?.layout?.playbackRate;
				})
				.toBe(1.25);
			await page.keyboard.press("Escape");
			await video.focus();
			await video.press("ControlOrMeta+z");
			await video.press("ControlOrMeta+z");
			await expect
				.poll(async () => {
					const detail = await (
						await context.request.get(`${api}/api/operations/projects/${id}`)
					).json();
					return (
						detail.storyboards?.[0]?.storyboard_json?.clips?.find(
							(clip: { type: string }) => clip.type === "video",
						)?.video?.layout?.playbackRate ?? 1
					);
				})
				.toBe(1);
			if (width === 320)
				await page.getByRole("button", { name: "Clip actions", exact: true }).click();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(rows.first()).toHaveAttribute("data-caption-row", cueId!);
			await expect(
				rows.first().getByRole("textbox", { name: "Caption text", exact: true }),
			).toHaveValue(`${recognized} corrected`);
			const download = page.waitForEvent("download");
			await page.getByRole("button", { name: "Caption actions", exact: true }).click();
			await page.getByRole("menuitem", { name: /^Export SRT/ }).click();
			const downloaded = await download;
			expect(await readFile((await downloaded.path())!, "utf8")).toContain(
				`${recognized} corrected`,
			);
			const detail = await (
				await context.request.get(`${api}/api/operations/projects/${id}`)
			).json();
			await writeFile(
				`/tmp/maleo-caption-runtime/browser-${width}.json`,
				JSON.stringify(detail.storyboards[0].storyboard_json, null, 2),
			);
			await page.screenshot({
				path: `/tmp/maleo-caption-runtime/editor-${width}.png`,
				fullPage: true,
			});
			await context.unrouteAll({ behavior: "wait" });
		});
	});
}
