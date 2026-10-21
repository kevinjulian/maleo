import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.beforeEach(async ({ context }) => replayApi(context, HAR));

test("Maleo identity survives desktop collapse and phone drawer navigation", async ({ page }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/content");
	await expect(page).toHaveTitle("Maleo");
	await expect(page.locator(".sidebar")).toContainText("Maleo");
	await page.getByRole("button", { name: "collapse sidebar", exact: true }).click();
	await expect(page.locator(".sidebar").getByRole("img", { name: "Maleo" })).toBeVisible();
	await page.reload();
	await expect(page.locator(".sidebar").getByRole("img", { name: "Maleo" })).toBeVisible();
	await page.setViewportSize({ width: 320, height: 900 });
	await page.getByRole("button", { name: "toggle menu", exact: true }).click();
	const drawer = page.locator(".nav-drawer.ui-sheet-open");
	await expect(drawer).toContainText("Maleo");
	await expect(drawer.locator('img[src="/maleo-icon-192.png"]')).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(drawer).toHaveCount(0);
	await expect(page.getByRole("button", { name: "toggle menu", exact: true })).toBeFocused();
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto("/god/general?workspace=default");
	await page.getByRole("button", { name: "expand sidebar", exact: true }).click();
	await expect(page.locator(".god-sidebar")).toContainText("Maleo · God Mode");
	await expect(page.locator('.god-sidebar img[src="/maleo-icon-192.png"]')).toBeVisible();
});

test("sign-in displays supplied logo and remains usable at 320px", async ({ page }) => {
	await page.route("**/api/auth/get-session", (route) => route.fulfill({ json: null }));
	await page.route("**/api/auth-state", (route) => route.fulfill({ json: { hasAccounts: true } }));
	await page.setViewportSize({ width: 320, height: 900 });
	await page.goto("/login");
	await expect(page.locator(".signin-card")).toContainText("Maleo");
	await expect(page.locator('.signin-card img[src="/maleo-icon-192.png"]')).toBeVisible();
	await page.getByLabel("Email").fill("fixture@example.com");
	await page.getByLabel("Password").fill("synthetic-password");
	await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true,
	);
});

test("maskable artwork stays within circle, rounded-square and squircle masks", async ({
	page,
}) => {
	await page.goto("/login");
	const clipped = await page.evaluate(async () => {
		const image = new Image();
		image.src = "/maleo-maskable-512.png";
		await image.decode();
		const canvas = document.createElement("canvas");
		canvas.width = canvas.height = 512;
		const context = canvas.getContext("2d")!;
		context.drawImage(image, 0, 0);
		const pixels = context.getImageData(0, 0, 512, 512).data;
		const results = { circle: 0, roundedSquare: 0, squircle: 0 };
		for (let y = 0; y < 512; y++)
			for (let x = 0; x < 512; x++) {
				const index = (y * 512 + x) * 4;
				if (pixels[index]! < 20 && pixels[index + 1]! < 20 && pixels[index + 2]! < 20) continue;
				const dx = Math.abs(x + 0.5 - 256),
					dy = Math.abs(y + 0.5 - 256);
				if (Math.hypot(dx, dy) > 204.8) results.circle++;
				if (Math.hypot(Math.max(dx - 128, 0), Math.max(dy - 128, 0)) > 128) results.roundedSquare++;
				if ((dx / 256) ** 4 + (dy / 256) ** 4 > 1) results.squircle++;
			}
		return results;
	});
	expect(clipped).toEqual({ circle: 0, roundedSquare: 0, squircle: 0 });
});
