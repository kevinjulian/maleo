import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.beforeEach(async ({ context }) => replayApi(context, HAR));

test("desktop rail preserves current route and keyboard focus when collapsed", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/content");
	const rail = page.locator(".sidebar");
	const content = rail.getByRole("button", { name: "Projects" });
	await expect(content).toHaveAttribute("aria-current", "page");
	// The toggle lives in the top bar now, beside the breadcrumb.
	await page.getByRole("button", { name: "collapse sidebar" }).click();
	await expect(rail).toHaveClass(/collapsed/);
	await page.reload();
	await expect(rail).toHaveClass(/collapsed/);
	await content.focus();
	await expect(content).toBeFocused();
	await expect
		.poll(() => content.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)))
		.toBeGreaterThanOrEqual(2);
	await page.getByRole("button", { name: "expand sidebar" }).click();
	await expect(rail).not.toHaveClass(/collapsed/);
});

test("phone drawer and command entry navigate without losing current state", async ({ page }) => {
	await page.setViewportSize({ width: 320, height: 900 });
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/content");
	await expect(page.locator(".app-nav-active")).toHaveAttribute("aria-current", "page");
	await expect
		.poll(() =>
			page.locator(".nav-drawer").evaluate((el) => getComputedStyle(el).transitionDuration),
		)
		.toBe("0s");
	await page.getByRole("button", { name: "toggle menu" }).click();
	const drawer = page.locator(".nav-drawer.ui-sheet-open");
	await expect(drawer.getByRole("button", { name: "Projects" })).toHaveAttribute(
		"aria-current",
		"page",
	);
	await page.keyboard.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(page.getByRole("button", { name: "toggle menu", exact: true })).toBeFocused();
	await page.keyboard.press("Control+k");
	await expect(page.getByRole("dialog", { name: "command palette" })).toBeVisible();
	await page.locator(".palette-input").fill("god mode");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/god\/general\?workspace=default$/);
	await page.getByRole("button", { name: "toggle menu", exact: true }).click();
	await expect(
		page
			.getByRole("dialog", { name: "God Mode navigation", exact: true })
			.getByRole("button", { name: "General", exact: true }),
	).toHaveAttribute("aria-current", "page");
});
