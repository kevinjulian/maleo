/* The editor gestures, driven for real.
 *
 * A screenshot cannot see a drag. These assert that the pointer interactions
 * the timeline is built from still do something: the hover cursor appears, a
 * ruler drag moves the playhead, a drag over empty space draws a marquee, a
 * clip drag relocates the clip, right-clicking a lane opens the add menu, and
 * the zoom and density controls change what they claim to.
 *
 * They exist because `timeline-tracks.tsx` took ownership of exactly this state
 * when it split out of `timeline-editor.tsx`, and all 54 screenshots stayed
 * green through a version of that split where none of it was wired up.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test("the timeline responds to the pointer", async ({ page, context }) => {
	const errs: string[] = [];
	page.on("pageerror", (e) => errs.push("PAGEERROR " + e.message));
	await replayApi(context, HAR);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });

	const lanes = page.locator("[data-vui-slot='rows']");
	const box = (await lanes.boundingBox())!;

	// 1. hover shows the hoverhead
	await page.mouse.move(box.x + 200, box.y + 40);
	await page.waitForTimeout(120);
	const hoverDisplay = await page
		.locator(".tl2-hoverhead")
		.evaluate((e) => getComputedStyle(e).display);
	expect(hoverDisplay, "hover cursor shows while the pointer is over the lanes").not.toBe("none");

	// 2. scrub on the ruler moves the playhead.
	// Read from `transform`, not `left`: the playhead is positioned by a direct
	// style write through a ref (see playhead-handle.ts), because a rendered
	// `left` offset cost a re-render of every clip per frame of playback.
	const before = await page
		.locator("[data-vui-slot='playhead']")
		.evaluate((e) => (e as HTMLElement).style.transform);
	const ruler = page.locator("[data-vui-slot='ruler']");
	const rb = (await ruler.boundingBox())!;
	await page.mouse.move(rb.x + 160, rb.y + 6);
	await page.mouse.down();
	await page.mouse.move(rb.x + 260, rb.y + 6, { steps: 5 });
	await page.mouse.up();
	await page.waitForTimeout(200);
	const after = await page
		.locator("[data-vui-slot='playhead']")
		.evaluate((e) => (e as HTMLElement).style.transform);
	expect(after, "a ruler drag moves the playhead").not.toBe(before);

	// 3. marquee over direct empty lane space. Find a pixel whose hit target is
	// the lane itself; fixed coordinates can land on a clip as fixture timing changes.
	const emptyPoint = await page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene'])")
		.evaluateAll((lanes) => {
			for (const lane of lanes) {
				const rect = lane.getBoundingClientRect();
				for (let x = rect.right - 8; x > rect.left + 8; x -= 16) {
					const y = rect.top + rect.height / 2;
					if (document.elementFromPoint(x, y) === lane) return { x, y };
				}
			}
			throw new Error("fixture has no direct empty lane pixel");
		});
	await page.mouse.move(emptyPoint.x, emptyPoint.y);
	await page.mouse.down();
	await page.mouse.move(emptyPoint.x - 160, emptyPoint.y - 40, { steps: 6 });
	const marquee = await page.locator(".tl2-marquee").count();
	await page.mouse.up();
	expect(marquee, "dragging empty lane space draws a marquee").toBe(1);

	// 4. clip drag
	const clip = page.locator("[data-vui-slot='item']").first();
	const cb = (await clip.boundingBox())!;
	const leftBefore = await clip.evaluate((e) => (e as HTMLElement).style.left);
	await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
	await page.mouse.down();
	await page.mouse.move(cb.x + cb.width / 2 + 90, cb.y + cb.height / 2, { steps: 8 });
	await page.mouse.up();
	await page.waitForTimeout(300);
	const leftAfter = await page
		.locator("[data-vui-slot='item']")
		.first()
		.evaluate((e) => (e as HTMLElement).style.left);
	expect(leftAfter, "a clip drag relocates the clip").not.toBe(leftBefore);

	// 5. right-click empty lane opens the add menu
	await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: "right" });
	await page.waitForTimeout(200);
	await expect(
		page.locator(".tl2-ctxmenu"),
		"right-clicking a lane opens the add menu",
	).toHaveCount(1);

	await page.keyboard.press("Escape");
	await page
		.locator(".tl2-ctxscrim")
		.first()
		.click({ force: true })
		.catch(() => {});
	await page.waitForTimeout(150);

	// 6. zoom
	const zoomBefore = await page.locator(".tl2-zoom-slider").inputValue();
	await page.getByTitle("Zoom in (+)").click();
	const zoomAfter = await page.locator(".tl2-zoom-slider").inputValue();
	expect(Number(zoomAfter), "zoom in raises the zoom level").toBeGreaterThan(Number(zoomBefore));

	// 7. density + insights toggles
	await page.getByTitle(/Toggle compact/).click();
	await expect(
		page.locator(".tl2-timeline"),
		"the density toggle switches the timeline class",
	).toHaveClass(/tl2-density-compact/);

	expect(errs, "no uncaught error during any of it").toEqual([]);
});
