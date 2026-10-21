/* The helper's own coverage.
 *
 * A geometry assertion that cannot fail is worse than none: it reports green
 * over a collapsed or covered surface. These drive it against fixtures built to
 * be exactly wrong in each way it is supposed to catch, so a future loosening
 * of the helper fails here rather than passing silently everywhere.
 */
import { expect, test, type Page } from "@playwright/test";
import {
	expectFillsViewport,
	expectRenders,
	expectWithinViewport,
	surfaceGeometry,
} from "./vui-geometry.ts";

async function fixture(page: Page, body: string): Promise<void> {
	await page.setContent(`<!doctype html><html><head><style>
		* { margin: 0; padding: 0; box-sizing: border-box; }
		.good { width: 200px; height: 80px; background: #444; }
		.collapsed { width: 0; height: 0; }
		.covered { position: absolute; top: 0; left: 0; width: 200px; height: 80px; }
		/* A SIBLING lid, not a child: a descendant at the centre is a legitimate
		   delegation and the helper accepts it. Occlusion is another element. */
		.lid { position: absolute; top: 0; left: 0; width: 200px; height: 80px; background: #900; }
		.overflowing { position: absolute; left: 0; width: 200px; height: 80px; top: 100vh; background: #444; }
		.fills { position: fixed; inset: 0; background: #123; }
	</style></head><body>${body}</body></html>`);
}

test("accepts a surface that has a box and is topmost at its centre", async ({ page }) => {
	await fixture(page, `<div class="good" id="target">content</div>`);
	await expectRenders(page, "#target");
	await expectWithinViewport(page, "#target");
});

test("accepts a descendant as the hit, because markup may delegate the centre", async ({
	page,
}) => {
	await fixture(
		page,
		`<div class="good" id="target"><span style="display:block;width:100%;height:100%">child</span></div>`,
	);
	const result = await surfaceGeometry(page, "#target");
	expect(result.hit).toBe("self");
});

test("rejects a collapsed surface", async ({ page }) => {
	await fixture(page, `<div class="collapsed" id="target"></div>`);
	await expect(expectRenders(page, "#target")).rejects.toThrow(/zero width|zero height/);
});

test("rejects a surface that is absent from the layout", async ({ page }) => {
	await fixture(page, `<div class="good"></div>`);
	await expect(expectRenders(page, "#missing")).rejects.toThrow(/not in the layout/);
});

test("rejects a surface covered by something else", async ({ page }) => {
	await fixture(page, `<div class="covered" id="target"></div><div class="lid"></div>`);
	await expect(expectRenders(page, "#target")).rejects.toThrow(/covered by/);
});

test("rejects a surface that runs past the bottom of the viewport", async ({ page }) => {
	await fixture(page, `<div class="overflowing" id="target"></div>`);
	await expect(expectWithinViewport(page, "#target")).rejects.toThrow(/runs past the bottom/);
});

test("accepts an exact fullscreen surface and rejects one that leaves a gap", async ({ page }) => {
	await fixture(page, `<div class="fills" id="full"></div><div class="good" id="inset"></div>`);
	await expectFillsViewport(page, "#full");
	await expect(expectFillsViewport(page, "#inset")).rejects.toThrow(/does not fill the viewport/);
});
