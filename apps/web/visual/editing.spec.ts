/* The edits still work, driven for real.
 *
 * `gestures.spec.ts` covers the pointer mechanics — the hover cursor, a ruler
 * drag, a marquee, the zoom controls. This covers the EDITS on the other side of
 * them, because the render-budget change rebuilt the path every one of them runs
 * through: the clips moved into memoized components, the handlers into a context,
 * the selection into a store, and the playhead off React entirely. None of that
 * may change what a gesture does, and none of it is visible in a screenshot.
 *
 * Deliberately one test rather than seven: these are steps of one session, and
 * splitting them would reload the editor six more times to assert the same
 * things about the same two clips.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
});

test("select, drag, resize, split, undo, redo, zoom, playback", async ({ page }) => {
	const errors: string[] = [];
	page.on("pageerror", (e) => errors.push(e.message));
	const clips = page.locator(
		"[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']",
	);
	const firstId = await clips.first().getAttribute("data-clipid");
	const first = page.locator(`[data-clipid="${firstId}"]`);

	// select
	await first.click();
	await expect(first).toHaveClass(/\bon\b/);

	// drag: the clip's left edge moves
	await first.click();
	const before = (await first.boundingBox())!;
	const leftBefore = Number.parseFloat(
		await first.evaluate((element) => (element as HTMLElement).style.left),
	);
	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.mouse.move(before.x + before.width / 2 + 120, before.y + before.height / 2, {
		steps: 8,
	});
	await page.mouse.up();
	await page.waitForTimeout(200);
	const dragged = (await first.boundingBox())!;
	const leftDragged = Number.parseFloat(
		await first.evaluate((element) => (element as HTMLElement).style.left),
	);
	expect(Math.abs(dragged.x - before.x)).toBeGreaterThan(20);
	expect(Math.abs(leftDragged - leftBefore)).toBeGreaterThan(20);

	// undo puts it back
	const undoButton = page.getByTitle("Undo (⌘Z)");
	await expect(undoButton).toBeEnabled();
	await undoButton.click();
	await page.waitForTimeout(300);
	const leftUndone = Number.parseFloat(
		await first.evaluate((element) => (element as HTMLElement).style.left),
	);
	expect(Math.abs(leftUndone - leftBefore)).toBeLessThan(1);

	// redo reapplies one logical drag, then undo returns to baseline again.
	await page.keyboard.press("ControlOrMeta+Shift+z");
	await page.waitForTimeout(300);
	const leftRedone = Number.parseFloat(
		await first.evaluate((element) => (element as HTMLElement).style.left),
	);
	expect(Math.abs(leftRedone - leftDragged)).toBeLessThan(1);
	await page.keyboard.press("ControlOrMeta+z");
	await page.waitForTimeout(300);

	// resize commits through same document/history path and one undo restores it.
	await first.click();
	const resizeBefore = (await first.boundingBox())!;
	const handle = first.locator("[data-vui-slot^='trim-']").last();
	const handleBox = (await handle.boundingBox())!;
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		handleBox.x + handleBox.width / 2 + 48,
		handleBox.y + handleBox.height / 2,
		{ steps: 6 },
	);
	await page.mouse.up();
	await page.waitForTimeout(250);
	expect((await first.boundingBox())!.width).toBeGreaterThan(resizeBefore.width);
	await page.keyboard.press("ControlOrMeta+z");
	await page.waitForTimeout(300);
	expect(Math.abs((await first.boundingBox())!.width - resizeBefore.width)).toBeLessThan(6);

	// split at the playhead adds a clip, undo removes it. The playhead has to be
	// INSIDE the clip, so it is seeked to the clip middle rather than to a fixed x.
	const countBefore = await clips.count();
	const box = (await first.boundingBox())!;
	const ruler = (await page.locator("[data-vui-slot='ruler']").boundingBox())!;
	await first.click();
	// A ruler scrub keeps the selection, so the clip stays selected across it —
	// and the playhead then sits over the clip, which is why it is not re-clicked.
	await page
		.locator("[data-vui-slot='ruler']")
		.click({ position: { x: box.x + box.width / 2 - ruler.x, y: 6 } });
	await page.keyboard.press("s");
	await page.waitForTimeout(300);
	const countAfterSplit = await clips.count();
	await page.keyboard.press("ControlOrMeta+z");
	await page.waitForTimeout(300);
	console.log(
		`[editing] clips ${countBefore} -> split ${countAfterSplit} -> undo ${await clips.count()}`,
	);

	// zoom changes the drawn width
	const widthBefore = (await first.boundingBox())!.width;
	await page
		.getByTitle(/Zoom in/i)
		.first()
		.click();
	await page.waitForTimeout(200);
	const widthAfter = (await first.boundingBox())!.width;
	expect(widthAfter).toBeGreaterThan(widthBefore);

	/* Playback advances the playhead and stops. Measured from the transform the
	   playhead is positioned by, not from its viewport box: the timeline
	   auto-scrolls to follow it, so the box can move left while the time moves
	   forward. */
	const playheadX = async (): Promise<number> =>
		page.locator("[data-vui-slot='playhead']").evaluate((e) => {
			const m = /translateX\(([-0-9.]+)px\)/.exec((e as HTMLElement).style.transform);
			return m ? Number(m[1]) : Number.NaN;
		});
	const at = await playheadX();
	await page.locator("[data-transport='play']").click();
	/* Wait for real motion before pausing: bundle/media readiness varies under
	   full CI load. Restarting at the end may move the playhead backwards. */
	await expect.poll(async () => Math.abs((await playheadX()) - at)).toBeGreaterThan(1);
	await page.locator("[data-transport='play']").click();
	expect(errors).toEqual([]);
});

test("VUI pilot scene range moves, resizes, cancels, and records one undo step", async ({
	page,
}) => {
	/* The fixture project is two overlay clips and no scenes, so the base lane
	 * starts empty and the pilot has nothing to drive. Adding one through the
	 * lane's own context menu is the real operator path to a scene, and it keeps
	 * this test off the shared HAR that every screenshot baseline also reads. */
	const baseLane = page.locator("[data-vui-slot='row'][data-vui-row='scene']");
	await expect(baseLane).toBeVisible();
	const laneBox = (await baseLane.boundingBox())!;
	/* Dispatched on the lane rather than clicked at a point: the menu opens only
	 * when the event targets the lane itself, and an empty lane is covered by its
	 * own "Drop media here" placeholder. The gesture is the setup here, not the
	 * behaviour under test — everything below drives real mouse input. */
	await baseLane.dispatchEvent("contextmenu", {
		clientX: laneBox.x + 40,
		clientY: laneBox.y + laneBox.height / 2,
		button: 2,
	});
	await page.locator(".tl2-ctxmenu").getByText("Scene here").click();
	/* Adding a scene opens the scene editor over the timeline. Dismiss it, or its
	 * frame intercepts every pointer action below. */
	const drawer = page.locator(".tl2-scenedrawer");
	if (await drawer.count()) {
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
	}

	/* Slot-based, not class-based: the base track's scenes are on the same
	   surface as every other clip now, and `data-vui-slot` is the published
	   contract for reaching one. The row is named the same way. */
	const scene = page
		.locator('[data-vui-slot="row"][data-vui-row="scene"] [data-vui-slot="item"]')
		.first();
	await expect(scene).toBeVisible();
	await scene.click();
	const original = (await scene.boundingBox())!;

	await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(140);
	await page.mouse.move(original.x + original.width / 2 + 100, original.y + original.height / 2, {
		steps: 6,
	});
	/* The threshold is 10px, not the drag's 100px: this fixture's timeline is
	 * short, so a scene added near its start runs out of room and the adapter's
	 * clamp stops it well before the pointer. What is under test is that the drag
	 * moves it at all and that the cancel puts it back exactly. */
	expect(Math.abs((await scene.boundingBox())!.x - original.x)).toBeGreaterThan(10);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect
		.poll(async () => Math.abs((await scene.boundingBox())!.x - original.x))
		.toBeLessThan(1);

	await page.mouse.move(original.x + original.width / 2, original.y + original.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(140);
	await page.mouse.move(original.x + original.width / 2 + 100, original.y + original.height / 2, {
		steps: 6,
	});
	await page.mouse.up();
	await expect
		.poll(async () => Math.abs((await scene.boundingBox())!.x - original.x))
		.toBeGreaterThan(10);
	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(async () => Math.abs((await scene.boundingBox())!.x - original.x))
		.toBeLessThan(1);

	const resizeStart = (await scene.boundingBox())!;
	const handle = scene.locator('[data-vui-slot="trim-end"]');
	const handleBox = (await handle.boundingBox())!;
	await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(140);
	/* Dragged LEFT, because by this point the scene fills the timeline and its end
	 * has nowhere to extend to — the adapter clamps it to the project duration.
	 * Shrinking exercises the same commit path with headroom to move in. */
	await page.mouse.move(
		handleBox.x + handleBox.width / 2 - 70,
		handleBox.y + handleBox.height / 2,
		{ steps: 6 },
	);
	await page.mouse.up();
	await expect
		.poll(async () => (await scene.boundingBox())!.width)
		.toBeLessThan(resizeStart.width - 10);
	await page.keyboard.press("ControlOrMeta+z");
	await expect
		.poll(async () => Math.abs((await scene.boundingBox())!.width - resizeStart.width))
		.toBeLessThan(6);
});

test("a scene drag interrupted by lost pointer capture restores instead of committing", async ({
	page,
}) => {
	/* The browser can take a capture away mid-gesture — a system dialog, another
	   pointer claiming the element. `pointercancel` has its own coverage on the
	   Motion keyframes; this is the other terminal path.
	   Driven on the content scene pilot rather than the template, because only
	   this consumer renders the in-flight draft — a template range commits on the
	   terminal phase and so does not move until the gesture ends, which is
	   exactly the state this test needs to interrupt. */
	const baseLane = page.locator("[data-vui-slot='row'][data-vui-row='scene']");
	await expect(baseLane).toBeVisible();
	const laneBox = (await baseLane.boundingBox())!;
	await baseLane.dispatchEvent("contextmenu", {
		clientX: laneBox.x + 40,
		clientY: laneBox.y + laneBox.height / 2,
		button: 2,
	});
	await page.locator(".tl2-ctxmenu").getByText("Scene here").click();
	const drawer = page.locator(".tl2-scenedrawer");
	if (await drawer.count()) {
		await page.keyboard.press("Escape");
		await expect(drawer).toBeHidden();
	}

	const scene = page
		.locator('[data-vui-slot="row"][data-vui-row="scene"] [data-vui-slot="item"]')
		.first();
	await expect(scene).toBeVisible();
	await scene.click();
	const before = (await scene.boundingBox())!;

	await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(140);
	await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2, {
		steps: 6,
	});
	expect(
		Math.abs((await scene.boundingBox())!.x - before.x),
		"the drag never moved the scene",
	).toBeGreaterThan(10);

	/* Take the capture away, exactly as the browser would — from the SURFACE,
	   which is what holds it. The item element is not party to the gesture at
	   all, which is the whole point of the arrangement: it may re-render, change
	   lane, or unmount mid-drag and the gesture continues. */
	await page
		.locator('[data-vui-slot="timeline-scroller"]')
		.first()
		.evaluate((element) => {
			const owner = element as HTMLElement;
			for (const id of [1, 2]) {
				try {
					owner.releasePointerCapture(id);
				} catch {
					/* not this pointer */
				}
			}
			owner.dispatchEvent(new PointerEvent("lostpointercapture", { bubbles: true, pointerId: 1 }));
		});
	await page.mouse.up();

	await expect
		.poll(async () => Math.abs((await scene.boundingBox())!.x - before.x), {
			message: "lost capture did not restore the scene",
		})
		.toBeLessThan(2);

	/* And the timeline still works afterwards — a leaked gesture would swallow
	   the next one. */
	await scene.click();
	await expect(scene).toHaveAttribute("aria-selected", "true");
});

/* Free clips on the VUI range.
 *
 * The pilot in task 12.6 put ONE kind — the base-track scene — on
 * `VuiTimelineRange`. These two cover what extending that to the free-clip
 * families had to preserve and what it newly makes possible, and neither is
 * reachable from the scene: a scene has one rail and cannot change lane, and the
 * window-listener drag it replaced ended only on `pointerup`, so it had no
 * cancel path at all.
 */
test("a free clip drags across lanes and keeps its new one", async ({ page }) => {
	const clipId = await page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
		.first()
		.getAttribute("data-clipid");
	const clip = page.locator(`[data-clipid="${clipId}"]`);
	await clip.click();
	/* Vertical travel is the CONSUMER's axis: only Maleo knows its lane
	   ordering and its lane heights, and it now MEASURES them rather than holding
	   a constant. The constant it held was 46px while the lanes rendered at 32px,
	   so a drag landed a lane short of the pointer — which is why the distance
	   below is turned into an expected lane by measuring, rather than by dividing
	   by a number this file also has to know. */
	const laneIndexOf = async (): Promise<number> =>
		page
			.locator("[data-vui-slot='row']:not([data-vui-row='scene'])")
			.evaluateAll(
				(lanes, id) => lanes.findIndex((lane) => lane.querySelector(`[data-clipid="${id}"]`)),
				clipId,
			);
	const before = await laneIndexOf();
	const box = (await clip.boundingBox())!;
	const travelPx = 92;
	/* Which lane the pointer will actually be over, from the lanes' own boxes.
	   Measured rather than divided: the editor reads its lane heights from the
	   lanes themselves, because three density rules move them. */
	const expected = await page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene'])")
		.evaluateAll(
			(lanes, at) =>
				lanes.findIndex((lane) => {
					const rect = lane.getBoundingClientRect();
					return at >= rect.top && at < rect.bottom;
				}),
			box.y + box.height / 2 + travelPx,
		);
	expect(expected, "the drag does not reach another lane").toBeGreaterThan(before);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 8, box.y + box.height / 2 + travelPx, { steps: 6 });
	/* Mid-drag it is ALREADY on the destination lane, and that is the rebuild's
	   doing rather than an accident. It could not be before: lanes are separate
	   DOM parents, so a live lane write unmounted the very element the gesture was
	   captured on and arrived back as a cancel. The gesture now lives in the
	   kernel's store and the surface holds capture on the scroller, so the
	   element is free to move between parents while the drag runs. */
	await expect
		.poll(laneIndexOf, { message: "the lane change did not land while the drag was still running" })
		.toBe(expected);
	/* What the drag showed is what the drop does. Asserted against the lane the
	   projection actually reached rather than against a lane this file computed
	   independently: the editor may still route a clip off a lane that does not
	   accept it, and the requirement is that the two agree — a drop that landed
	   somewhere the drag never showed is the defect worth catching. */
	const reached = await laneIndexOf();
	await page.mouse.up();
	/* The clip keeps the lane it reached, and its INDEX may still shift: an
	   untyped lane left empty by the move is not a gap the timeline keeps, so
	   compaction closes it and every lane below moves up one. Asserting the index
	   alone would call that correct behaviour a failure. */
	await expect
		.poll(async () => (await laneIndexOf()) >= before + 1, {
			message: "the drop put the clip back on a lane above the one it came from",
		})
		.toBe(true);
	await expect
		.poll(laneIndexOf, { message: "the drop moved the clip further than the drag had reached" })
		.toBeLessThanOrEqual(reached);
	const landed = await laneIndexOf();
	/* The drop and the compaction it caused are one action: one undo restores
	   both, and leaves nothing else to undo. Redo puts both back. */
	const undo = page.getByTitle("Undo (⌘Z)");
	await undo.click();
	await expect.poll(laneIndexOf).toBe(before);
	await expect(undo, "one undo restored the drop and its normalization").toBeDisabled();
	await page.getByTitle(/^Redo/).click();
	await expect.poll(laneIndexOf).toBe(landed);
});

test("Escape during a free-clip drag restores it rather than committing where it stopped", async ({
	page,
}) => {
	/* Pinned by identity rather than by position. `.first()` re-resolves on every
	   query, and a clip that moves during a drag can stop being the first one in
	   its lane — so the assertion would read a different clip and pass or fail for
	   a reason that has nothing to do with the gesture. */
	const clipId = await page
		.locator("[data-vui-slot='row']:not([data-vui-row='scene']) [data-vui-slot='item']")
		.first()
		.getAttribute("data-clipid");
	const clip = page.locator(`[data-clipid="${clipId}"]`);
	await clip.click();
	const left = async (): Promise<number> =>
		Number.parseFloat(await clip.evaluate((el) => (el as HTMLElement).style.left));
	const before = await left();
	const box = (await clip.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + 140, box.y + box.height / 2, { steps: 8 });
	await expect
		.poll(left, { message: "the drag never moved the clip, so there was nothing to cancel" })
		.not.toBe(before);
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect
		.poll(left, { message: "Escape left the clip where the drag had reached" })
		.toBeCloseTo(before, 1);
	/* A cancelled gesture writes no history. */
	await expect(page.getByTitle("Undo (⌘Z)")).toBeDisabled();
	/* And the gesture is really over: a leaked one swallows the next press. */
	await clip.click();
	await expect(clip).toHaveClass(/\bon\b/);
});

test("the content editor's VUI timeline composition", async ({ page }) => {
	/* The content editor is the one surface that composes VUI in `embedded` mode,
	   and this change moved its lanes, clips, trim handles and range gestures onto
	   the package's primitives. Scoped to the timeline rather than to the page for
	   two reasons: a full-page shot also carries the rail, the chat panel and the
	   toolbar and would drift with every unrelated change to any of them — which
	   is exactly the state the app-wide baselines are in — and the preview above
	   it is a live Remotion surface that never settles into a stable frame. */
	const timeline = page.locator(".tl2-content-vui-shell .tl2-timeline");
	await expect(timeline).toBeVisible();
	/* Idle, with nothing selected. Selecting a clip floats the property strip over
	   the lanes, and a baseline whose subject is half-covered by a popover guards
	   the popover's position more than the composition underneath it. */
	await page.evaluate(() => document.fonts.ready);
	await expect(timeline).toHaveScreenshot("vui-content-embedded.png");
});
