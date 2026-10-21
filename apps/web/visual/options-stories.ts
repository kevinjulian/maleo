/** Built Storybook acceptance. Run after build-storybook with static server :6006. */
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const output = process.env.MALEO_STORY_PROOF_DIR ?? "/tmp/maleo-options-stories";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
	for (const width of [1440, 320])
		for (const theme of ["light", "dark"] as const) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			const page = await context.newPage();
			const story = async (name: string) => {
				await page.goto(`http://127.0.0.1:6006/iframe.html?id=${name}&viewMode=story`);
				await page.waitForLoadState("networkidle");
			};
			await story("components-select--rich-options");
			const trigger = page.getByRole("combobox");
			await trigger.press("Enter");
			const list = page.locator('[data-slot="select-list"]');
			await expect(list).toBeVisible();
			await expect(list.getByRole("option").last()).toHaveAttribute("aria-disabled", "true");
			await expect(list).toContainText("Video");
			await expect(list).toContainText("Output 16:9");
			expect(await list.locator("svg").count()).toBeGreaterThan(0);
			await page.screenshot({ path: `${output}/rich-${width}-${theme}.png` });
			await page.keyboard.press("Escape");
			await expect(trigger).toBeFocused();
			await story("components-select--beside-input");
			const formChoice = page.getByRole("combobox", { name: "Aspect ratio", exact: true });
			await formChoice.click();
			await page.getByRole("option", { name: "16:9", exact: true }).click();
			await expect(formChoice).toHaveAttribute("data-value", "16:9");
			expect(
				await page
					.locator("form")
					.evaluate((el) => new FormData(el as HTMLFormElement).get("aspect")),
			).toBe("16:9");
			await page.locator("form").evaluate((el) => (el as HTMLFormElement).reset());
			await expect(formChoice).toHaveAttribute("data-value", "9:16");
			await story("components-select--long-list");
			await page.getByRole("combobox").press("Enter");
			const long = page.locator('[data-slot="select-list"]');
			await expect(long.getByRole("option")).toHaveCount(60);
			await long.getByRole("option").first().focus();
			await page.keyboard.press("End");
			await expect(long.getByRole("option").last()).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(page.getByRole("combobox")).toHaveAttribute("data-value", "59");
			await page.getByRole("combobox").press("Enter");
			await page.keyboard.type("Choice 25");
			await expect(long.getByRole("option", { name: "Choice 25", exact: true })).toBeFocused();
			await page.keyboard.press("Enter");
			await expect(page.getByRole("combobox")).toHaveAttribute("data-value", "25");
			await page.keyboard.press("Tab");
			await page.getByRole("combobox").focus();
			await page.keyboard.type("Choice 40");
			await expect(page.getByRole("combobox")).toHaveAttribute("data-value", "40");
			if (width === 1440) {
				await page.getByRole("combobox").click();
				await expect(long).toBeVisible();
				await page.setViewportSize({ width: 320, height: 900 });
				await expect(page.getByRole("dialog", { name: "Aspect ratio", exact: true })).toBeVisible();
				await page.goBack();
				await expect(long).not.toBeVisible();
				await page.setViewportSize({ width, height: 900 });
			}
			await story("components-select--unavailable");
			await expect(page.getByRole("combobox")).toContainText("4:3 (unavailable)");
			await story("components-select--dynamic-options");
			await page.getByRole("combobox").click();
			await page.getByRole("option", { name: "Hold", exact: true }).click();
			await expect(page.getByRole("combobox")).toHaveAttribute("data-value", "hold");
			await story("components-select--dynamic-options");
			await page.getByRole("combobox").focus();
			await expect(page.locator('[data-slot="select-option"]')).toHaveCount(4);
			await page.keyboard.press("h");
			await expect(page.getByRole("combobox")).toHaveAttribute("data-value", "hold");
			await story("components-select--disabled");
			await expect(page.getByRole("combobox")).toBeDisabled();
			await story("components-select--empty");
			await page.getByRole("combobox").click();
			await expect(page.getByText("No options available", { exact: true })).toBeVisible();
			for (const variant of [
				"expanded",
				"rail",
				"drawer",
				"hidden",
				"app-topbar",
				"editor-topbar",
				"save-failed",
			]) {
				await story(`patterns-shell--${variant}`);
				if (["expanded", "rail", "drawer"].includes(variant))
					await expect(page.getByRole("button", { name: "Projects", exact: true })).toHaveAttribute(
						"aria-current",
						"page",
					);
				if (variant === "hidden") await expect(page.getByRole("navigation")).not.toBeVisible();
				if (variant.endsWith("topbar") || variant === "save-failed") {
					const title = page.locator(".ui-topbar-title"),
						bar = page.locator('[data-slot="topbar"]');
					await expect(title).toHaveCSS("white-space", "nowrap");
					await expect(title).toHaveCSS("text-overflow", "ellipsis");
					expect((await title.boundingBox())!.height).toBeLessThanOrEqual(
						(await bar.boundingBox())!.height,
					);
				}
				await page.screenshot({ path: `${output}/${variant}-${width}-${theme}.png` });
			}
			console.log(JSON.stringify({ width, theme, passed: true, output }));
			await context.close();
		}
} finally {
	await browser.close();
}
