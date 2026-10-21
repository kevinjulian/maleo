import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { acknowledgeSaves } from "./chat-server.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

for (const width of [320, 1440]) {
	test(`template pickers place, dismiss and restore focus at ${width}px`, async ({
		page,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await replayApi(page.context(), HAR);
		await acknowledgeSaves(page, FIXTURE_PROJECT_ID);
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		await page.keyboard.press("Alt+Digit4");
		await page.locator(".tl2-template-create").click();
		const editor = page.locator(".tl2-template-editor-modal");
		await expect(editor).toBeVisible();
		const category =
			width < 640
				? page.locator("[data-vui-slot='mobile-actions']")
				: editor.locator(".tl2-template-editor-form");
		await category.getByRole("button", { name: "Opening · section 1" }).click();

		const title = page.getByRole("button", { name: "Choose Opening title" });
		await title.click();
		const popup = page.locator('[data-slot="popover-content"]');
		await expect(popup).toBeVisible();
		await expect(popup).toHaveAttribute("data-open", "");
		const box = await popup.boundingBox();
		expect(box!.x).toBeGreaterThanOrEqual(0);
		expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1);
		await popup.evaluate((element) =>
			Promise.all(element.getAnimations().map((animation) => animation.finished)),
		);
		await page.screenshot({ path: testInfo.outputPath(`title-popover-${width}.png`) });
		await page.keyboard.press("Escape");
		await expect(popup).toHaveCount(0);
		await expect(title).toBeFocused();

		await category.getByRole("button", { name: "Section entries" }).click();
		const sfx = page.getByRole("button", { name: "Choose Section entry SFX" });
		await sfx.click();
		await expect(popup).toBeVisible();
		await expect(popup.getByPlaceholder("Search stock SFX…")).toBeVisible();
		await popup.evaluate((element) =>
			Promise.all(element.getAnimations().map((animation) => animation.finished)),
		);
		await page.screenshot({ path: testInfo.outputPath(`sfx-popover-${width}.png`) });
		await page.keyboard.press("Escape");
		await expect(popup).toHaveCount(0);
		await expect(sfx).toBeFocused();
	});
}
