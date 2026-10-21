/* Surfaces that widened the page at 320px (audit M08, M09).
 *
 * A wide table belongs in a scrolling region and a toolbar wraps; in neither
 * case should the document itself scroll sideways, which pushes the whole app
 * chrome off screen with it.
 */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { mockAdmin } from "./admin-fixture.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

const documentWidth = (page: Page): Promise<number> =>
	page.evaluate(() => document.documentElement.scrollWidth);

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, resolve(HERE, "fixtures/api-editor-chat.har"));
	await mockAdmin(page);
	await page.setViewportSize({ width: 320, height: 800 });
});

for (const section of ["", "/activity", "/transactions", "/policy"]) {
	test(`usage${section || " balance"} fits a 320px page`, async ({ page }) => {
		await page.goto(`/god/usage${section}`);
		await expect(page.locator(".credits-page")).toBeVisible();
		const nav = page.getByRole("navigation", { name: "Usage sections" });
		await expect(nav.getByRole("button")).toHaveCount(4);
		await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
		expect(await documentWidth(page)).toBeLessThanOrEqual(320);
	});
}

test("a wide usage table scrolls inside its region, and the sections are addresses", async ({
	page,
}) => {
	await page.goto("/god/usage/transactions");
	const region = page.getByRole("region", { name: "Transactions" });
	await expect(region).toBeVisible();
	await expect(region.getByRole("table")).toHaveAttribute("data-slot", "table");
	const { scrollWidth, clientWidth } = await region.evaluate((el) => ({
		scrollWidth: el.scrollWidth,
		clientWidth: el.clientWidth,
	}));
	expect(scrollWidth, "the table is wider than its region").toBeGreaterThan(clientWidth);
	expect(await documentWidth(page)).toBeLessThanOrEqual(320);

	const nav = page.getByRole("navigation", { name: "Usage sections" });
	await nav.getByRole("button", { name: "Policy" }).click();
	await expect(page).toHaveURL(/\/usage\/policy(\?|$)/);
	await page.goBack();
	await expect(page).toHaveURL(/\/usage\/transactions(\?|$)/);
	await expect(nav.locator('[aria-current="page"]')).toHaveText("Transactions");
});

test("the script toolbar wraps instead of widening the page", async ({ page }) => {
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}/script`);
	const density = page.getByRole("group", { name: "Density" });
	await expect(density).toBeVisible();
	expect(await documentWidth(page)).toBeLessThanOrEqual(320);
	for (const name of ["Export", "Import"]) {
		const box = await page
			.locator(".sc-file-actions")
			.getByText(name, { exact: true })
			.boundingBox();
		expect(box, name).not.toBeNull();
		expect(box!.x + box!.width, `${name} is on screen`).toBeLessThanOrEqual(320);
	}
	const options = density.getByRole("button");
	const count = await options.count();
	for (let i = 0; i < count; i++) {
		await options.nth(i).click();
		await expect(options.nth(i)).toHaveAttribute("aria-pressed", "true");
		expect(await documentWidth(page), `density ${i}`).toBeLessThanOrEqual(320);
	}
});
