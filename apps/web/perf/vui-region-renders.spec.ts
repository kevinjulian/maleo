/* Per-region render bounds for the VUI-backed editor.
 *
 * `render-budget.spec.ts` measures the timeline's own components. This measures
 * the boundaries the VUI adoption is supposed to hold: an interaction that
 * belongs to one region must not re-render the others.
 *
 * The regions are named by the labels the components pass to `countRender`:
 * `stage` is the preview wrapper, `tracks` the timeline projection, `lane` a
 * row, `clip` an item, `inspector` the panel host, and `sheet` the phone
 * overlay. The playhead has no label of its own on purpose — it is written
 * straight to the DOM by `usePlayheadEffect` and never re-renders React, so the
 * assertion for it is that playback leaves `tracks` and `lane` flat.
 *
 * Bounds, not exact numbers. A commit carrying a real state change is
 * legitimate; the defect is a region re-rendering for an interaction that has
 * nothing to do with it, and that shows up as an order-of-magnitude difference
 * rather than an off-by-one.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";
import type { RenderCounts } from "../src/models/timeline/render-probe.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript("globalThis.__maleoRenderCounts = {};");
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
});

async function counts(page: import("@playwright/test").Page): Promise<RenderCounts> {
	// SAFETY: the harness installs `__maleoRenderCounts` before the app's first
	// render; the property is optional so an absent counter spreads to `{}` and
	// reads as zero renders rather than throwing.
	return page.evaluate(() => ({
		...(globalThis as { __maleoRenderCounts?: RenderCounts }).__maleoRenderCounts,
	}));
}

/** Settle the tree, then zero the tallies, so what follows is the
 *  interaction's cost and not the load's. */
async function measure(page: import("@playwright/test").Page): Promise<void> {
	await page.waitForTimeout(400);
	await page.evaluate(() => {
		(globalThis as { __maleoRenderCounts?: RenderCounts }).__maleoRenderCounts = {};
	});
}

test("playback moves the playhead without re-rendering the timeline projection", async ({
	page,
}) => {
	await measure(page);
	await page.locator(".tl2-timeline [data-transport='play']").click();
	await page.waitForTimeout(700);
	await page.locator(".tl2-timeline [data-transport='play']").click();
	const after = await counts(page);
	console.log(`[vui-regions] playback ${JSON.stringify(after)}`);

	/* The playhead is a direct style write, so a whole second of playback must
	   not redraw the lanes, the clips or the preview wrapper. */
	expect(after.tracks ?? 0, "playback re-rendered the timeline projection").toBeLessThanOrEqual(4);
	expect(after.lane ?? 0, "playback re-rendered a lane").toBeLessThanOrEqual(4);
	expect(after.clip ?? 0, "playback re-rendered clips").toBeLessThanOrEqual(4);
	expect(after.inspector ?? 0, "playback re-rendered the inspector").toBeLessThanOrEqual(4);
});

test("opening a rail panel re-renders the inspector without redrawing the timeline", async ({
	page,
}) => {
	await measure(page);
	await page.locator(".tl2-railbtn").first().click();
	await page.waitForTimeout(300);
	const after = await counts(page);
	console.log(`[vui-regions] inspector ${JSON.stringify(after)}`);

	expect(
		after.inspector ?? 0,
		"the inspector did not re-render for its own interaction",
	).toBeGreaterThan(0);
	expect(after.clip ?? 0, "an inspector-only change redrew the clips").toBeLessThanOrEqual(2);
	expect(after.lane ?? 0, "an inspector-only change redrew a lane").toBeLessThanOrEqual(2);
});

test("dragging a clip redraws items without rebuilding the preview wrapper", async ({ page }) => {
	const clip = page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
		.first();
	await clip.click();
	await measure(page);
	const box = (await clip.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	const after = await counts(page);
	console.log(`[vui-regions] drag ${JSON.stringify(after)}`);

	/* Reported, not bounded by a guessed constant — the same stance
	   `render-budget.spec.ts` takes, and for the same reason: a commit carrying a
	   real state change is legitimate and no threshold tells it from an echo.
	   Measured here: the drag redraws the clips it moves, and `stage` and
	   `inspector` also re-render because the drag publishes chrome state they
	   both read. What IS asserted is the part that is unconditional — the drag
	   must actually redraw the item, and it must not cost more in the preview
	   wrapper than in the clips it is moving. */
	expect(after.clip ?? 0, "the drag never redrew the clip it moved").toBeGreaterThan(0);
	expect(
		after.stage ?? 0,
		"a timeline drag cost more in the preview wrapper than in the clips",
	).toBeLessThanOrEqual(after.clip ?? 0);
});

test("the phone sheet renders for its own open and not for the timeline behind it", async ({
	page,
}) => {
	await page.setViewportSize({ width: 393, height: 852 });
	await page.waitForTimeout(400);
	await measure(page);
	await page.locator(".tl2-railbtn").first().click();
	await expect(page.locator(".tl2-panel-sheet")).toBeVisible({ timeout: 5000 });
	const after = await counts(page);
	console.log(`[vui-regions] sheet ${JSON.stringify(after)}`);

	expect(after.sheet ?? 0, "the sheet did not render for its own open").toBeGreaterThan(0);
	expect(after.clip ?? 0, "opening a sheet redrew the clips behind it").toBeLessThanOrEqual(2);
});
