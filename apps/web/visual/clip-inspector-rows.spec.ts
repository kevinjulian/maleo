import { chooseOption } from "./options.ts";
/* The clip inspector's properties, as PropertyRows (audit M02).
 *
 * Screenshots show the panel; this drives it. Every amount is a scrubbable
 * number field, related values share a named row, a choice is a select or a
 * segmented control, and turning a flag on reveals the rows it governs. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID, FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test.describe("a scene", () => {
	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, resolve(HERE, "fixtures/api-editor-chat.har"));
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
		await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clippanel")).toBeVisible();
	});

	test("transform values are scrubbable fields grouped by context, with no slider", async ({
		page,
	}) => {
		const panel = page.locator(".tl2-clippanel");
		await panel.locator('.tl2-clip-railbtn[aria-label="Transform"]').click();
		const rows = {
			Position: ["X offset", "Y offset"],
			Size: ["Width", "Height"],
			Rotation: ["Rotation"],
		};
		for (const [row, fields] of Object.entries(rows)) {
			const group = panel.getByRole("group", { name: row, exact: true });
			for (const field of fields)
				await expect(group.getByRole("spinbutton", { name: field, exact: true })).toBeVisible();
		}
		await expect(
			panel
				.getByRole("group", { name: "Size", exact: true })
				.getByRole("button", { name: "Lock aspect ratio" }),
		).toBeVisible();
		await expect(panel.getByRole("slider")).toHaveCount(0);
		const width = panel.getByRole("spinbutton", { name: "Width", exact: true });
		await width.fill("60");
		await width.press("Enter");
		await expect(width).toHaveValue("60");
		await width.focus();
		await page.keyboard.press("ArrowDown");
		await expect(width).toHaveValue("59");
	});

	test("fit is a segmented choice", async ({ page }) => {
		const panel = page.locator(".tl2-clippanel");
		await panel.locator('.tl2-clip-railbtn[aria-label="Transform"]').click();
		const fit = panel.getByRole("group", { name: "Fit", exact: true });
		await fit.getByRole("button", { name: "Contain", exact: true }).click();
		await expect(fit.getByRole("button", { name: "Contain", exact: true })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
	});

	test("enabling reveal shows the rows it governs", async ({ page }) => {
		const panel = page.locator(".tl2-clippanel");
		await panel.locator('.tl2-clip-railbtn[aria-label="Shot"]').click();
		await expect(panel.getByRole("combobox", { name: "Shot" })).toBeVisible();
		await expect(panel.getByRole("combobox", { name: "Direction" })).toHaveCount(0);
		const enabled = panel.getByRole("switch", { name: "Enabled" });
		await enabled.click();
		await expect(enabled).toBeChecked();
		await expect(panel.getByRole("combobox", { name: "Direction" })).toBeVisible();
		await expect(panel.getByRole("spinbutton", { name: "Intensity", exact: true })).toBeVisible();
	});
});

/* The text overlay's own style, in the embedded item editor. */
test.describe("a text overlay", () => {
	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, resolve(HERE, "fixtures/api.har"));
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
		await page.locator("[data-vui-slot='item']").first().click({ force: true });
		await expect(page.locator('.tl2-clip-head [data-slot="panel-header-title"]')).toHaveText(
			"Text",
		);
	});

	test("style properties are named rows with exact values", async ({ page }) => {
		const props = page.locator(".fc-em-props");
		const size = props.getByRole("spinbutton", { name: "Font size" });
		await size.fill("72");
		await expect(size).toHaveValue("72");
		await expect(props.getByRole("combobox", { name: "Font" })).toBeVisible();
		const align = props.getByRole("combobox", { name: "Align" });
		await chooseOption(align, "left");
		await expect(align).toHaveAttribute("data-value", "left");
	});

	test("a colour row opens the picker with the brand colour on offer", async ({ page }) => {
		const props = page.locator(".fc-em-props");
		await props.getByRole("button", { name: "Text color" }).click();
		await expect(page.getByRole("button", { name: "Brand", exact: true })).toBeVisible();
		await page.getByRole("textbox", { name: "Text hex" }).fill("112233ff");
		await expect(props.getByRole("button", { name: "Text color" })).toContainText("#112233FF");
		await page.keyboard.press("Escape");
		await expect(page.getByRole("button", { name: "Brand", exact: true })).toHaveCount(0);
	});
});
