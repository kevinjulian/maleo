import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`stacked properties and filled fields at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
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
				await replayApi(context, HAR);
				const page = await context.newPage();
				await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
				await expect(page.locator(".tl2-timeline")).toBeVisible();
				const tools = page.getByRole("navigation", { name: "Editor tools" });
				await tools.getByRole("button", { name: /^Captions/ }).click();
				await page.getByRole("tab", { name: "Style", exact: true }).click();
				const enabled = page.getByRole("switch", { name: "Enable captions" });
				if ((await enabled.getAttribute("aria-checked")) === "false") await enabled.click();
				const words = page
					.locator(".fc-cap")
					.getByRole("group", { name: "Placement", exact: true });
				const stacked = await words.evaluate((el) => {
					const label = el.querySelector(".ui-insp-label")!.getBoundingClientRect();
					const control = el.querySelector(".ui-insp-control")!.getBoundingClientRect();
					return control.top >= label.bottom;
				});
				expect(stacked).toBe(true);
				const fill = await words
					.locator('[data-slot="number-field"]')
					.first()
					.evaluate((el) => getComputedStyle(el).backgroundColor);
				const font = page.locator(".fc-cap").getByRole("combobox", { name: "Font family" });
				expect(await font.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(fill);
				await words.getByRole("spinbutton", { name: "Vertical position", exact: true }).fill("6");
				await expect(
					words.getByRole("spinbutton", { name: "Vertical position", exact: true }),
				).toHaveValue("6");
				await expect(words.getByRole("slider")).toHaveCount(0);
				await page.keyboard.press("Tab");
				await page.screenshot({ path: testInfo.outputPath("stacked-captions.png") });
				await tools.getByRole("button", { name: /^Style/ }).click();
				const style = page.locator(".fc-style-panel");
				/* Every section starts collapsed and edits in place: no drawer opens. */
				for (const toggle of await style.locator("button.ui-insp-toggle").all())
					await expect(toggle).toHaveAttribute("aria-expanded", "false");
				await style.getByRole("button", { name: "Brand", exact: true }).click();
				const accent = style.getByRole("group", { name: "Accent", exact: true });
				await expect(accent).toBeVisible();
				expect(
					await accent.evaluate((el) => {
						const label = el.querySelector(".ui-insp-label")!.getBoundingClientRect();
						const control = el.querySelector(".ui-insp-control")!.getBoundingClientRect();
						return control.top >= label.bottom && control.left >= 0 && control.right <= innerWidth;
					}),
				).toBe(true);
				await page.mouse.move(0, 0);
				for (const field of await style.locator('[data-slot="input"]').all()) {
					await field.evaluate((el) => (el as HTMLElement).blur());
					await expect
						.poll(() => field.evaluate((el) => getComputedStyle(el).backgroundColor))
						.toBe(fill);
				}
				await page.screenshot({ path: testInfo.outputPath("stacked-style.png") });
				for (const name of ["Chapter pills", "Progress bar"]) {
					const control = style.getByRole("switch", { name, exact: true });
					await expect(control).toBeVisible();
					const checked = await control.isChecked();
					await control.click();
					await expect(control).toBeChecked({ checked: !checked });
				}
				await tools.getByRole("button", { name: /^Project/ }).click();
				const project = page.locator(".fc-project-settings");
				await expect(
					project.getByRole("combobox", { name: "Aspect ratio", exact: true }),
				).toBeVisible();
				await page.screenshot({ path: testInfo.outputPath("stacked-project.png") });
				await tools.getByRole("button", { name: /^Assets/ }).click();
				const search = page.locator('[data-slot="search-field"]').first();
				await expect(search).toBeVisible();
				await page.mouse.move(0, 0);
				await expect
					.poll(() => search.evaluate((el) => getComputedStyle(el).backgroundColor))
					.toBe(fill);
				await search.getByRole("searchbox").fill("missing asset");
				await search.getByRole("button", { name: "Clear search" }).click();
				await expect(search.getByRole("searchbox")).toHaveValue("");
				await expect(search.getByRole("searchbox")).toBeFocused();
			} finally {
				await context.close().catch(() => {});
			}
		});
