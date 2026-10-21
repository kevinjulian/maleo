/* The inspector's sub-category headings, as computed style.
 *
 * These exist because the previous set of rules for them matched nothing. The
 * component moved into `@maleo/vui` and began rendering `vui-accordion`, the
 * app's thirteen `tl2-acc*` rules stayed behind, and the headings quietly fell
 * back to package defaults — a 42px header with 12px of inline padding inside a
 * panel that already pads, where the app had asked for its own header height and type.
 * Nothing failed, because nothing was looking.
 *
 * Read from the browser rather than from the stylesheet: what is being claimed
 * is that a rule REACHES the element, and a source assertion cannot tell the
 * difference between a rule that applies and one that names a class nobody
 * renders. That is the whole defect.
 */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

interface SectionMetrics {
	readonly fontSize: string;
	readonly fontWeight: string;
	readonly minHeight: string;
	readonly paddingInline: string;
	readonly bodyPaddingTop: string;
	readonly bodyPaddingBottom: string;
	readonly bodyBorderTop: string;
	readonly labelOverflow: string;
}

/** One open accordion's header and body, as the browser resolves them. */
async function sectionMetrics(page: Page, root: string): Promise<SectionMetrics> {
	return page.evaluate((scope) => {
		const section = document.querySelector(`${scope} .tl2-acc[data-vui-slot="accordion"]`);
		if (!section) throw new Error(`no accordion under ${scope}`);
		const header = getComputedStyle(section.querySelector("[data-vui-slot='accordion-header']")!);
		const bodyEl = section.querySelector("[data-vui-slot='accordion-body']");
		if (!bodyEl)
			throw new Error(`the accordion under ${scope} is closed, so its body cannot be measured`);
		const body = getComputedStyle(bodyEl);
		const label = getComputedStyle(section.querySelector("[data-vui-slot='accordion-label']")!);
		return {
			fontSize: header.fontSize,
			fontWeight: header.fontWeight,
			minHeight: header.minHeight,
			paddingInline: header.paddingLeft,
			bodyPaddingTop: body.paddingTop,
			bodyPaddingBottom: body.paddingBottom,
			bodyBorderTop: body.borderTopWidth,
			labelOverflow: label.textOverflow,
		};
	}, root);
}

test.describe("desktop", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	});

	/* The docked inspector's own metrics: a 340px column that can afford them. */
	test("the docked inspector's sub-categories carry the editor's metrics", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clippanel .tl2-acc").first()).toBeVisible();
		const metrics = await sectionMetrics(page, ".tl2-clippanel");
		expect(metrics, "the docked inspector's sub-category").toMatchObject({
			fontSize: "12px",
			fontWeight: "600",
			minHeight: "44px",
			paddingInline: "12px",
			bodyPaddingTop: "10px",
			bodyPaddingBottom: "16px",
			labelOverflow: "ellipsis",
		});
		// Sections are separated by their own bottom border; the body adds no second
		// rule under its header (spacious-editor-layout).
		expect(Number.parseFloat(metrics.bodyBorderTop), "the body draws no rule of its own").toBe(0);
	});

	test("the template inspector uses timeline defaults", async ({ page }) => {
		await page.keyboard.press("Alt+Digit4");
		await page.locator(".tl2-template-create").click();
		await expect(page.locator(".tl2-template-editor-modal")).toBeVisible();
		const metrics = await sectionMetrics(page, ".tl2-template-editor-form");
		expect(metrics, "the template inspector's sub-category").toMatchObject({
			fontSize: "12px",
			fontWeight: "600",
			minHeight: "44px",
			paddingInline: "12px",
			bodyPaddingTop: "10px",
			bodyPaddingBottom: "16px",
		});
	});

	/* The claim the contract makes, tested against a real stylesheet: an override
	 * moves the component. `happy-dom` cannot answer this — it resolves `var()`
	 * against no loaded sheet — so a unit test would pass whatever the rule said. */
	test("overriding a token moves the accordion", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clippanel .tl2-acc").first()).toBeVisible();
		const before = await sectionMetrics(page, ".tl2-clippanel");
		await page.locator(".tl2-clippanel").evaluate((element) => {
			element.style.setProperty("--vui-accordion-header-height", "60px");
			element.style.setProperty("--vui-accordion-padding-inline", "20px");
		});
		const after = await sectionMetrics(page, ".tl2-clippanel");
		expect(before.minHeight).toBe("44px");
		expect(after.minHeight, "the header height follows its token").toBe("60px");
		expect(after.paddingInline, "the inline padding follows its token").toBe("20px");
	});
});
