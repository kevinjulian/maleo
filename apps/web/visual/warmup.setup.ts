/* Build the client bundle once, before the screenshot workers fan out.
 *
 * The dev server bundles on demand. The webServer readiness probe fetches only
 * the HTML shell, which returns before the script it references exists, so the
 * first wave of workers all trigger the same build and queue behind it. On a
 * cold run that put three of the nine editor rails over the 20s wait for
 * `.tl2-timeline`; the identical suite passed once the bundle was warm.
 *
 * This loads the heaviest route for the same reason the rails do — it is the
 * one that pulls in the timeline — and asserts it rendered. A failure here is
 * a broken environment reported once, rather than an arbitrary handful of
 * screenshot timeouts that look like regressions.
 *
 * It is necessary and NOT sufficient, which three green cold runs were too few
 * to show. Warming the bundle removes most of the cost, but the first wave of
 * workers after a cold bundle cache still pays some of it: a first invocation
 * measures ~23s against ~5s for the next, and one rail would drop out at a 20s
 * wait. So the per-test waits are 60s. That does not hide a regression — a
 * broken editor never renders `.tl2-timeline` and still fails, just later —
 * whereas the 20s wait was reporting load contention as a failed screenshot.
 *
 * There is a second, rarer flake with a different shape, and it is worth
 * recognising rather than chasing: the editor autosaves on a timer, and if
 * that fires mid-shot the HAR has no matching entry, so `notFound: "abort"`
 * rejects it and an "Auto-save failed" banner appears at the top of the
 * editor. Every element below shifts down and the diff looks total. It shows
 * as a real screenshot diff rather than a timeout, so read the diff image
 * before believing it: a banner plus a uniform vertical offset is this, not a
 * regression. Seen once in ~15 runs.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { FONT_HAR, FONT_URL, replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test("client bundle is built", async ({ page, context }) => {
	test.setTimeout(120_000);
	await replayApi(context, HAR);
	await context.routeFromHAR(FONT_HAR, { url: FONT_URL, update: true, updateContent: "embed" });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`, { timeout: 120_000 });
	// Generous: this wait is the build, not a render. The per-test waits stay
	// tight so a real hang still surfaces as one.
	await expect(page.locator(".tl2-timeline")).toBeVisible({ timeout: 120_000 });
	await page.evaluate(() => document.fonts.ready);
});
