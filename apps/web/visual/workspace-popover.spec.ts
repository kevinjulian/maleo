import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test.beforeEach(async ({ context }) => replayApi(context, HAR));

for (const width of [320, 1440]) {
	test(`workspace switcher stays reachable and returns focus at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		const trigger =
			width === 320
				? page.locator("header.ui-topbar .ws-current")
				: page.locator(".sidebar .ws-current");
		await expect(trigger).toBeVisible();
		await trigger.click();
		const popup = page.locator(".ws-panel");
		await expect(popup).toBeVisible();
		await expect(popup.getByRole("button", { name: /Fixture Workspace Two/ })).toBeVisible();
		const box = await popup.boundingBox();
		expect(box).not.toBeNull();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width);
		await page.keyboard.press("Escape");
		await expect(popup).toBeHidden();
		await expect(trigger).toBeFocused();
		await trigger.click();
		await popup.getByRole("button", { name: /Fixture Workspace Two/ }).click();
		await expect(popup).toBeHidden();
		await expect(trigger).toHaveAttribute("title", "Workspace: Fixture Workspace Two");
	});
}

test("drawer workspace popup stays above drawer scrim", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/content");
	await page.getByRole("button", { name: "toggle menu" }).click();
	const drawer = page.locator(".nav-drawer.ui-sheet-open");
	await expect(drawer).toBeVisible();
	await drawer.locator(".ws-current").click();
	const popup = page.locator(".ws-panel");
	await expect(popup).toBeVisible();
	const hit = await popup.evaluate((el) => {
		const rect = el.getBoundingClientRect();
		return (
			document.elementFromPoint(rect.x + rect.width / 2, rect.y + 16)?.closest(".ws-panel") === el
		);
	});
	expect(hit).toBe(true);
});
