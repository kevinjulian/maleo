/* The mobile inspector sheet is padded, and padded from a token.
 *
 * `.vui-sheet-body` declared `overflow: auto` and a max height and nothing
 * else, so every field in every mobile inspector in the repository — content
 * editor, Template Studio, Motion Studio — met the sheet's wall with no gap.
 *
 * Driven against the running app rather than against a fixture carrying a copy
 * of the rule. A probe that ships its own stylesheet and then measures it
 * agrees with itself and asserts nothing, which `web-visual-regression` already
 * records as a failure mode in its own words.
 *
 * Both halves are asserted because they fail differently. A hard-coded padding
 * would satisfy the first and quietly break the package's contract, which says
 * `.vui-*` class names are private and consumers are not to fork package CSS:
 * an unpaddable sheet body is a gap in the package, and a consumer reaching
 * past it is what the contract forbids.
 */
import { expect, test, devices, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const TOKEN = "--vui-sheet-body-padding";

test.describe("phone", () => {
	test.use(
		(() => {
			const { defaultBrowserType, ...options } = devices["iPhone 15"];
			void defaultBrowserType;
			return { ...options, deviceScaleFactor: 1 };
		})(),
	);

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	});

	/** Template Studio, with its inspector sheet open at a category. */
	async function openInspectorSheet(page: Page): Promise<void> {
		await page.keyboard.press("Alt+Digit4");
		await page.locator(".tl2-template-create").click();
		await expect(page.locator(".tl2-template-editor-modal")).toBeVisible();
		await page.locator("[data-vui-slot='mobile-actions'] [data-studio-category]").first().click();
		await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	}

	test("the inspector sheet insets its content instead of meeting its own wall", async ({
		page,
	}) => {
		await openInspectorSheet(page);
		const body = page.locator(".vui-sheet-body").first();
		/* Stated, not derived: 8px is `--vui-space`, and writing it out is what
		   makes this fail if the token's default changes rather than agreeing with
		   whatever the stylesheet happens to say. */
		expect(await body.evaluate((n) => getComputedStyle(n).padding)).toBe("8px");
	});

	test("a consumer sets the inset on a VUI root, without naming a private class", async ({
		page,
	}) => {
		await openInspectorSheet(page);
		const body = page.locator(".vui-sheet-body").first();
		/* The root that OWNS this sheet, not the first on the page: a sheet is
		   portalled onto its own body-level host, which carries its own
		   `data-vui-root` so the region's rules and a consumer's token overrides
		   still resolve. Setting the token on the workspace's root would leave the
		   sheet unaffected and read as the token not working. */
		await body.evaluate((n, token) => {
			(n.closest("[data-vui-root]") as HTMLElement).style.setProperty(token, "20px");
		}, TOKEN);
		expect(await body.evaluate((n) => getComputedStyle(n).padding)).toBe("20px");
	});
});
