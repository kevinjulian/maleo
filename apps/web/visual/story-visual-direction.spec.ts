import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID, WIDTHS } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test.beforeEach(async ({ context }) => {
	await replayApi(context, resolve(HERE, "fixtures/api.har"));
});

for (const width of WIDTHS) {
	test(`story visual direction @ ${width}`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/content/${FIXTURE_PROJECT_ID}/storyboard`);
		const direction = page.locator(".sb-author-shots").first();
		await direction.waitFor({ state: "visible" });
		await expect(direction).toContainText("Fixture Character");
		await expect(direction).toContainText("Archive Door");
		await expect(direction).toHaveScreenshot(`story-visual-direction-${width}.png`);
	});
}
