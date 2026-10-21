/* The data callout style panel, as PropertyRows (audit M02, first slice).
 *
 * The screenshot in screens.spec.ts shows it; this drives it. Related values
 * share a named row of scrubbable number fields, and the
 * colour picker is a popup that Escape closes without closing the panel. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, resolve(HERE, "fixtures/api-editor-chat.har"));
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
	await page.locator('.tl2-railbtn[aria-label^="Style"]').first().click();
	await page
		.locator(".fc-style-panel")
		.getByRole("button", { name: "Data callout", exact: true })
		.click();
	await page.locator('.fc-data-style [data-slot="property-row"]').first().waitFor();
});

test("related properties share a named row", async ({ page }) => {
	const panel = page.locator(".fc-data-style");
	const rows = {
		Background: ["Background opacity"],
		Border: ["Border opacity"],
		Shape: ["Radius", "Blur"],
	};
	for (const [row, fields] of Object.entries(rows)) {
		const group = panel.getByRole("group", { name: row, exact: true });
		for (const field of fields)
			await expect(group.getByRole("spinbutton", { name: field, exact: true })).toBeVisible();
	}
	await expect(panel.getByRole("group", { name: "Data and label", exact: true })).toBeVisible();
	await expect(panel.getByRole("slider")).toHaveCount(0);
});

test("a number field takes a typed value and steps with the arrow keys", async ({ page }) => {
	const field = page
		.locator(".fc-data-style")
		.getByRole("spinbutton", { name: "Radius", exact: true });
	await field.fill("20");
	await field.press("Enter");
	await expect(field).toHaveValue("20");
	await field.focus();
	await page.keyboard.press("ArrowUp");
	await expect(field).toHaveValue("21");
});

test("the colour picker is a popup Escape closes, leaving the panel open", async ({ page }) => {
	const panel = page.locator(".fc-data-style");
	await panel.getByRole("button", { name: "Border color" }).click();
	const hex = page.getByRole("textbox", { name: "Border hex" });
	await expect(hex).toBeVisible();
	await hex.fill("112233ff");
	await expect(panel.getByRole("button", { name: "Border color" })).toContainText("#112233FF");
	await page.keyboard.press("Escape");
	await expect(hex).toHaveCount(0);
	await expect(panel).toBeVisible();
	await expect(page.getByText("Auto-save failed")).toHaveCount(0);
});
