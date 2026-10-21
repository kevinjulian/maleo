/* The VUI surfaces with motion genuinely turned off.
 *
 * The other suites stub `matchMedia` in `beforeEach`, which is JavaScript only
 * and never reaches a CSS `prefers-reduced-motion` query — so the package's own
 * reduced-motion rules went unexercised. This project sets the real media
 * feature through Playwright's emulation.
 *
 * Two things are under test and they pull in opposite directions: that
 * nonessential animation is actually gone, and that nothing DEPENDS on the
 * animation to become usable. A surface that only reaches its final position by
 * transitioning to it is broken here, and that is the failure worth catching.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { expectRenders } from "./vui-geometry.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test.beforeEach(async ({ page, context }) => {
	/* Emulated on the page rather than through the project's `reducedMotion`
	   fixture option: that option did not reach the CSS media feature here — a
	   bare page under it still reported `no-preference` — and a guard that
	   silently tests ordinary motion is worse than none. The first test below
	   asserts the feature is actually set, so this cannot rot back. */
	await page.emulateMedia({ reducedMotion: "reduce" });
	await replayApi(context, HAR);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
});

test("the media feature really is reduced", async ({ page }) => {
	/* Guards the project itself: without the emulation every assertion below
	   would pass while testing ordinary motion. */
	expect(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches)).toBe(
		true,
	);
});

test("workspace and sheet declare no nonessential motion", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	await expect(page.locator(".tl2-template-editor-modal")).toBeVisible();

	const durations = await page.evaluate(() => {
		const out: { selector: string; transition: string; animation: string }[] = [];
		for (const element of Array.from(
			document.querySelectorAll("[data-vui-root], [data-vui-root] *"),
		)) {
			const style = getComputedStyle(element);
			/* Perceptible motion, not literally non-zero. Reduced-motion rules
			   conventionally collapse to a near-zero duration such as `1e-06s`
			   rather than `0s`, because `0s` can suppress the `transitionend`
			   event that code sometimes waits on. Anything at or below 10ms is
			   imperceptible and is that idiom; anything above it is real motion. */
			const running = [style.transitionDuration, style.animationDuration]
				.flatMap((value) => value.split(",").map((part) => Number.parseFloat(part)))
				.some((seconds) => Number.isFinite(seconds) && seconds > 0.01);
			if (running)
				out.push({
					selector: element.className.toString().split(" ")[0] ?? element.tagName,
					transition: style.transitionDuration,
					animation: style.animationDuration,
				});
		}
		return out;
	});
	expect(
		durations,
		`VUI descendants still animate under reduced motion: ${JSON.stringify(durations)}`,
	).toEqual([]);
});

test("the editor and its sheet stay fully operable with transitions disabled", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	const trigger = page.locator(".tl2-template-create");
	await trigger.click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();

	/* Reached its final geometry without a transition to carry it there. */
	await expectRenders(page, "[data-vui-slot='dialog']", "workspace dialog under reduced motion");
	/* Scoped to the modal: `data-vui-slot="ruler"` is the published contract for
	   every timeline in the app, and the editor's own ruler is still mounted
	   behind the overlay — covered, inert, and not what this is about. */
	await expectRenders(
		page,
		".tl2-template-editor-modal [data-vui-slot='ruler']",
		"timeline ruler under reduced motion",
	);

	/* The timeline still responds. */
	const ruler = modal.locator("[data-vui-slot='ruler']");
	const box = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: box.width / 2, y: box.height / 2 } });
	expect(Number(await ruler.getAttribute("aria-valuenow"))).toBeGreaterThan(0);

	/* And the overlay still dismisses and restores its opener. */
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();
});
