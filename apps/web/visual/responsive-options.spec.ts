import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { replayApi } from "./har.ts";
import { acknowledgeSaves } from "./chat-server.ts";
import { EDITOR_CHAT_PROJECT_ID } from "./fixtures/editor-chat-data.ts";
import { chooseOption } from "./options.ts";

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`responsive options and Space at ${width}px ${theme}`, async ({ browser }, info) => {
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
				const page = await context.newPage();
				await acknowledgeSaves(page, EDITOR_CHAT_PROJECT_ID);
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const play = page.getByRole("button", { name: "Play", exact: true });
				// Native button activation must never add a second playback toggle on release.
				await play.focus();
				await page.keyboard.down("Space");
				await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
				await page.keyboard.down("Space");
				await page.keyboard.up("Space");
				await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
				await page.keyboard.press("Space");
				await expect(play).toBeVisible();
				// Native widget fixtures inside the active production editor exercise browser
				// activation defaults; these controls do not carry React shortcut handlers.
				await page.locator(".cv-shell").evaluate((el) => {
					const host = document.createElement("div");
					host.id = "keyboard-native-probe";
					host.innerHTML =
						'<a href="#space-link">Link probe</a><input aria-label="Checkbox probe" type="checkbox"><input aria-label="Radio probe" type="radio"><textarea aria-label="Text probe"></textarea><div role="dialog"><button type="button">Modal probe</button></div>';
					el.append(host);
				});
				for (const control of [
					page.getByRole("link", { name: "Link probe" }),
					page.getByRole("checkbox", { name: "Checkbox probe" }),
					page.getByRole("radio", { name: "Radio probe" }),
				]) {
					await control.focus();
					await page.keyboard.down("Space");
					await page.keyboard.down("Space");
					await page.keyboard.up("Space");
					await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
					if (await control.getAttribute("type")) await expect(control).not.toBeChecked();
					await page.keyboard.press("Space");
					await expect(play).toBeVisible();
				}
				const entry = page.getByRole("textbox", { name: "Text probe" });
				await entry.focus();
				await page.keyboard.press("Space");
				await expect(entry).toHaveValue(" ");
				await expect(play).toBeVisible();
				const modal = page.getByRole("button", { name: "Modal probe" });
				await modal.focus();
				await page.keyboard.press("Space");
				await expect(play).toBeVisible();
				await page.locator("#keyboard-native-probe").evaluate((el) => el.remove());
				if (phone) await page.getByRole("button", { name: "More tools", exact: true }).click();
				const aspect = page.getByRole("combobox", { name: "Aspect ratio", exact: true }).first();
				const before = await aspect.getAttribute("data-value");
				await aspect.focus();
				await page.keyboard.press("Space");
				await expect(aspect).toHaveAttribute("aria-expanded", "false");
				await expect(aspect).toHaveAttribute("data-value", before!);
				await page.keyboard.press("Space");
				await page.keyboard.press("Enter");
				const list = page.locator('[data-slot="select-list"]:visible');
				await expect(list).toBeVisible();
				const popup = page.locator('[data-slot="select-popup"]:visible');
				const box = (await popup.boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
				if (phone) {
					await expect(
						page.getByRole("dialog", { name: "Aspect ratio", exact: true }),
					).toBeVisible();
					expect(
						(await list.getByRole("option").first().boundingBox())!.height,
					).toBeGreaterThanOrEqual(44);
					await page.goBack();
					await expect(list).not.toBeVisible();
					await expect(
						page.getByRole("dialog", { name: "Timeline tools", exact: true }),
					).toBeVisible();
					await expect(aspect).toBeFocused();
				} else {
					await page.keyboard.press("Escape");
					await expect(list).not.toBeVisible();
					await expect(aspect).toBeFocused();
					await aspect.click();
					await list.getByRole("option").first().focus();
					await expect(list.getByRole("option").first()).toBeFocused();
					await page.keyboard.press("Space");
					await expect(list).toBeVisible();
					await expect(aspect).toHaveAttribute("data-value", before!);
					await page.keyboard.press("Space");
					await page.keyboard.press("Escape");
				}
				await chooseOption(aspect, "1:1");
				await expect(aspect).toHaveAttribute("data-value", "1:1");
				await aspect.click();
				await list.getByRole("option").first().focus();
				await page.keyboard.press("Home");
				await page.keyboard.press("Enter");
				await expect(list).not.toBeVisible();
				await expect(aspect).toBeFocused();
				await aspect.click();
				await page.screenshot({ path: info.outputPath("options-open.png") });
				if (!phone) {
					await page.setViewportSize({ width: 320, height: 900 });
					// Toolbar changes composition at editor boundary: close when its opener unmounts.
					await expect(popup).not.toBeVisible();
					await page.getByRole("button", { name: "More tools", exact: true }).click();
					await page.getByRole("combobox", { name: "Aspect ratio", exact: true }).click();
					await expect(
						page.getByRole("dialog", { name: "Aspect ratio", exact: true }),
					).toBeVisible();
				}
				await page.keyboard.press("Escape");
				await expect(page.locator('[data-slot="select-popup"]:visible')).toHaveCount(0);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
