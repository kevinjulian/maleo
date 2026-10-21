import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.use({ hasTouch: true });
test.beforeEach(async ({ context }) => replayApi(context, HAR));

for (const width of [320, 1440]) {
	test(`Library search, reference detail and edit at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/library/references");
		const search = page.getByRole("searchbox", { name: "Search images" });
		await expect(search).toBeVisible();
		await expect(page.locator('.catalog-search[data-slot="search-field"]')).toHaveAttribute(
			"data-size",
			"md",
		);
		await expect
			.poll(() =>
				page
					.locator(".catalog-groups button")
					.first()
					.evaluate((element) => parseFloat(getComputedStyle(element).minHeight)),
			)
			.toBeGreaterThanOrEqual(44);
		await page.screenshot({ path: testInfo.outputPath(`library-collection-${width}.png`) });
		await page.locator("[data-slot='media-card']").first().click();
		await expect(page.locator(".catalog-ref-detail")).toBeVisible();
		await page
			.locator(".cv-modal")
			.evaluate((element) =>
				Promise.all(element.getAnimations().map((animation) => animation.finished)),
			);
		await page.screenshot({ path: testInfo.outputPath(`library-detail-${width}.png`) });
		await page.getByRole("button", { name: "Edit" }).click();
		const editor = page.locator(".cv-entity-editor-modal");
		await expect(editor).toBeVisible();
		await expect(page.locator(".catalog-ref-detail")).toHaveCount(0);
		const label = editor.getByRole("textbox", { name: "Label" });
		await expect(label).toHaveAttribute("data-size", "md");
		await label.focus();
		await expect
			.poll(() => label.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)))
			.toBeGreaterThanOrEqual(2);
		await expect(editor.getByRole("button", { name: "Save" })).toHaveAttribute(
			"data-slot",
			"button",
		);
		await editor.evaluate((element) =>
			Promise.all(element.getAnimations().map((animation) => animation.finished)),
		);
		await page.screenshot({ path: testInfo.outputPath(`library-edit-${width}.png`) });
		await page.keyboard.press("Escape");
		await expect(editor).toHaveCount(0);
		await expect(page.locator(".catalog-ref-detail")).toBeVisible();
	});
}
