/* The editor at phone width.
 *
 * These are assertions, not screenshots, and that is the point. The rest of
 * this directory compares images at desktop widths, which cannot see the two
 * things that actually break a responsive layout: whether a control is still
 * reachable after the panes move, and whether a pane runs past the bottom of
 * the visible viewport. Neither shows up in a diff of a desktop baseline, and
 * neither is visible to the static-render tests in `src`.
 *
 * Run: bun run visual -- --project=mobile
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { itemGeometry, widthOf, EDITOR_TIMELINE, TEMPLATE_TIMELINE } from "./vui-timeline.ts";
import { typedLanesFixture, TYPED_LANES_PROJECT_ID } from "./typed-lanes-fixture.ts";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { expectControls } from "./control-inventory.ts";
import {
	applySafeAreaInsets,
	expectFullscreenWorkspace,
	expectRenders,
	expectWithinViewport,
	surfaceGeometry,
} from "./vui-geometry.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();

test.beforeEach(async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript(`{
		const FROZEN = ${FROZEN_NOW};
		const RealDate = Date;
		class FrozenDate extends RealDate {
			constructor(...args) { super(...(args.length ? args : [FROZEN])); }
			static now() { return FROZEN; }
		}
		globalThis.Date = FrozenDate;
		/* Reduced motion, so a sheet is either open or closed when asserted
		 * rather than mid-transform. The passthrough must stay bound to window or
		 * Chromium throws "Illegal invocation" — and every other query here is
		 * load-bearing, including the max-width query the layout hook reads. */
		const real = globalThis.matchMedia.bind(globalThis);
		globalThis.matchMedia = (q) => q.includes("prefers-reduced-motion")
			? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
			: real(q);
	}`);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
});

/** Does this surface actually draw, and is it the thing under the finger?
 *
 * Both halves are load-bearing, because either alone is a false pass. A
 * non-zero box says nothing about whether anything painted — `.tl2-stage-top`
 * had a perfect box around a hidden child. And being topmost says nothing
 * about being sized — a zero-height element can still be the hit target over
 * nothing. Four of the five defects in the layout work had this shape, and
 * three were found by looking at a screenshot after the suite was green.
 *
 * The hit test accepts the element OR a descendant: asserting the exact node
 * would encode today's markup, and a surface legitimately delegates its centre
 * to a child.
 */
/** The VUI viewport's published geometry, once it has stopped moving.
 *
 * The viewport republishes `data-vui-*` from a `ResizeObserver`, so its first
 * paint is not its final one. A fixed `waitForTimeout` guesses at that settle
 * and loses under parallel load: the zoom tests below read `before` mid-settle,
 * and their focal-time maths then drifts against a value that was never the
 * resting one. Waiting for two identical consecutive samples is the same wait
 * without the guess. */
interface VuiViewportGeometry {
	pxPerSec: number;
	startSec: number;
	endSec: number;
	scrollLeft: number;
}
async function settledViewport(viewport: Locator): Promise<VuiViewportGeometry> {
	const read = (): Promise<VuiViewportGeometry> =>
		viewport.evaluate((element) => ({
			pxPerSec: Number.parseFloat(element.getAttribute("data-vui-px-per-sec") ?? "0"),
			startSec: Number(element.getAttribute("data-vui-start") ?? "0"),
			endSec: Number(element.getAttribute("data-vui-end") ?? "0"),
			scrollLeft: element.scrollLeft,
		}));
	let previous = await read();
	await expect
		.poll(
			async () => {
				const next = await read();
				const stable =
					next.pxPerSec === previous.pxPerSec &&
					next.startSec === previous.startSec &&
					next.scrollLeft === previous.scrollLeft;
				previous = next;
				return stable && next.pxPerSec > 0;
			},
			{ message: "VUI viewport geometry never settled" },
		)
		.toBe(true);
	return previous;
}

/** Does the surface hold anything below its header?
 *
 * A sheet gets its height from CSS, so a panel that renders its header and
 * nothing else still produces a full-height box and passes `expectRenders`.
 * This measures painted content instead of structure — deliberately not by
 * class name, because the nine rail destinations do not share one: some use
 * `.tl2-panel-body`, some have three of them, and the chat panel has none.
 */
async function expectHasContent(page: Page, selector: string, label = selector): Promise<void> {
	const painted = await page.evaluate((sel) => {
		const root = document.querySelector(sel as string);
		if (!root) return -1;
		const head = root.querySelector("header");
		const headBottom = head
			? head.getBoundingClientRect().bottom
			: root.getBoundingClientRect().top;
		let lowest = headBottom;
		for (const el of Array.from(root.querySelectorAll("*"))) {
			const r = el.getBoundingClientRect();
			if (r.width > 2 && r.height > 2) lowest = Math.max(lowest, r.bottom);
		}
		return Math.round(lowest - headBottom);
	}, selector);
	expect(painted, `${label}: nothing painted below the header`).toBeGreaterThan(24);
}

/** The `open` class lands before the transform settles, and the JS matchMedia
 *  stub in beforeEach does not reach a CSS prefers-reduced-motion query — so
 *  transitions really do run in this suite. */
async function settled(page: Page, selector: string): Promise<void> {
	await page.waitForFunction((sel) => {
		const t = getComputedStyle(document.querySelector(sel as string)!).transform;
		return t === "none" || t === "matrix(1, 0, 0, 1, 0, 0)";
	}, selector);
}

/** Does this element's box end above the bottom of the visible viewport? */
async function fitsViewport(
	page: Page,
	selector: string,
): Promise<{ bottom: number; viewport: number }> {
	return page.evaluate((sel) => {
		const el = document.querySelector(sel);
		if (!el) throw new Error(`no element for ${sel}`);
		return { bottom: Math.round(el.getBoundingClientRect().bottom), viewport: window.innerHeight };
	}, selector);
}

test("the emulation really is a coarse pointer", async ({ page }) => {
	/* Guards the suite itself. Half the rules under test key off `pointer:
	 * coarse`, so if the project config ever loses touch emulation these tests
	 * would keep passing while testing a narrow desktop window instead. */
	const coarse = await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches);
	expect(coarse).toBe(true);
});

test("stage and timeline are both present at once", async ({ page }) => {
	/* The requirement the composition exists to satisfy: scrubbing a timeline
	 * you cannot see the result of is not editing.
	 *
	 * The PREVIEW is asserted, not just its container. `.tl2-stage-top` was
	 * visible and correctly sized while holding only the docked clip inspector,
	 * with the preview collapsed to zero — an editor showing "Inspector ready"
	 * where the video belongs. A container assertion cannot tell those apart. */
	await expect(page.locator(".tl2-stage-top")).toBeVisible();
	await expect(page.locator(".tl2-timeline")).toBeVisible();

	const preview = (await page.locator(".tl2-preview").boundingBox())!;
	expect(preview.height).toBeGreaterThan(80);
	expect(preview.width).toBeGreaterThan(200);

	/* The CANVAS, not just its container. `.tl2-canvas` sizes itself as
	 * `height: 100%` plus an inline `aspect-ratio`, and the desktop preview
	 * centres its items — so with no definite height to resolve the percentage
	 * against, the aspect-ratio box collapsed to 0x0 inside a 393x250 preview.
	 * The phone showed an empty stage with no picture while every container
	 * assertion here stayed green. */
	const canvas = (await page.locator(".tl2-canvas").boundingBox())!;
	expect(canvas.width).toBeGreaterThan(40);
	expect(canvas.height).toBeGreaterThan(40);
	// And it keeps the project's aspect rather than being stretched to fill.
	expect(canvas.width / canvas.height).toBeCloseTo(9 / 16, 1);
});

test("range resize handles reach the touch minimum without moving the range", async ({ page }) => {
	/* The handles were 12x24 on a coarse pointer — under the platform minimum
	   that every other interactive mark here already meets, and invisible to the
	   rest of the suite because nothing measured them. They grow INWARD from the
	   range's own edges, so a fat handle never takes a hit belonging to the
	   neighbouring range, and the range's own box must not move: width is
	   duration, and duration is not a function of finger size. */
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();

	/* A range whose setting HAS a draggable end. A declined capability produces no
	   handle element at all rather than a styled-away one, so the first range on
	   the timeline — a section span, which no number resizes — carries none. */
	const range = modal.locator("[data-vui-slot='item']").filter({ hasText: "Opening title" });
	await range.click();
	const rangeBox = (await range.boundingBox())!;
	const handle = range.locator("[data-vui-slot='trim-end']");
	const handleBox = (await handle.boundingBox())!;

	expect(
		await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
		"not a coarse pointer",
	).toBe(true);
	/* 40% of a short range is the cap, so assert against whichever bound applies
	   rather than a flat 44 that a narrow range can never reach. */
	expect(handleBox.width, "resize handle is under the touch minimum").toBeGreaterThanOrEqual(
		Math.min(44, rangeBox.width * 0.4) - 1,
	);

	/* Inward: the handle stays within the range it belongs to. */
	expect(handleBox.x).toBeGreaterThanOrEqual(rangeBox.x - 1);
	expect(handleBox.x + handleBox.width).toBeLessThanOrEqual(rangeBox.x + rangeBox.width + 1);

	/* And the same statement made where it is actually decidable. The element's
	   box cannot distinguish a duration from a touch target; the kernel's three
	   boxes can, and they are what the library computes the affordance from. */
	const geometry = await itemGeometry(page, TEMPLATE_TIMELINE, "intro-title");
	expect(widthOf(geometry.timeBox), "the drawn width stopped meaning the duration").toBe(
		widthOf(geometry.paintBox),
	);
	expect(geometry.padded, "a range wide enough to draw honestly reported padding").toBe(false);
	const endHandle = geometry.handles.end!;
	expect(endHandle, "the granted end capability produced no handle").toBeDefined();
	/* Inward, in the kernel's own terms: the handle is inside the item's hit box
	   rather than straddling its edge, which is what stops it taking the press
	   belonging to the item next door. */
	expect(endHandle.leftPx).toBeGreaterThanOrEqual(geometry.hitBox.leftPx);
	expect(endHandle.rightPx).toBeLessThanOrEqual(geometry.hitBox.rightPx);

	/* And the body is still reachable between the two handles. */
	const startHandle = range.locator("[data-vui-slot='trim-start']");
	if (await startHandle.count()) {
		const startBox = (await startHandle.boundingBox())!;
		expect(
			startBox.width + handleBox.width,
			"both handles together cover the whole range",
		).toBeLessThan(rangeBox.width);
	}

	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

test("a shrinking visual viewport keeps the focused field and its completion controls reachable", async ({
	page,
}) => {
	/* The virtual keyboard, as far as this emulator can go.
	   Chromium under Playwright has no soft keyboard and does not fire
	   `visualViewport` resize for one, so the keyboard itself cannot be summoned.
	   What it DOES reproduce is the consequence — the visual viewport losing
	   roughly half its height while a field holds focus — and that is the part
	   the layout has to survive. Recorded as an emulator limitation rather than
	   claimed as a real keyboard test. */
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();

	/* Identity is a setting of the TEMPLATE, not of a range, so it is reached
	   from the bar's tool row — with nothing selected. Selecting a range first
	   would put the bar into its contextual state, where the only destination is
	   that range's own section. */
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity", exact: true })
		.click();
	const sheet = page.locator("[data-vui-slot='sheet']");
	await expect(sheet).toBeVisible();
	await expect(sheet.locator(".tl2-template-editor-form")).toBeVisible();
	/* No click to choose the category: the bar opened the sheet AT it, and the
	   sheet no longer repeats the rail. */
	const field = sheet.getByLabel("Name");
	await field.fill("Keyboard template");
	await expect(field).toBeFocused();

	const full = page.viewportSize()!;
	await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });

	/* The field keeps focus, stays on screen, and the control that dismisses the
	   sheet is still reachable — otherwise the edit cannot be finished. */
	await expect(field).toBeFocused();
	await expectWithinViewport(page, "[data-vui-slot='sheet']", "sheet under a shrunken viewport");
	await expectRenders(
		page,
		"[data-vui-slot='sheet-header'] button",
		"sheet close control under a shrunken viewport",
	);
	const fieldBox = (await field.boundingBox())!;
	expect(
		fieldBox.y + fieldBox.height,
		"the focused field is below the shrunken viewport",
	).toBeLessThanOrEqual(Math.round(full.height * 0.55) + 1);

	/* And nothing scrolled the document out from under the workspace. */
	expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual({ x: 0, y: 0 });

	await page.setViewportSize(full);
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

test("a sheet over the editor owns focus and Escape, and closing it hands ownership back", async ({
	page,
}) => {
	/* Two overlays in a stack. The inner one must own the keyboard while it is
	   open — an Escape that closed the editor underneath would lose the edit —
	   and closing it must hand focus and Escape back rather than leaving both
	   inert. */
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();

	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity" })
		.click();
	const sheet = page.locator("[data-vui-slot='sheet']");
	await expect(sheet).toBeVisible();

	/* The sheet is the top of the stack: focus is inside it, and the workspace
	   below is inert while it is open. */
	expect(
		await page.evaluate(() => document.activeElement?.closest("[data-vui-slot='sheet']") != null),
		"focus did not enter the sheet",
	).toBe(true);
	/* Everything below the sheet is inert EXCEPT the action region, which is
	   exempt on purpose: it is the way out of the sheet, and `inert` cannot be
	   escaped from within, so it has to be a sibling that the background pass
	   skips. Both halves are asserted — an exemption that inerted nothing would
	   pass a weaker version of this. */
	expect(
		await page.evaluate(() => {
			const sheetHost = document
				.querySelector("[data-vui-overlay-kind='sheet']")
				?.closest("body > *");
			const inertOf = (element: Element): boolean =>
				(element as HTMLElement & { inert?: boolean }).inert === true;
			const rest = Array.from(document.body.children).filter(
				(element) => element !== sheetHost && !element.hasAttribute("data-vui-persistent"),
			);
			const actions = document.querySelector("[data-vui-slot='actions-host']");
			return {
				restInert: rest.length > 0 && rest.every(inertOf),
				actionsInert: actions ? inertOf(actions) : null,
			};
		}),
		"the workspace below the sheet is not inert, or the action region is",
	).toEqual({ restInert: true, actionsInert: false });

	/* Escape closes the SHEET, not the editor under it. */
	await page.keyboard.press("Escape");
	await expect(sheet).toHaveCount(0);
	await expect(modal).toBeVisible();

	/* Ownership is handed back to whatever opened the sheet, the editor is live
	   again, and the body is still locked because one overlay remains.
	
	   That opener is now in the action region, which is a sibling of the workspace
	   rather than part of its dialog — so focus lands outside the dialog on
	   purpose. Returning it into the dialog instead would put it somewhere the
	   operator did not leave from, and the region is deliberately usable while the
	   editor is open. The claim is that focus went back where it came from. */
	expect(
		await page.evaluate(() => {
			const active = document.activeElement;
			return {
				inRegion: active?.closest("[data-vui-slot='mobile-actions']") != null,
				isCategory: active?.hasAttribute("data-studio-category") ?? false,
			};
		}),
		"focus did not return to the control that opened the sheet",
	).toEqual({ inRegion: true, isCategory: true });
	expect(
		await page.evaluate(() => getComputedStyle(document.body).overflow),
		"scroll lock released while the editor is still open",
	).toBe("hidden");

	/* And a second Escape now reaches the editor. */
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
});

test("safe-area insets move the workspace chrome inward without hiding its controls", async ({
	page,
}) => {
	/* A cutout or a home indicator must push CONTENT in, not just paint padding
	   on the overlay. The distinction matters: padding that no child respects
	   leaves the close button under the notch, which is exactly the failure a
	   `padding` assertion alone cannot see. */
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const overlay = "[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])";
	await expect(page.locator(overlay)).toBeVisible();
	await expectFullscreenWorkspace(page, "template fullscreen workspace");

	const header = "[data-vui-slot='header']";
	/* The action region, not the footer: at phone width the footer row is gone
	   and the bottom chrome IS the bar. Same question either way — does the
	   lowest chrome lift above the home indicator — asked of whichever element
	   is actually down there. */
	const footer = "[data-vui-slot='mobile-actions']";
	const before = {
		header: await surfaceGeometry(page, header),
		footer: await surfaceGeometry(page, footer),
	};
	expect(before.header.box, "no workspace header").not.toBeNull();
	expect(before.footer.box, "no workspace bottom chrome").not.toBeNull();

	const insets = { top: 44, right: 12, bottom: 34, left: 8 };
	await applySafeAreaInsets(page, overlay, insets);
	/* The bottom chrome is portalled to a sibling of the workspace so a sheet
	   cannot inert it, which means the overlay's insets no longer reach it. It
	   declares its own, as every package root at an edge does. */
	await applySafeAreaInsets(page, "[data-vui-slot='actions-host']", insets);

	await expect(async () => {
		const after = {
			header: await surfaceGeometry(page, header),
			footer: await surfaceGeometry(page, footer),
		};
		expect(
			Math.round(after.header.box!.y - before.header.box!.y),
			"header did not move below the top inset",
		).toBe(insets.top);
		/* The bottom chrome is fixed to the viewport edge now, so an inset grows its
		   padding rather than moving its box — the controls lift, the element does
		   not. That is what has to be measured: the lowest control clearing the home
		   indicator, which is the thing the inset exists to protect. */
		const controlBottom = await page
			.locator(`${footer} button`)
			.first()
			.evaluate((element) => element.getBoundingClientRect().bottom);
		expect(
			Math.round(after.footer.box!.y + after.footer.box!.h - controlBottom),
			"the bar's controls did not clear the bottom inset",
		).toBeGreaterThanOrEqual(insets.bottom);
		expect(
			Math.round(after.header.box!.x - before.header.box!.x),
			"header did not move right of the left inset",
		).toBe(insets.left);
	}).toPass({ timeout: 3000 });

	/* Still reachable, which is the point of moving them at all. */
	await expectRenders(page, ".tl2-editor-heading-back", "close control under safe-area insets");
	await expectWithinViewport(page, header, "header under safe-area insets");
	await expectWithinViewport(page, footer, "bottom chrome under safe-area insets");

	/* And a sheet opened over the inset workspace stays inside it too. */
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity" })
		.click();
	await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	await applySafeAreaInsets(page, "[data-vui-overlay-kind='sheet']", insets);
	await expectWithinViewport(page, "[data-vui-slot='sheet']", "sheet under safe-area insets");
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	await page.keyboard.press("Escape");
});

test("template editor keeps preview, timeline, fields and close reachable on phone", async ({
	page,
}) => {
	await page.keyboard.press("Alt+Digit4");
	const templateTrigger = page.locator(".tl2-template-create");
	const templateBodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
	const templateScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
	await templateTrigger.click();
	const templateModal = page.locator(".tl2-template-editor-modal");
	await expect(templateModal).toBeVisible();
	const templateOverlay = page.locator(
		"[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])",
	);
	const templateOverlayBox = (await templateOverlay.boundingBox())!;
	const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
	expect(templateOverlayBox).toEqual({
		x: 0,
		y: 0,
		width: viewport.width,
		height: viewport.height,
	});
	await expectFullscreenWorkspace(page, "portrait fullscreen workspace");
	await page.evaluate(() => document.fonts.ready);
	await expect(templateModal).toHaveScreenshot("vui-template-phone.png");
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
	await expectRenders(
		page,
		".tl2-template-editor-modal .tl2-editor-heading-back",
		"template close button",
	);
	await expectRenders(page, "[data-vui-slot='mobile-actions']", "template action bar");
	for (const selector of [".tl2-template-editor-preview", "[data-vui-slot='timeline']"]) {
		await expect(templateModal.locator(selector)).toBeVisible();
		const box = (await templateModal.locator(selector).boundingBox())!;
		expect(box.width, `${selector} has no width`).toBeGreaterThan(1);
		expect(box.height, `${selector} has no height`).toBeGreaterThan(1);
	}
	/* Identity first, from the tool row. It is a setting of the TEMPLATE rather
	   than of a range, so it is reached with nothing selected — selecting a range
	   puts the bar into its contextual state, where the only destination is that
	   range's own section. */
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity", exact: true })
		.click();
	await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	await expect(page.locator("[data-vui-slot='sheet'] .tl2-template-editor-form")).toBeVisible();
	expect(await templateModal.locator("[data-vui-slot='inspector']").count()).toBe(0);
	expect(await page.locator("[data-vui-slot='sheet'] .tl2-template-editor-form").count()).toBe(1);
	await page.locator("[data-vui-overlay-kind='workspace']").evaluate((element) => {
		for (const [name, value] of [
			["--vui-safe-area-top", "24px"],
			["--vui-safe-area-right", "12px"],
			["--vui-safe-area-bottom", "20px"],
			["--vui-safe-area-left", "8px"],
		])
			element.style.setProperty(name, value);
	});
	expect(
		await page
			.locator("[data-vui-overlay-kind='workspace']")
			.evaluate((element) => getComputedStyle(element).padding),
	).toBe("24px 12px 20px 8px");
	const nameInput = page.locator("[data-vui-slot='sheet']").getByLabel("Name");
	await nameInput.fill("Phone template");
	await expect(nameInput).toBeFocused();
	const inputBox = (await nameInput.boundingBox())!;
	expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(viewport.height + 1);
	await page.locator("[data-vui-slot='sheet-header'] button").click();

	/* And a sheet opened from a SELECTION leaves that selection, and the
	   playhead, where they were. Driven through the range's own section, which is
	   the only destination the bar offers while something is selected. */
	const selectedRange = templateModal
		.locator("[data-vui-slot='item']")
		.filter({ hasText: "Opening title" });
	await selectedRange.click();
	await expect(selectedRange).toHaveAttribute("aria-selected", "true");
	const playheadBeforeSheet = await templateModal
		.locator("[data-vui-slot='ruler']")
		.getAttribute("aria-valuenow");
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Opening · section 1", exact: true })
		.click();
	await expect(page.locator("[data-vui-slot='sheet'] .tl2-template-editor-form")).toBeVisible();
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	await expect(selectedRange).toHaveAttribute("aria-selected", "true");
	expect(await templateModal.locator("[data-vui-slot='ruler']").getAttribute("aria-valuenow")).toBe(
		playheadBeforeSheet,
	);
	/* The way out is the compact header's back control, and the bar does NOT
	   offer a second one.
	 *
	 * The bar used to carry Cancel in both states. It is a tool row now when
	 * nothing is selected, and its leading control means "leave the nearest
	 * layer" — with a range selected that is the selection, not the studio. Two
	 * exits on one surface, one of which discards the edit, is what this asserts
	 * against; the content editor's tool rail carries no close either. */
	expect(
		await page
			.locator("[data-vui-slot='mobile-actions']")
			.getByRole("button", { name: "Close without saving" })
			.count(),
		"the bar offers a second exit",
	).toBe(0);
	await page.keyboard.press("Escape");
	await expect(page.locator(".tl2-template-editor-modal")).toHaveCount(0);
	await expect(page.locator("[data-vui-slot='sheet']")).toHaveCount(0);
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	await expect(page.locator(".tl2-template-editor-modal")).toBeVisible();
	const headerBack = page.locator(".tl2-template-editor-modal .tl2-editor-heading-back");
	await expect(headerBack).toBeVisible();
	await headerBack.click();
	await expect(page.locator(".tl2-template-editor-modal")).toHaveCount(0);
	await expect(templateTrigger).toBeFocused();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(
		templateBodyOverflow,
	);
	expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(templateScroll);
});

test("VUI nested overlay cleanup survives parent-first close", async ({ page }) => {
	const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity", exact: true })
		.click();
	await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
	await modal.locator(".tl2-editor-heading-back").dispatchEvent("click");
	await expect(modal).toHaveCount(0);
	await expect(page.locator("[data-vui-slot='sheet']")).toHaveCount(0);
	/* The rail that `Alt+Digit4` opened is an app `Sheet`, and it is STILL open —
	   so the body is still locked, and correctly so. Asserting the pre-rail value
	   here would assert that a sheet with a scrim lets the page behind it scroll.
	   The claim worth making is that the workspace and its nested sheet gave back
	   exactly what they took, so the rail is closed too and the count is read at
	   the bottom rather than in the middle. Reading it while the rail is open
	   would pass on "hidden" either way and prove nothing about the release. */
	await page.keyboard.press("Escape");
	await expect(page.locator(".tl2-template-create")).toHaveCount(0);
	expect(
		await page.evaluate(() => ({
			overflow: getComputedStyle(document.body).overflow,
			appHidden: document.querySelector("#app")?.getAttribute("aria-hidden") ?? null,
		})),
	).toEqual({ overflow: bodyOverflow, appHidden: null });
});

test("VUI timeline arbitrates coarse ruler, lane, and item gestures", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	const viewport = modal.locator("[data-vui-slot='timeline-scroller']");
	const range = modal.locator("[data-vui-slot='item']").first();
	await expect(range).toBeVisible();

	/* First coarse press selects. It must not start manipulation or steal lane
	 * scrolling from the viewport. */
	const rangeBox = (await range.boundingBox())!;
	await range.dispatchEvent("pointerdown", {
		pointerId: 41,
		pointerType: "touch",
		clientX: rangeBox.x + 12,
		clientY: rangeBox.y + 12,
		buttons: 1,
	});
	await expect(range).toHaveAttribute("aria-selected", "true");
	await range.dispatchEvent("pointerup", {
		pointerId: 41,
		pointerType: "touch",
		clientX: rangeBox.x + 12,
		clientY: rangeBox.y + 12,
	});

	/* Selected item gets the manipulation path on the next coarse gesture. */
	const selectedBox = (await range.boundingBox())!;
	await range.dispatchEvent("pointerdown", {
		pointerId: 42,
		pointerType: "touch",
		clientX: selectedBox.x + 12,
		clientY: selectedBox.y + 12,
		buttons: 1,
	});
	await page.waitForTimeout(140);
	await range.dispatchEvent("pointermove", {
		pointerId: 42,
		pointerType: "touch",
		clientX: selectedBox.x + 36,
		clientY: selectedBox.y + 12,
		buttons: 1,
	});
	await expect(range, "selected coarse item enters manipulation").toHaveAttribute(
		"data-vui-gesturing",
		"",
	);
	await range.dispatchEvent("pointerup", {
		pointerId: 42,
		pointerType: "touch",
		clientX: selectedBox.x + 36,
		clientY: selectedBox.y + 12,
	});

	/* Empty lane drag pans horizontally. */
	const viewportBox = (await viewport.boundingBox())!;
	const scrollable = await viewport.evaluate(
		(element) => element.scrollWidth > element.clientWidth,
	);
	expect(scrollable, "template timeline exposes horizontal lane scroll").toBe(true);
	const scrollBefore = await viewport.evaluate((element) => element.scrollLeft);
	await viewport.dispatchEvent("pointerdown", {
		pointerId: 43,
		pointerType: "touch",
		clientX: viewportBox.x + 260,
		clientY: viewportBox.y + viewportBox.height - 20,
		buttons: 1,
	});
	await viewport.dispatchEvent("pointermove", {
		pointerId: 43,
		pointerType: "touch",
		clientX: viewportBox.x + 80,
		clientY: viewportBox.y + viewportBox.height - 20,
		buttons: 1,
	});
	await expect
		.poll(async () => await viewport.evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(scrollBefore);
	await viewport.dispatchEvent("pointerup", {
		pointerId: 43,
		pointerType: "touch",
		clientX: viewportBox.x + 80,
		clientY: viewportBox.y + viewportBox.height - 20,
	});

	/* Ruler scrub owns same pointer, so it cannot also pan viewport. */
	const ruler = modal.locator("[data-vui-slot='ruler']");
	const rulerBox = (await ruler.boundingBox())!;
	const rulerScrollBefore = await viewport.evaluate((element) => element.scrollLeft);
	await ruler.dispatchEvent("pointerdown", {
		pointerId: 44,
		pointerType: "touch",
		clientX: rulerBox.x + 80,
		clientY: rulerBox.y + 8,
		buttons: 1,
	});
	await ruler.dispatchEvent("pointermove", {
		pointerId: 44,
		pointerType: "touch",
		clientX: rulerBox.x + 180,
		clientY: rulerBox.y + 8,
		buttons: 1,
	});
	await ruler.dispatchEvent("pointerup", {
		pointerId: 44,
		pointerType: "touch",
		clientX: rulerBox.x + 180,
		clientY: rulerBox.y + 8,
	});
	expect(await viewport.evaluate((element) => element.scrollLeft)).toBe(rulerScrollBefore);
});

test("VUI timeline pinch zoom keeps focal time and page scale stable", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	const viewport = modal.locator("[data-vui-slot='timeline-scroller']");
	const before = await settledViewport(viewport);
	const box = (await viewport.boundingBox())!;
	const focalClientX = box.x + 220;
	const focalTime = (focalClientX - box.x + before.scrollLeft) / before.pxPerSec;
	const pageBefore = await page.evaluate(() => ({
		scale: visualViewport?.scale ?? 1,
		scrollX,
		scrollY,
	}));

	await viewport.dispatchEvent("pointerdown", {
		pointerId: 51,
		pointerType: "touch",
		clientX: box.x + 160,
		clientY: box.y + 30,
		buttons: 1,
	});
	await page.waitForTimeout(30);
	await viewport.dispatchEvent("pointerdown", {
		pointerId: 52,
		pointerType: "touch",
		clientX: box.x + 280,
		clientY: box.y + 30,
		buttons: 1,
	});
	await page.waitForTimeout(30);
	await viewport.dispatchEvent("pointermove", {
		pointerId: 52,
		pointerType: "touch",
		clientX: box.x + 360,
		clientY: box.y + 30,
		buttons: 1,
	});
	await expect
		.poll(
			async () =>
				await viewport.evaluate((element) =>
					Number.parseFloat(element.getAttribute("data-vui-px-per-sec") ?? "0"),
				),
		)
		.toBeGreaterThan(before.pxPerSec);
	const after = await viewport.evaluate((element) => ({
		pxPerSec: Number.parseFloat(element.getAttribute("data-vui-px-per-sec") ?? "0"),
		startSec: Number(element.getAttribute("data-vui-start") ?? "0"),
		endSec: Number(element.getAttribute("data-vui-end") ?? "0"),
		scrollLeft: element.scrollLeft,
	}));
	const afterFocalTime = (focalClientX - box.x + after.scrollLeft) / after.pxPerSec;
	expect(Math.abs(afterFocalTime - focalTime), "pinch focal time drifts").toBeLessThan(0.2);
	expect(
		await page.evaluate(() => ({ scale: visualViewport?.scale ?? 1, scrollX, scrollY })),
	).toEqual(pageBefore);
	await viewport.dispatchEvent("pointerup", {
		pointerId: 52,
		pointerType: "touch",
		clientX: box.x + 360,
		clientY: box.y + 30,
	});
	await viewport.dispatchEvent("pointerup", {
		pointerId: 51,
		pointerType: "touch",
		clientX: box.x + 160,
		clientY: box.y + 30,
	});
});

test("VUI timeline wheel zoom keeps focal time after horizontal scroll", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const viewport = page.locator(".tl2-template-editor-modal [data-vui-slot='timeline-scroller']");
	await expect(viewport).toBeVisible();
	await settledViewport(viewport);
	await viewport.evaluate((element) => {
		element.scrollLeft = Math.min(180, element.scrollWidth - element.clientWidth);
		element.dispatchEvent(new Event("scroll", { bubbles: true }));
	});
	await expect
		.poll(async () => await viewport.evaluate((element) => element.scrollLeft))
		.toBeGreaterThan(0);
	await expect
		.poll(
			async () =>
				await viewport.evaluate(
					(element) =>
						Math.abs(
							Number(element.getAttribute("data-vui-start")) -
								element.scrollLeft / Number(element.getAttribute("data-vui-px-per-sec")),
						) < 0.01,
				),
		)
		.toBe(true);
	const box = (await viewport.boundingBox())!;
	const clientX = box.x + box.width * 0.72;
	const before = await viewport.evaluate(
		(element, x) => ({
			pxPerSec: Number(element.getAttribute("data-vui-px-per-sec")),
			startSec: Number(element.getAttribute("data-vui-start")),
			focalSec:
				Number(element.getAttribute("data-vui-start")) +
				(x - element.getBoundingClientRect().left) /
					Number(element.getAttribute("data-vui-px-per-sec")),
		}),
		clientX,
	);
	await viewport.evaluate(
		(element, x) =>
			element.dispatchEvent(
				new WheelEvent("wheel", {
					bubbles: true,
					cancelable: true,
					clientX: x,
					deltaY: -120,
					ctrlKey: true,
				}),
			),
		clientX,
	);
	await expect
		.poll(
			async () =>
				await viewport.evaluate((element) => Number(element.getAttribute("data-vui-px-per-sec"))),
		)
		.toBeGreaterThan(before.pxPerSec);
	const after = await viewport.evaluate(
		(element, x) => ({
			pxPerSec: Number(element.getAttribute("data-vui-px-per-sec")),
			startSec: Number(element.getAttribute("data-vui-start")),
			focalSec:
				Number(element.getAttribute("data-vui-start")) +
				(x - element.getBoundingClientRect().left) /
					Number(element.getAttribute("data-vui-px-per-sec")),
		}),
		clientX,
	);
	expect(
		Math.abs(after.focalSec - before.focalSec),
		"ctrl-wheel focal time drifts after scroll",
	).toBeLessThan(0.2);
});

test("VUI short ranges keep exact geometry while exposing touch-sized hit targets", async ({
	page,
}) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const shortRange = page
		.locator(".tl2-template-editor-modal [data-vui-slot='item']")
		.filter({ hasText: "Sentence breath" });
	await expect(shortRange).toHaveCount(1);
	await shortRange.scrollIntoViewIfNeeded();
	const before = (await shortRange.boundingBox())!;
	const hitBox = (await shortRange.locator("[data-vui-slot='hit-target']").boundingBox())!;
	expect(before.width, "short range visual width is not inflated").toBeLessThan(44);
	expect(hitBox.width, "short range hit target is not touch-sized").toBeGreaterThanOrEqual(44);

	/* The kernel's version of the same two sentences, and the flag that makes the
	   discrepancy STATABLE rather than silently applied: the touch target is wider
	   than the duration, and `hitPadded` says so out loud. */
	const geometry = await itemGeometry(page, TEMPLATE_TIMELINE, "sentence-breath");
	/* Rounded to a hundredth of a pixel: the box is grown about its centre in
	   floats, so an exact 44 comes back as 43.999999999999986. A tolerance far
	   below anything a device can render keeps the assertion about the minimum
	   rather than about IEEE 754. */
	expect(
		Math.round(widthOf(geometry.hitBox) * 100) / 100,
		"the kernel's hit box is under the touch minimum",
	).toBeGreaterThanOrEqual(44);
	expect(
		widthOf(geometry.timeBox),
		"the duration was inflated to reach the touch minimum",
	).toBeLessThan(44);
	expect(geometry.hitPadded, "a padded hit target did not report itself").toBe(true);
	const hitX = hitBox.x + 1;
	const hitY = hitBox.y + hitBox.height / 2;
	const hit = await page.evaluate(
		({ x, y }) => {
			const element = document.elementFromPoint(x, y);
			return element?.closest("[data-vui-slot='item']") != null;
		},
		{ x: hitX, y: hitY },
	);
	expect(hit, "expanded hit target does not cover short range").toBe(true);
	await page.mouse.click(hitX, hitY);
	await expect(shortRange).toHaveAttribute("aria-selected", "true");
	const after = (await shortRange.boundingBox())!;
	expect(after.width).toBe(before.width);
	expect(after.x).toBe(before.x);
});

test("Motion Studio keeps preview, layer timeline, inspector and close reachable on phone", async ({
	page,
}) => {
	await page.keyboard.press("Alt+Digit5");
	const motionSection = page
		.locator("section")
		.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
		.first();
	const motionTrigger = motionSection.getByRole("button", { name: /New motion/ });
	const motionBodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
	const motionScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
	await motionTrigger.click();
	await expect(page.locator(".tl2-studio")).toBeVisible();
	const motionOverlay = page.locator("[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])");
	const motionOverlayBox = (await motionOverlay.boundingBox())!;
	const motionViewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
	expect(motionOverlayBox).toEqual({
		x: 0,
		y: 0,
		width: motionViewport.width,
		height: motionViewport.height,
	});
	await expectFullscreenWorkspace(page, "portrait fullscreen workspace");
	await page.evaluate(() => document.fonts.ready);
	await expect(page.locator(".tl2-studio")).toHaveScreenshot("vui-motion-phone.png");
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
	await expectRenders(page, ".tl2-studio .tl2-editor-heading-back", "Motion close button");
	await expectRenders(page, "[data-vui-slot='mobile-actions']", "Motion action bar");
	for (const selector of [".tl2-studio-stage", ".tl2-motion-timeline"]) {
		await expect(page.locator(selector)).toBeVisible();
		const box = (await page.locator(selector).boundingBox())!;
		expect(box.width, `${selector} has no width`).toBeGreaterThan(1);
		expect(box.height, `${selector} has no height`).toBeGreaterThan(1);
	}
	await motionOverlay.evaluate((element) => {
		for (const [name, value] of [
			["--vui-safe-area-top", "24px"],
			["--vui-safe-area-right", "12px"],
			["--vui-safe-area-bottom", "20px"],
			["--vui-safe-area-left", "8px"],
		])
			element.style.setProperty(name, value);
	});
	expect(await motionOverlay.evaluate((element) => getComputedStyle(element).padding)).toBe(
		"24px 12px 20px 8px",
	);
	const layerRange = page.locator(".tl2-motion-timeline [data-vui-slot='item']").first();
	await layerRange.click();
	const ruler = page.locator(".tl2-motion-timeline [data-vui-slot='ruler']");
	const rulerBox = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: rulerBox.width / 2, y: rulerBox.height / 2 } });
	/* Scale lives in the selected layer's Motion section. The bar is contextual
	   now — with a layer selected it carries that layer's sections rather than one
	   control per layer — so the destination is named rather than pattern-matched
	   on a layer id. */
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Motion", exact: true })
		.click();
	await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	/* The sheet does NOT repeat the bar: at this width the bar is the rail, and
	   two rows of the same glyphs read as two different controls. */
	await expect(
		page.locator("[data-vui-slot='sheet'] [data-vui-slot='category-rail']"),
	).toBeHidden();
	const scale = page.locator("[data-vui-slot='sheet']").getByLabel(/^Scale/);
	await scale.fill("1.5");
	await expect(scale).toBeFocused();
	const scaleBox = (await scale.boundingBox())!;
	expect(scaleBox.y + scaleBox.height).toBeLessThanOrEqual(motionViewport.height + 1);
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	const marker = page.locator(".tl2-motion-timeline [data-vui-slot='marker']").last();
	await expect(page.locator(".tl2-motion-timeline [data-vui-slot='marker']")).toHaveCount(2);
	const markerLabel = await marker.getAttribute("aria-label");
	await marker.evaluate((element) => {
		const box = element.getBoundingClientRect();
		const event = (name: string, x: number) =>
			element.dispatchEvent(
				new PointerEvent(name, {
					bubbles: true,
					pointerId: 91,
					pointerType: "touch",
					clientX: x,
					clientY: box.y + box.height / 2,
				}),
			);
		event("pointerdown", box.x + box.width / 2);
		event("pointermove", box.x - 40);
		event("pointercancel", box.x - 40);
	});
	await expect(marker).toHaveAttribute("aria-label", markerLabel!);
	const close = page.locator(".tl2-studio .tl2-editor-heading-back");
	await expect(close).toBeVisible();
	await close.click();
	await expect(page.locator(".tl2-studio")).toHaveCount(0);
	await expect(motionTrigger).toBeFocused();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(
		motionBodyOverflow,
	);
	expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(motionScroll);
});

test("template and Motion stay fullscreen in coarse landscape", async ({ page }) => {
	await page.setViewportSize({ width: 852, height: 393 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
	const viewport = { width: 852, height: 393 };

	await page.keyboard.press("Alt+Digit4");
	const templateTrigger = page.locator(".tl2-template-create");
	const bodyOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
	const scrollBefore = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
	await templateTrigger.click();
	await expect(
		page.locator("[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])"),
	).toBeVisible();
	const templateOverlay = (await page
		.locator("[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])")
		.boundingBox())!;
	expect(templateOverlay).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
	await expectFullscreenWorkspace(page, "landscape template fullscreen workspace");
	await expect(page.locator(".tl2-template-editor-preview")).toBeVisible();
	await expect(page.locator(".tl2-template-editor-modal [data-vui-slot='timeline']")).toBeVisible();
	await expectRenders(page, ".tl2-template-editor-preview", "landscape template preview");
	await expectRenders(
		page,
		".tl2-template-editor-modal [data-vui-slot='timeline']",
		"landscape template timeline",
	);
	/* The action bar is the bottom chrome at a coarse viewport; the footer row is
	   desktop-only. Landscape is where this matters most — 393px of height with a
	   preview and a timeline in it is where a bar would be pushed off screen. */
	await expectRenders(page, "[data-vui-slot='mobile-actions']", "landscape template action bar");
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Template identity", exact: true })
		.click();
	await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
	const landscapeInput = page.locator("[data-vui-slot='sheet'] input").first();
	await landscapeInput.fill("Landscape template");
	await expect(landscapeInput).toBeFocused();
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
	await page.locator(".tl2-template-editor-modal .tl2-editor-heading-back").click();
	await expect(page.locator(".tl2-template-editor-modal")).toHaveCount(0);
	await expect(templateTrigger).toBeFocused();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(bodyOverflow);
	expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(scrollBefore);

	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.keyboard.press("Alt+Digit5");
	const landscapeMotionTrigger = page
		.getByRole("region", { name: "Motion elements", exact: true })
		.getByRole("button", { name: "New motion", exact: true });
	const motionOverflow = await page.evaluate(() => getComputedStyle(document.body).overflow);
	const motionScroll = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
	await landscapeMotionTrigger.focus();
	await landscapeMotionTrigger.dispatchEvent("click");
	await expect(
		page.locator("[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])"),
	).toBeVisible();
	const landscapeMotionOverlay = page.locator(
		"[data-vui-slot='overlay']:has([data-vui-mode='fullscreen'])",
	);
	const motionOverlay = (await landscapeMotionOverlay.boundingBox())!;
	expect(motionOverlay).toEqual({ x: 0, y: 0, width: viewport.width, height: viewport.height });
	await expectFullscreenWorkspace(page, "landscape Motion fullscreen workspace");
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe("hidden");
	await expect(page.locator(".tl2-studio-stage")).toBeVisible();
	await expect(page.locator(".tl2-motion-timeline")).toBeVisible();
	await expectRenders(page, ".tl2-studio-stage", "landscape Motion preview");
	await expectRenders(page, ".tl2-motion-timeline", "landscape Motion timeline");
	await expectRenders(page, "[data-vui-slot='mobile-actions']", "landscape Motion action bar");
	await page.locator(".tl2-motion-timeline [data-vui-slot='item']").first().click();
	/* Scale lives in the selected layer's Motion section. The bar is contextual
	   now — with a layer selected it carries that layer's sections rather than one
	   control per layer — so the destination is named rather than pattern-matched
	   on a layer id. */
	await page
		.locator("[data-vui-slot='mobile-actions']")
		.getByRole("button", { name: "Motion", exact: true })
		.click();
	const landscapeMotionScale = page.locator("[data-vui-slot='sheet']").getByLabel(/^Scale/);
	await landscapeMotionScale.fill("1.25");
	await expect(landscapeMotionScale).toBeFocused();
	await page.locator("[data-vui-slot='sheet-header'] button").click();
	await page.locator(".tl2-studio .tl2-editor-heading-back").click();
	await expect(page.locator(".tl2-studio")).toHaveCount(0);
	await expect(landscapeMotionTrigger).toBeFocused();
	expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(motionOverflow);
	expect(await page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(motionScroll);
});

test("VUI mobile interactions complete, and their wall-clock is recorded", async ({ page }) => {
	/* REPORTED, not asserted. Interaction wall-clock moves with hardware and with
	 * whatever else the CI box is doing, so a threshold on it becomes a muted
	 * test within a week — the number is worth having and the gate is not.
	 *
	 * What each case still asserts is that the interaction COMPLETED: the play
	 * button reads Pause, the sheet is visible, the sheet is gone. An interaction
	 * that hung fails those by timeout, which is the liveness guarantee the 2.5s
	 * ceiling was standing in for. */
	const timed = async (label: string, action: () => Promise<void>): Promise<void> => {
		const started = await page.evaluate(() => performance.now());
		await action();
		const elapsed = await page.evaluate((start) => Math.round(performance.now() - start), started);
		console.log(`[vui-perf] ${label}: ${elapsed}ms`);
	};

	await timed("content playback toggle", async () => {
		const play = page.locator("[data-transport='play']");
		await play.click();
		await expect(play).toHaveAttribute("title", /Pause/);
		await play.click();
		await expect(play).toHaveAttribute("title", /Play/);
	});
	await timed("content timeline scrub", async () => {
		const ruler = page.locator("[data-vui-slot='ruler']");
		const box = (await ruler.boundingBox())!;
		await page.mouse.move(box.x + 8, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width - 8, box.y + box.height / 2, { steps: 8 });
		await page.mouse.up();
	});
	await timed("content sheet open close", async () => {
		await page.keyboard.press("Alt+Digit1");
		await expect(page.locator(".tl2-panel-sheet")).toBeVisible();
		await page.locator('.tl2-panel-sheet [title="Hide panel"]').click();
		await expect(page.locator(".tl2-panel-sheet")).toHaveCount(0);
	});
	await timed("template inspector edit", async () => {
		await page.keyboard.press("Alt+Digit4");
		await page.locator(".tl2-template-create").click();
		await page
			.locator("[data-vui-slot='mobile-actions']")
			.getByRole("button", { name: "Template identity", exact: true })
			.click();
		const input = page.locator("[data-vui-slot='sheet'] .tl2-template-editor-form input").first();
		await input.fill("Phone timing probe");
		await expect(input).toHaveValue("Phone timing probe");
		await page.locator("[data-vui-slot='sheet-header'] button").click();
		/* Out through the header, not the bar. With nothing selected the bar is a
		   tool row and carries no exit — the studio's is the compact header's back
		   control, the same arrangement the content editor's tool rail has. */
		await page.locator(".tl2-template-editor-modal [title='Close']").click();
	});
	await timed("Motion Studio inspector edit", async () => {
		await page.keyboard.press("Alt+Digit5");
		const motionSection = page
			.locator("section")
			.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
			.first();
		await motionSection.getByRole("button", { name: /New motion/ }).click();
		await page
			.locator("[data-vui-slot='mobile-actions']")
			.getByRole("button", { name: "Motion identity", exact: true })
			.click();
		const input = page.locator("[data-vui-slot='sheet'] input[placeholder='Motion name']").first();
		await input.fill("Phone timing probe");
		await expect(input).toHaveValue("Phone timing probe");
		await page.locator("[data-vui-slot='sheet-header'] button").click();
		await page.locator(".tl2-studio .tl2-editor-heading-back").click();
	});
});

test("the rail is a bottom bar, not a left column", async ({ page }) => {
	const rail = page.locator(".tl2-rail");
	await expect(rail).toBeVisible();
	const box = (await rail.boundingBox())!;
	const viewport = page.viewportSize()!;
	// Wider than tall, and sitting in the lower half.
	expect(box.width).toBeGreaterThan(box.height);
	expect(box.y).toBeGreaterThan(viewport.height / 2);
});

test("no pane runs past the bottom of the viewport", async ({ page }) => {
	/* The `dvh`/`svh` work in section 1 is invisible to every other gate. This
	 * is the assertion that would have failed before it. */
	for (const sel of [".tl2-rail", ".tl2-timeline", ".tl2-body"])
		await expectWithinViewport(page, sel);
});

test("a rail tool opens the panel as a sheet, and it closes", async ({ page }) => {
	const sheet = page.locator(".tl2-panel-sheet");
	/* Starts closed. The chrome store defaults `panelOpen` to true, which suits
	 * a column beside the stage; as a sheet it would cover the stage and the
	 * timeline on load, so the editor closes it when the layout is a phone. */
	await expect(sheet).toHaveCount(0);

	// Alt+1 rather than a click: the rail button toggles, so clicking whichever
	// destination the editor already opened would close the panel instead.
	await page.keyboard.press("Alt+Digit1");
	await expect(sheet).toBeVisible();
	await expect(sheet).toHaveClass(/ui-sheet-open/);
	/* It is a sheet, not the desktop column: full width, anchored to the bottom
	 * — and TALL. The height assertion is not padding: a bottom sheet with only
	 * a max-height collapses to its content's intrinsic height, which for these
	 * flex-column panels is zero. That rendered a modal scrim over the whole
	 * editor with no content in it, and a width-only assertion passed. */
	const box = (await sheet.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.width).toBeGreaterThan(viewport.width * 0.9);
	/* Compared against the band it is sized to, not against a share of the
	 * viewport. The share was 40%, which encoded the 72svh this sheet used to
	 * ask for — and quietly failed the moment every sheet became the height of
	 * the timeline instead. A measured comparison cannot go stale that way. */
	const band = await page.evaluate(() => {
		const bar = document.querySelector(".tl2-bottombar")!.getBoundingClientRect();
		const transport = document.querySelector(".tl2-tlbar")!.getBoundingClientRect();
		return Math.round(bar.top - transport.top);
	});
	expect(band, "the band itself collapsed").toBeGreaterThan(120);
	expect(Math.round(box.height)).toBe(band);
	/* Anchored to the bottom of the VIEWPORT, not merely tall. `.tl2-panel`
	 * declares `position: relative` from the feature layer and layer beats
	 * specificity, so the sheet once lost its `fixed` and fell into normal flow
	 * below the fold — off screen, while still reporting a tall box. */
	expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 1);
	expect(box.y).toBeLessThan(viewport.height);

	/* Dismissal is the half that breaks silently — a sheet that opens and
	 * cannot be closed traps the operator with no way back to the timeline.
	 *
	 * Through the panel's OWN control, not the scrim. Now that a sheet fills the
	 * band exactly there is no exposed scrim left to tap: it occupies precisely
	 * the area the sheet covers, so "tap outside" has no outside. Everything
	 * beyond the band — the stage, the transport, the bottom bar — is
	 * deliberately live and does something else when tapped.
	 *
	 * Asserted as a count, not as a missing `ui-sheet-open` class: the host is
	 * gated on `panelOpen` in timeline-editor.tsx, so closing unmounts it
	 * outright. */
	await page.locator('.tl2-panel-sheet [title="Hide panel"]').click();
	await expect(sheet).toHaveCount(0);
});

test("chat is the workspace's Chat view, not a rail sheet", async ({ page }) => {
	/* Chat left the rail's sheets when it became a workspace: a partial sheet
	 * could not hold a pinned decision, the composer and the keyboard at once.
	 * Alt+2 still reaches it — as the view, with no panel sheet over the editor.
	 * The switch itself is covered in phone-chat-workspace.spec.ts. */
	await expect(page.locator(".tl2-rail").getByTitle(/^Chat /)).toHaveCount(0);
	await page.keyboard.press("Alt+Digit2");
	await expect(page.getByRole("tab", { name: "Chat", exact: true })).toHaveAttribute(
		"aria-selected",
		"true",
	);
	await expect(page.locator(".tl2-panel-sheet")).toHaveCount(0);
	await expectHasContent(page, ".cv-phonews-chat");
	await page.getByRole("tab", { name: "Editor", exact: true }).click();
	await expect(page.locator(".tl2-timeline")).toBeVisible();
});

test("the timeline can be panned horizontally by touch", async ({ page }) => {
	/* `touch-action: none` on the drag rails meant the browser did nothing and
	 * this phase ships no gesture handlers, so the timeline rendered correctly
	 * and could not be moved at all. Asserting the declaration rather than
	 * simulating a fling: the fling is what a real device is for, but the
	 * declaration is what silently regresses. */
	const rails = page.locator(".tl2-motion-timeline [data-vui-slot='timeline-scroller']").first();
	if (await rails.count()) {
		const touchAction = await rails.evaluate((el) => getComputedStyle(el).touchAction);
		expect(touchAction).not.toBe("none");
	}
});

test("inputs do not trip the iOS focus-zoom threshold", async ({ page }) => {
	/* Safari zooms whenever focus lands on a control under 16px and never zooms
	 * back out. The rule lives in an unlayered sheet precisely because it has to
	 * beat the feature layer; this checks it actually won. */
	await page.keyboard.press("Alt+Digit1");
	await expect(page.locator(".tl2-panel-sheet")).toBeVisible();
	const tooSmall = await page.evaluate(() =>
		[...document.querySelectorAll("input, textarea, select")]
			.filter((el) => (el as HTMLElement).offsetParent !== null)
			.map((el) => ({ tag: el.tagName, size: parseFloat(getComputedStyle(el).fontSize) }))
			.filter((x) => x.size < 16),
	);
	expect(tooSmall).toEqual([]);
});

test("landscape fits too", async ({ page }) => {
	/* 852x393 is the same phone rotated, and it is below the 860px breakpoint,
	 * so it keeps the phone composition rather than falling back to desktop.
	 * The design flagged that landscape "solves width and creates a height
	 * problem" — it did. Measured before this assertion existed: `.tl2-stage-top`
	 * collapsed to 0px and `.tl2-timeline` kept its desktop 392px, hanging 213px
	 * below the fold. Both were rules that lost a cascade fight silently while
	 * every portrait check stayed green, which is why the height budget is
	 * asserted at BOTH orientations. */
	await page.setViewportSize({ width: 852, height: 393 });
	await page.waitForTimeout(300);

	const m = await page.evaluate(() => {
		const box = (s: string) => {
			const el = document.querySelector(s);
			if (!el) throw new Error(`no element for ${s}`);
			const r = el.getBoundingClientRect();
			return { height: Math.round(r.height), bottom: Math.round(r.bottom) };
		};
		return {
			viewport: window.innerHeight,
			stage: box(".tl2-stage-top"),
			timeline: box(".tl2-timeline"),
			rail: box(".tl2-rail"),
		};
	});

	// Nothing below the fold.
	const { viewport, ...panes } = m;
	for (const [name, v] of Object.entries(panes)) {
		expect(v.bottom, `${name} ends at ${v.bottom} in a ${viewport}px viewport`).toBeLessThanOrEqual(
			viewport + 1,
		);
	}
	// And both panes survive: a stage or timeline squeezed to nothing "fits".
	expect(m.stage.height).toBeGreaterThan(90);
	expect(m.timeline.height).toBeGreaterThan(90);
});

test("the timeline toolbar fits the viewport", async ({ page }) => {
	/* The desktop bar is a three-column grid with a ~912px floor, so at 393px it
	 * ran more than twice the viewport and the timecode, aspect and insight
	 * controls sat off-screen with nothing to scroll. Horizontal overflow of a
	 * fixed-position bar is invisible to a screenshot that crops at the viewport
	 * edge — it just looks like a bar that ends. */
	const bar = page.locator(".tl2-tlbar");
	await expect(bar).toBeVisible();
	const box = (await bar.boundingBox())!;
	const viewport = page.viewportSize()!;
	expect(box.width).toBeLessThanOrEqual(viewport.width + 1);

	/* Nothing inside it may overflow either. A bar clipped to the viewport with
	 * its contents spilling past the right edge measures the same as one that
	 * fits, so the scroll width is what actually has to be checked. */
	const overflow = await bar.evaluate((el) => el.scrollWidth - el.clientWidth);
	expect(overflow).toBeLessThanOrEqual(1);

	/* Transport stays reachable without scrolling. It no longer needs its own
	 * full-width row — since the bar dropped to Undo/Redo/Play/timecode/More it
	 * fits one row — but play must still be inside the viewport. */
	const play = (await page.locator("[data-transport='play']").boundingBox())!;
	expect(play.x).toBeGreaterThanOrEqual(0);
	expect(play.x + play.width).toBeLessThanOrEqual(viewport.width + 1);
});

/* The phone timeline keeps the playhead in the middle and moves the lanes
 * under it (use-centred-playhead.ts): playback scrolls the view, and scrolling
 * the view seeks. Zoomed to the maximum so the project is longer than 393px —
 * at a width where it fits, "the view moved" proves nothing.
 */
test("the playhead holds the centre while playing and scrolling seeks", async ({ page }) => {
	const scroller = page.locator(".tl2-timeline [data-vui-slot='timeline-scroller']").first();
	const head = page.locator(".tl2-timeline [data-vui-slot='playhead']").first();

	await page.locator('.tl2-tlbar [aria-label="More tools"]').click();
	const zoomIn = page.locator(".tl2-more-sheet [title='Zoom in (+)']").first();
	for (let i = 0; i < 40 && (await zoomIn.isEnabled()); i++) await zoomIn.click();
	await page.locator(".tl2-more-sheet").getByRole("button", { name: "Close" }).click();

	const centreOffset = async (): Promise<number> => {
		const box = (await scroller.boundingBox())!;
		const h = (await head.boundingBox())!;
		return Math.abs(h.x + h.width / 2 - (box.x + box.width / 2));
	};
	expect(await centreOffset(), "the playhead does not start at the centre").toBeLessThan(4);

	const before = await scroller.evaluate((n) => n.scrollLeft);
	const play = page.locator(".tl2-tlbar [data-transport='play']");
	await play.click();
	await expect
		.poll(async () => scroller.evaluate((n) => n.scrollLeft), {
			message: `the view did not move with the playhead (stayed at ${before})`,
			timeout: 10_000,
		})
		.toBeGreaterThan(before + 20);
	await play.click();
	expect(await centreOffset(), "the playhead left the centre during playback").toBeLessThan(4);

	/* Scrolling the lanes back to the start is a seek to zero. */
	await scroller.evaluate((n) => {
		/* A wheel first: a bare offset write is what the browser's own clamping
		   looks like, and that must NOT seek. */
		n.dispatchEvent(new WheelEvent("wheel", { deltaX: -1 }));
		n.scrollLeft = 0;
	});
	await expect(page.locator(".tl2-tlbar [data-transport='timecode']").first()).toContainText(
		/^0?0:00/,
	);
	expect(await centreOffset(), "the playhead left the centre after a scroll").toBeLessThan(4);
});

test("the toolbar keeps only undo, redo and play; the rest is behind More", async ({ page }) => {
	/* 19 controls do not fit 393px. The wrap that preceded this kept them all
	 * across three rows and spent ~110px — 17% of the viewport — against a
	 * timeline measuring 126-190px. */
	const bar = page.locator(".tl2-tlbar");
	const rows = await bar.evaluate((el) => {
		const own = el.getBoundingClientRect();
		return { height: Math.round(own.height) };
	});
	expect(rows.height).toBeLessThan(64); // one row, not three

	/* Named exhaustively, not checked for presence. "Only" is the whole claim of
	   this requirement, and a presence check cannot make it: a control that
	   creeps back onto the bar passes every assertion below and moves too few
	   pixels for the screenshot to fail — see `playwright.config.ts`. */
	await expectControls(
		page.locator(".tl2-tlbar"),
		["Undo", "Redo", "Play", "More tools"],
		"phone transport bar",
	);
	/* The timecode is a readout rather than a control, so it is not in the
	   inventory and is asserted on its own. */
	await expect(page.locator("[data-transport='timecode']")).toBeVisible();

	/* Moved out of the bar, not deleted. */
	await expect(page.locator(".tl2-tlbar .tl2-zoom")).toHaveCount(0);
	await expect(page.locator('.tl2-tlbar [title="Aspect ratio"]')).toHaveCount(0);
});

test("More opens a sheet holding the rest of the tools, and closes", async ({ page }) => {
	const sheet = page.locator(".tl2-more-sheet");
	await expect(sheet).not.toHaveClass(/ui-sheet-open/);

	await page.locator('[title="More tools"]').click();
	await expect(sheet).toHaveClass(/ui-sheet-open/);

	// The controls that left the bar are reachable here.
	await expect(sheet.locator('[title="Aspect ratio"]')).toBeVisible();
	await expect(sheet.locator('[title="Trim / split at playhead (S)"]')).toBeVisible();
	await expect(sheet.locator(".tl2-zoom-slider")).toBeVisible();

	/* The density toggle is deliberately absent rather than relocated:
	 * `pointer: coarse` forces compact metrics, so it is inert on a phone. */
	await expect(
		sheet.locator('[title="Toggle compact / comfortable timeline density"]'),
	).toHaveCount(0);

	await page.locator(".ui-sheet-scrim.ui-sheet-open").click({ position: { x: 10, y: 10 } });
	await expect(sheet).not.toHaveClass(/ui-sheet-open/);
});

test("the nav drawer opens above the editor chrome and above a sheet", async ({ page }) => {
	/* Navigation uses the shared VUI Sheet layer, above editor chrome. Sheets
	 * share a z-index and their portal order supplies the stack; verify the
	 * actual hit target below as well as that layer.
	 *
	 * The sheet is read while CLOSED on purpose. With one open its scrim covers
	 * the hamburger, which is correct modal behaviour rather than the bug —
	 * clicking through it would be testing the wrong thing. */
	await page.locator(".cv-hamburger").click();
	const drawer = page.locator(".nav-drawer");
	await expect(drawer).toHaveClass(/open/);
	/* Wait out the slide-in. The `open` class lands before the transform
	 * finishes, and the JS matchMedia stub in beforeEach does not reach a CSS
	 * `prefers-reduced-motion` query — so mid-transition the drawer's centre is
	 * still off to the left and hit-tests to whatever is underneath. */
	await page.waitForFunction(() => {
		const el = document.querySelector(".nav-drawer")!;
		return (
			getComputedStyle(el).transform === "none" ||
			getComputedStyle(el).transform === "matrix(1, 0, 0, 1, 0, 0)"
		);
	});

	const z = await page.evaluate(() => {
		const n = (s: string) => Number(getComputedStyle(document.querySelector(s)!).zIndex);
		return {
			drawer: n(".nav-drawer"),
			scrim: n(".ui-sheet-scrim"),
			sheet: n(".tl2-more-sheet"),
			topbar: n('[data-slot="topbar"][data-variant="editor"]'),
		};
	});
	expect(z.drawer).toBeGreaterThan(z.topbar);
	expect(z.drawer).toBeGreaterThanOrEqual(z.sheet);
	expect(z.scrim).toBeGreaterThan(z.topbar);

	/* And it is the thing under the finger at its own coordinates — a z-index
	 * that wins on paper still loses to a stacking context it cannot escape. */
	const box = (await drawer.boundingBox())!;
	const hit = await page.evaluate(
		([x, y]) => {
			const el = document.elementFromPoint(x as number, y as number);
			return el?.closest(".nav-drawer") ? "drawer" : "something else";
		},
		[Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)],
	);
	expect(hit).toBe("drawer");
});

/* ── The rendering guard ──
 *
 * Four of the five defects in the layout work were one failure: an element
 * with a correct-looking box and nothing drawn inside it. These assert the
 * category rather than those four instances, because the value is in the ones
 * nobody has opened on a phone yet.
 */

test("every surface that must draw, draws", async ({ page }) => {
	for (const sel of [
		".tl2-tlbar",
		".tl2-stage-top",
		".tl2-preview",
		".tl2-canvas",
		".tl2-timeline",
		".tl2-rail",
	]) {
		await expectRenders(page, sel);
	}
});

test("the panel sheet draws when opened", async ({ page }) => {
	await page.keyboard.press("Alt+Digit1");
	const sheet = page.locator(".tl2-panel-sheet");
	await expect(sheet).toBeVisible();
	await settled(page, ".tl2-panel-sheet");
	await expectRenders(page, ".tl2-panel-sheet");
});

test("the More sheet draws when opened", async ({ page }) => {
	await page.locator('[title="More tools"]').click();
	await expect(page.locator(".tl2-more-sheet")).toHaveClass(/ui-sheet-open/);
	await settled(page, ".tl2-more-sheet");
	await expectRenders(page, ".tl2-more-sheet");
});

test("the nav drawer draws when opened", async ({ page }) => {
	await page.locator(".cv-hamburger").click();
	await expect(page.locator(".nav-drawer")).toHaveClass(/open/);
	await settled(page, ".nav-drawer");
	await expectRenders(page, ".nav-drawer");
});

/* Walked mechanically rather than hand-picked. A list someone curated can only
 * contain surfaces they thought of, and the phone path has rendered perhaps
 * two of these nine — the rest are exactly where undiscovered instances live. */
const RAIL_DESTINATIONS = [
	"Assets",
	"Chat",
	"Style",
	"Templates",
	"Elements",
	"Transitions",
	"Effects",
	"Captions",
	"Project",
] as const;

/* Chat keeps its Alt+2 slot, so the shortcut indexes the full table; it is the
 * workspace's Chat view on a phone rather than a sheet, and is skipped here. */
for (const [i, rail] of RAIL_DESTINATIONS.entries()) {
	if (rail === "Chat") continue;
	test(`rail destination ${rail.toLowerCase()} draws in its sheet`, async ({ page }) => {
		await page.keyboard.press(`Alt+Digit${i + 1}`);
		const sheet = page.locator(".tl2-panel-sheet");
		await expect(sheet).toBeVisible();
		await settled(page, ".tl2-panel-sheet");
		await expectRenders(page, ".tl2-panel-sheet", `rail:${rail}`);
		await expectHasContent(page, ".tl2-panel-sheet", `rail:${rail}`);

		/* And offers a way out. This became load-bearing when sheets started
		 * filling the band exactly: the scrim is now entirely underneath the
		 * sheet, so a destination whose header lacks a close control would trap
		 * the operator with only the device's Back button — which is not a
		 * control anyone can see. Walked per destination because the nine render
		 * nine different panels. */
		await expectRenders(page, '.tl2-panel-sheet [title="Hide panel"]', `rail:${rail}: no way out`);
	});
}

test("there is no stage/timeline splitter to drag", async ({ page }) => {
	/* Removed from the phone, having been added for it. The argument that put it
	 * there — no fixed stage/timeline share suits every project — was sound and
	 * still is; what changed is how many gestures the timeline now owns. Pan,
	 * clip move, trim, scrub and pinch all live there, and a 28px strip whose
	 * only purpose is a sixth drag sat directly between two of them.
	 *
	 * Asserted as an absence, because a control that is present but inert is the
	 * failure this replaces, not the fix. */
	await expect(page.locator(".tl2-pane-separator")).toHaveCount(0);
});

/* ── A retired image project on a phone ──
 *
 * Image projects are retired: they open as manual editors with no chat, so on a
 * phone there is no Editor | Chat switch at all, only the work.
 *
 * Its own HAR, because re-recording api.har needs every service every covered
 * screen touches.
 */
test.describe("legacy image workspace", () => {
	const IMAGE_HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-image.har");
	const IMAGE_PROJECT = "00000000-0000-4000-8000-000000000002";

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, IMAGE_HAR);
		await page.goto(`/content/${IMAGE_PROJECT}`);
		await page.locator(".cv-chatsplit-main").waitFor({ state: "visible", timeout: 60_000 });
		await page.evaluate(() => document.fonts.ready);
	});

	test("opens on its editor with no Chat view to switch to", async ({ page }) => {
		await expect(page.locator(".cv-phonews")).toHaveCount(0);
		await expect(page.getByRole("tab", { name: "Chat", exact: true })).toHaveCount(0);
		await expectRenders(page, ".cv-chatsplit-main");
	});

	test("the workspace itself fits the viewport", async ({ page }) => {
		const vp = page.viewportSize()!;
		const box = (await page.locator(".cv-chatsplit-main").boundingBox())!;
		expect(box.width).toBeLessThanOrEqual(vp.width + 1);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			vp.width,
		);
	});
});

/* ── Selection is a mode ──
 *
 * The interaction these assert is not "a gesture works". It is that a press
 * means exactly one thing: on a coarse pointer an unselected clip's press
 * belongs to the pan, and only a selected clip's press moves it. Both halves
 * fail silently in opposite directions — too permissive and every scroll
 * displaces a clip by a frame, too strict and clips cannot be moved at all —
 * so each is asserted separately rather than inferred from the other.
 *
 * Driven with `page.mouse` rather than `touchscreen`, which cannot express a
 * press-move-release. That is sound here because the gate keys off the
 * `pointer: coarse` MEDIA QUERY, not off `event.pointerType`: in this project
 * the media query is true, so these events take the coarse path. The guard
 * above ("the emulation really is a coarse pointer") is what keeps that true.
 *
 * What they cannot see is feel — inertia, momentum, and whether the hold reads
 * as responsive or laggy under a real thumb. That needs a device.
 */
test.describe("selection is a mode", () => {
	/** Where a clip sits, read from the inline `left` the timeline writes rather
	 *  than from a bounding box: the box moves when the lanes scroll, which is
	 *  the very thing an unselected press is supposed to do. */
	async function clipLeft(page: Page): Promise<string> {
		return page
			.locator("[data-vui-slot='item']")
			.first()
			.evaluate((el) => (el as HTMLElement).style.left);
	}

	/** A press-move-release over the first clip, in mouse events.
	 *
	 *  The pause after the press is not padding. The coarse-pointer drag gate is
	 *  movement AND time — a press that crosses the threshold within 90ms is a
	 *  flick, which on a timeline means "throw the view", not "move this clip".
	 *  Synthesised input completes a 60px sweep in far less than any hand does,
	 *  so without the pause this helper tests a gesture no operator can make.
	 *  `hold` is a parameter rather than a constant because one test needs to
	 *  drive the flick case deliberately. */
	async function pressMove(page: Page, dx: number, hold = 140): Promise<void> {
		const box = (await page.locator("[data-vui-slot='item']").first().boundingBox())!;
		const x = Math.round(box.x + box.width / 2);
		const y = Math.round(box.y + box.height / 2);
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.waitForTimeout(hold);
		/* One move rather than a sweep. Each synthesised step is a round trip to
		 * the browser and costs real milliseconds, so a stepped sweep spends
		 * longer than the hold no matter what `hold` is set to — which made the
		 * flick case untestable and looked like a threshold that did not work. */
		await page.mouse.move(x + dx, y);
		await page.mouse.up();
	}

	test("a press that wobbles selects, and moves nothing", async ({ page }) => {
		/* The threshold's whole purpose. A finger never presses still, and 3px of
		 * tremor at normal zoom is a frame of displacement the operator did not
		 * ask for — on a surface where undo is several taps away. */
		const before = await clipLeft(page);
		await pressMove(page, 3);
		expect(await clipLeft(page), "a 3px wobble moved the clip").toBe(before);
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
	});

	test("dragging an unselected clip does not move it", async ({ page }) => {
		const before = await clipLeft(page);
		await pressMove(page, 60);
		expect(await clipLeft(page), "an unselected clip was dragged").toBe(before);
	});

	test("dragging a selected clip does move it", async ({ page }) => {
		/* The other half: the gate must open, or the fix for accidental edits is
		 * just a timeline that cannot be edited. */
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		const before = await clipLeft(page);
		await pressMove(page, 60);
		expect(await clipLeft(page), "a selected clip would not move").not.toBe(before);
	});

	test("a flick across a selected clip throws the view rather than the clip", async ({ page }) => {
		/* The time half of the threshold, asserted on its own so the pause in
		 * `pressMove` is a documented behaviour rather than a workaround someone
		 * later deletes as noise. 90ms is provisional until the device check. */
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		const before = await clipLeft(page);
		await pressMove(page, 60, 0);
		expect(await clipLeft(page), "a flick moved the clip").toBe(before);
	});

	test("no marquee appears when empty lane space is dragged", async ({ page }) => {
		/* Multi-select's gesture IS the pan gesture. On a phone the operator got a
		 * rubber band when they meant to scroll. */
		const lane = page.locator("[data-vui-slot='row']").last();
		const box = (await lane.boundingBox())!;
		const x = Math.round(box.x + box.width - 24);
		const y = Math.round(box.y + box.height / 2);
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(x - 80, y, { steps: 8 });
		await expect(page.locator(".tl2-marquee")).toHaveCount(0);
		await page.mouse.up();
	});

	test("selecting a clip swaps the rail for the contextual bar, and deselect restores it", async ({
		page,
	}) => {
		await expect(page.locator(".tl2-rail")).toBeVisible();
		await expect(page.locator(".tl2-clipbar")).toHaveCount(0);

		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		await expect(page.locator(".tl2-rail")).toHaveCount(0);
		/* At least one property group, from the same list the desktop inspector
		 * rail reads — an empty bar would pass a visibility assertion. */
		expect(await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").count()).toBeGreaterThan(0);

		await page.locator('.tl2-clipbar [aria-label="Close"]').click();
		await expect(page.locator(".tl2-rail")).toBeVisible();
		await expect(page.locator(".tl2-clipbar")).toHaveCount(0);
	});

	test("the transport stays reachable while a clip is selected", async ({ page }) => {
		/* The transport is a separate bar and must survive the swap: undo is what
		 * the operator reaches for in the seconds after an accidental edit, and
		 * needing to deselect first is exactly the wrong order. */
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		for (const sel of [
			'.tl2-tlbar [title^="Undo"]',
			'.tl2-tlbar [title^="Redo"]',
			".tl2-tlbar [data-transport='play']",
			".tl2-tlbar [data-transport='timecode']",
		]) {
			await expectRenders(page, sel, `transport:${sel}`);
		}
	});

	test("the contextual bar and its actions sheet draw", async ({ page }) => {
		/* The render guard from `add-mobile-render-guards`. These are new
		 * surfaces, and the failure that produced four bugs in the layout work —
		 * a correct box with nothing painted in it — has not been designed out. */
		await page.locator("[data-vui-slot='item']").first().click();
		/* Waited for, not assumed. Selecting a clip UNMOUNTS the rail and mounts
		 * the bar in its place, and measuring during that swap catches a box that
		 * is briefly nowhere — which fails as if the bar had not drawn. */
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		await expectRenders(page, ".tl2-clipbar");

		await page.locator('[aria-label="Clip actions"]').click();
		const sheet = page.locator(".tl2-clipactions-sheet");
		await expect(sheet).toHaveClass(/ui-sheet-open/);
		await settled(page, ".tl2-clipactions-sheet");
		await expectRenders(page, ".tl2-clipactions-sheet");
		await expectHasContent(page, ".tl2-clipactions-sheet");
	});

	test("the contextual bar does not run past the bottom of the viewport", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		const { bottom, viewport } = await fitsViewport(page, ".tl2-clipbar");
		expect(
			bottom,
			`the clip bar ends at ${bottom} in a ${viewport}px viewport`,
		).toBeLessThanOrEqual(viewport + 1);
	});
});

/* ── Clip properties ──
 *
 * The gap this closes is the one the layout work recorded and left open: the
 * docked inspector is a 340px column beside a preview, so at phone width it was
 * hidden and nothing replaced it. Clip properties were unreachable — every
 * control below was present in the tree and unopenable.
 */
test.describe("clip properties reach the phone", () => {
	test("property controls meet the touch floor and fit the sheet", async ({ page }) => {
		/* The rows are FieldRows of scrubbable number fields, 24px under a mouse.
		 * Under a finger every field, every icon cell (the size lock, the flips)
		 * and the row itself grow to `--control-h-touch`; a pair of fields stays
		 * on one line, and nothing runs past the edge. No slider remains. */
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator('.tl2-clipbar-groups .tl2-clipbar-btn[aria-label*="Transform"]').click();
		const sheet = page.locator(".tl2-clip-sheet");
		await expect(sheet).toHaveClass(/ui-sheet-open/);
		const rows = sheet.locator("[data-slot='property-row']");
		await expect(rows.first()).toBeVisible();
		const measured = await sheet.evaluate((el) => {
			const heights = (selector: string): number[] =>
				[...el.querySelectorAll(selector)].map((node) =>
					Math.round(node.getBoundingClientRect().height),
				);
			const tops = (row: string) =>
				[...el.querySelectorAll(`[role='group'][aria-labelledby] input`)]
					.filter(
						(input) =>
							input.closest("[data-slot='property-row']")?.querySelector(".ui-insp-label")
								?.textContent === row,
					)
					.map((input) => Math.round(input.getBoundingClientRect().top));
			return {
				sliders: heights("[data-slot='slider']").length,
				fields: heights("[data-slot='number-field'], [data-slot='select']"),
				cells: heights(
					"[data-slot='field-row'] > [data-slot='icon-button'], [data-slot='field-row'] > [data-slot='toggle']",
				),
				rows: heights("[data-slot='property-row']"),
				position: tops("Position"),
				overflowing: [...el.querySelectorAll("[data-slot='property-row']")].filter(
					(row) => row.getBoundingClientRect().right > window.innerWidth + 1,
				).length,
				scrolls: el.querySelector(".tl2-clip-content")
					? el.querySelector(".tl2-clip-content")!.scrollWidth >
						el.querySelector(".tl2-clip-content")!.clientWidth + 1
					: false,
			};
		});
		expect(measured.sliders, "the transform group has no slider").toBe(0);
		expect(measured.fields.length, "the transform group has number fields").toBeGreaterThan(0);
		for (const height of [...measured.fields, ...measured.cells, ...measured.rows])
			expect(height).toBeGreaterThanOrEqual(44);
		expect(measured.position.length, "Position holds X and Y").toBe(2);
		expect(new Set(measured.position).size, "X and Y share one line").toBe(1);
		expect(measured.overflowing, "no row runs past the viewport").toBe(0);
		expect(measured.scrolls, "the sheet does not scroll sideways").toBe(false);
	});

	test("a property group control opens the sheet at that group", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		const groups = page.locator(".tl2-clipbar-groups .tl2-clipbar-btn");
		expect(await groups.count()).toBeGreaterThan(0);

		/* Closed until asked for. Selection deliberately does NOT auto-open it:
		 * a sheet on every tap covers the timeline the operator just tapped. */
		await expect(page.locator(".tl2-clip-sheet")).not.toHaveClass(/ui-sheet-open/);

		const label = (await groups.first().getAttribute("aria-label"))!;
		await groups.first().click();
		const sheet = page.locator(".tl2-clip-sheet");
		await expect(sheet).toHaveClass(/ui-sheet-open/);
		await settled(page, ".tl2-clip-sheet");

		/* Opened AT that group, not merely opened. The inspector header names the
		 * active group, which is the only rendered evidence that the control
		 * carried its identity across rather than falling back to the first. */
		await expect(sheet.locator('.tl2-clip-head [data-slot="panel-header-sub"]')).toContainText(
			new RegExp(label, "i"),
		);

		await expectRenders(page, ".tl2-clip-sheet");
		await expectHasContent(page, ".tl2-clip-sheet");
	});

	test("the bar stays reachable under the open sheet, and switches groups", async ({ page }) => {
		/* The sheet stands off the bottom edge by the bar's height and so does its
		 * scrim. Both halves matter: a scrim left flush would leave the bar
		 * visible and dead, which reads as a broken control rather than a covered
		 * one — and the bar is where deselect lives, so covering it puts the
		 * mode's only exit underneath the thing the mode opened. */
		await page.locator("[data-vui-slot='item']").first().click();
		const groups = page.locator(".tl2-clipbar-groups .tl2-clipbar-btn");
		if ((await groups.count()) < 2) test.skip(true, "this clip kind has one property group");

		await groups.first().click();
		await settled(page, ".tl2-clip-sheet");

		// Still the topmost thing at its own centre, with the sheet open.
		await expectRenders(page, ".tl2-clipbar", "clip bar under the open sheet");

		const second = (await groups.nth(1).getAttribute("aria-label"))!;
		await groups.nth(1).click();
		await expect(
			page.locator('.tl2-clip-sheet .tl2-clip-head [data-slot="panel-header-sub"]'),
		).toContainText(new RegExp(second, "i"));
		await expectHasContent(page, ".tl2-clip-sheet");
	});

	test("the sheet and the bar together fit the viewport", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await settled(page, ".tl2-clip-sheet");

		const vp = page.viewportSize()!;
		const sheet = (await page.locator(".tl2-clip-sheet").boundingBox())!;
		const bar = (await page.locator(".tl2-clipbar").boundingBox())!;
		expect(sheet.y, "the sheet starts above the top of the viewport").toBeGreaterThanOrEqual(0);
		// The sheet ends where the bar begins, rather than running under it.
		expect(Math.round(sheet.y + sheet.height)).toBeLessThanOrEqual(Math.round(bar.y) + 1);
		expect(Math.round(bar.y + bar.height)).toBeLessThanOrEqual(vp.height + 1);
	});

	test("the sheet does not show the inspector's own icon rail", async ({ page }) => {
		/* The contextual bar IS the rail here. Two rows of the same glyphs read
		 * as two different controls. */
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await settled(page, ".tl2-clip-sheet");
		const railBox = await page.locator(".tl2-clip-sheet .tl2-clip-rail").boundingBox();
		expect(railBox, "the inspector's icon rail is visible inside the sheet").toBeNull();
	});

	test("losing the selection closes the properties sheet", async ({ page }) => {
		/* The sheet belongs to a selection and must die with one, or the empty
		 * inspector sits over the timeline that cleared it.
		 *
		 * Driven by DELETING the clip rather than by deselecting, and that is not
		 * a workaround: the bar's leading control can no longer deselect while a
		 * sheet is up — it offers Back instead — so deletion is the route that
		 * still pulls a selection out from under an open sheet. It is also the
		 * one that would hurt, since the sheet would be inspecting a clip that no
		 * longer exists. */
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await expect(page.locator(".tl2-clip-sheet")).toHaveClass(/ui-sheet-open/);

		await page.locator('.tl2-clipbar [aria-label="Clip actions"]').click();
		await page.locator(".tl2-clipaction.danger").click();

		await expect(page.locator(".tl2-clip-sheet")).not.toHaveClass(/ui-sheet-open/);
		/* Gone entirely, not merely closed: the actions sheet is rendered BY the
		 * contextual bar, and the bar unmounts with the selection it described. */
		await expect(page.locator(".tl2-clipactions-sheet")).toHaveCount(0);
		await expect(page.locator(".tl2-clipbar")).toHaveCount(0);
		await expect(page.locator(".tl2-rail"), "the tool rail did not return").toBeVisible();
	});
});

test("the two ellipsis controls are distinguishable in use", async ({ page }) => {
	/* Two ellipsis buttons end up on screen once a clip is selected — one on the
	 * transport, one on the contextual bar. The design accepted that rather than
	 * designing it away, having rejected text labels in favour of icons, so this
	 * records what makes them tellable apart instead of pretending the ambiguity
	 * is not there: different bars, far apart vertically, and only the
	 * contextual one takes an active state when its own sheet is open. */
	await page.locator("[data-vui-slot='item']").first().click();
	// The rail unmounts and the bar mounts in its place; measuring mid-swap
	// catches a box that is briefly nowhere.
	await expect(page.locator(".tl2-clipbar")).toBeVisible();
	const transport = page.locator('.tl2-tlbar [aria-label="More tools"]');
	const contextual = page.locator('.tl2-clipbar [aria-label="Clip actions"]');
	await expectRenders(page, '.tl2-tlbar [aria-label="More tools"]', "transport ellipsis");
	await expectRenders(page, '.tl2-clipbar [aria-label="Clip actions"]', "contextual ellipsis");

	const a = (await transport.boundingBox())!;
	const b = (await contextual.boundingBox())!;
	// Different bars, not adjacent controls in one.
	expect(Math.abs(b.y - a.y), "the two ellipsis controls sit at the same height").toBeGreaterThan(
		120,
	);

	// Opening one marks that one, and leaves the other alone.
	await contextual.click();
	await expect(contextual).toHaveClass(/\bon\b/);
	await expect(transport).not.toHaveClass(/\bon\b/);
});

/** Zoom the timeline, through the control an operator actually has: the zoom
 *  buttons live in the More sheet at phone width, two taps deep. Several tests
 *  need a timeline that overflows its viewport, or clips narrow enough to trip
 *  the minimum hit target, and the three-second fixture gives neither at the
 *  default zoom. */
async function zoomTimeline(page: Page, dir: "in" | "out", times: number): Promise<void> {
	await page.locator('[title="More tools"]').click();
	const btn = page.locator(`.tl2-more-sheet [title^="Zoom ${dir}"]`);
	for (let i = 0; i < times; i++) await btn.click();
	await page.locator('.tl2-more-sheet [aria-label="Close"]').click();
	await expect(page.locator(".tl2-more-sheet")).not.toHaveClass(/ui-sheet-open/);
}

/* ── Movement and trim ──
 *
 * The gestures here are the ones selection-as-a-mode exists to make possible.
 * They are asserted through geometry and declarations rather than through feel,
 * which is the honest limit of an emulated pointer: whether a 44px handle is
 * comfortable under a thumb, and whether edge auto-scroll accelerates the way a
 * hand expects, are device questions.
 */
test.describe("movement and trim", () => {
	const firstClip = "[data-vui-slot='item']";

	test("an unselected clip leaves the pan axis to the browser; a selected one does not", async ({
		page,
	}) => {
		/* Both directions are silent failures. Too much `none` and the timeline
		 * stops scrolling wherever a clip happens to be; too little and the
		 * browser steals the gesture mid-drag and the clip snaps back. */
		const before = await page
			.locator(firstClip)
			.first()
			.evaluate((el) => getComputedStyle(el).touchAction);
		expect(before, "an unselected clip must leave the browser its pan axis").toBe("pan-x");

		await page.locator(firstClip).first().click();
		const after = await page
			.locator(firstClip)
			.first()
			.evaluate((el) => getComputedStyle(el).touchAction);
		expect(after, "a selected clip's handler owns both axes").toBe("none");
	});

	test("trim handles appear only on the selected clip, at a touch size, inset", async ({
		page,
	}) => {
		/* Zoomed in so the clip is wider than body-plus-handles. At the default
		 * zoom the fixture's clips are 72px, below the threshold, and the test
		 * skipped itself into asserting nothing. */
		await zoomTimeline(page, "in", 6);
		const handles = page.locator(`${firstClip} [data-vui-slot^='trim-']`);
		for (const h of await handles.all())
			expect(await h.boundingBox(), "a handle is showing on an unselected clip").toBeNull();

		await page.locator(firstClip).first().click();
		const clip = (await page.locator(firstClip).first().boundingBox())!;
		expect(clip.width, "still too narrow to carry handles after zooming in").toBeGreaterThan(132);
		const shown = page.locator(`${firstClip} [data-vui-slot^='trim-']`).first();
		const box = await shown.boundingBox();
		expect(box, "a selected, wide clip has no trim handles").not.toBeNull();

		expect(box!.width, "a trim handle is under the platform minimum").toBeGreaterThanOrEqual(44);
		/* Inset, not overhanging. The desktop handles stick out by 3px, which at
		 * 44px would cover the neighbouring clip rather than this one's edge. */
		expect(box!.x).toBeGreaterThanOrEqual(clip.x - 1);
		expect(box!.x + box!.width).toBeLessThanOrEqual(clip.x + clip.width + 1);
	});

	test("a clip too narrow for body-plus-handles carries none", async ({ page }) => {
		/* Two 44px handles would meet in the middle and leave nothing to grab.
		 * That clip moves by its body and has to be zoomed into to trim — which
		 * costs nothing, because a frame is sub-pixel at that zoom anyway. */
		const narrow = await page.evaluate(() => {
			const el = Array.from(document.querySelectorAll("[data-vui-slot='item']")).find((c) =>
				c.classList.contains("narrow"),
			);
			if (!el) return null;
			el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
			return el.getAttribute("data-clipid");
		});
		if (!narrow) test.skip(true, "no clip is narrow enough at this zoom");

		const handles = await page.locator(`[data-clipid="${narrow}"] [data-vui-slot^='trim-']`).all();
		for (const h of handles)
			expect(await h.boundingBox(), "a narrow clip is showing trim handles").toBeNull();
	});

	test("a clip padded to a tappable width says so", async ({ page }) => {
		/* Padding breaks the timeline's promise that width means duration. The
		 * alternative is a clip that cannot be tapped, so the padding stays —
		 * and is drawn, rather than applied behind the operator's back. */
		const padded = await page.evaluate(() => {
			const els = Array.from(document.querySelectorAll<HTMLElement>("[data-vui-slot='item']"));
			const el = els.find((c) => c.classList.contains("padded"));
			if (!el) return null;
			return {
				id: el.dataset.clipid,
				width: el.getBoundingClientRect().width,
				hatch: getComputedStyle(el, "::after").backgroundImage,
			};
		});
		if (!padded) {
			test.skip(true, "no clip is short enough to need padding at this zoom");
			return;
		}

		expect(
			padded.width,
			"a padded clip is still under the platform minimum",
		).toBeGreaterThanOrEqual(43);
		expect(padded.hatch, "the padding is applied silently").toContain("gradient");

		/* And the flag says so where it is decidable rather than inferable. The
		   drawing being wider than the duration is a fact the kernel computes; the
		   hatch is how this editor chooses to disclose it, and a test that only
		   read the hatch could not tell a disclosed discrepancy from a decorative
		   one. */
		const geometry = await itemGeometry(page, EDITOR_TIMELINE, padded.id!);
		expect(geometry.padded, "a padded clip did not report itself padded").toBe(true);
		expect(
			widthOf(geometry.paintBox),
			"the drawing is not wider than the duration it stands for",
		).toBeGreaterThan(widthOf(geometry.timeBox));
	});

	test("dragging a selected clip to the right edge scrolls the timeline", async ({ page }) => {
		/* Without this a clip cannot be moved further than one viewport width,
		 * which on a phone is a few seconds of timeline.
		 *
		 * Zoomed in first, deliberately. The fixture is three seconds long and
		 * fits the viewport at the default zoom, so there is no overflow to
		 * scroll and the test passed by asserting nothing. */
		await zoomTimeline(page, "in", 6);
		const scroller = page.locator("[data-vui-slot='timeline-scroller']");
		const overflow = await scroller.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(overflow, "the timeline still fits — nothing to auto-scroll into").toBeGreaterThan(40);

		await page.locator(firstClip).first().click();
		const before = await scroller.evaluate((el) => el.scrollLeft);

		const clip = (await page.locator(firstClip).first().boundingBox())!;
		const rect = (await scroller.boundingBox())!;
		/* Near the clip's start, not its middle: selecting it puts its start on
		 * the centred playhead, so its middle can sit past the right edge. */
		await page.mouse.move(Math.round(clip.x + 24), Math.round(clip.y + clip.height / 2));
		await page.mouse.down();
		await page.waitForTimeout(140);
		await page.mouse.move(
			Math.round(rect.x + rect.width - 6),
			Math.round(clip.y + clip.height / 2),
		);
		// The rAF loop keeps scrolling while the pointer rests in the edge zone.
		await page.waitForTimeout(500);
		const after = await scroller.evaluate((el) => el.scrollLeft);
		await page.mouse.up();

		expect(after, "the timeline did not follow the drag past its edge").toBeGreaterThan(before);
	});

	test("frame steppers are reachable and move the clip by exactly one frame", async ({ page }) => {
		/* The one control here that beats the desktop affordance instead of
		 * approximating it: a drag quantises to 0.1s, this resolves one frame. */
		await page.locator(firstClip).first().click();
		const timing = page.locator('.tl2-clipbar-groups [aria-label="Timing"]');
		if (!(await timing.count())) test.skip(true, "this clip kind has no timing group");
		await timing.click();
		await settled(page, ".tl2-clip-sheet");

		/* Stepped BACK, not forward. The fixture's clip already ends at the end
		 * of the timeline, where Out is correctly clamped — so a forward step
		 * asserted the clamp and read as a broken stepper. */
		const out = page.locator('[aria-label="Out back one frame"]');
		await expect(out).toBeVisible();
		const read = (): Promise<string> =>
			page.locator(".tl2-frametrim-row").nth(1).locator(".tl2-frametrim-value").innerText();
		const before = await read();
		await out.click();
		const after = await read();
		expect(after, "the Out stepper did not move the clip").not.toBe(before);
		/* Exactly one frame. The rate comes from the control's own note rather
		 * than a constant here, because the fixture's fps is the composition's
		 * and a hard-coded 30 would pass on a 30fps project and lie on any
		 * other. `mm:ss.ff`, so total frames is seconds * fps + frames. */
		const fps = Number(
			(await page.locator('.tl2-frametrim [data-slot="note"]').innerText()).match(
				/at (\d+)fps/,
			)![1],
		);
		const frames = (tc: string): number => {
			const [clock, f] = tc.split(".");
			const [m, sec] = clock!.split(":");
			return (Number(m) * 60 + Number(sec)) * fps + Number(f);
		};
		const delta = frames(before) - frames(after);
		expect(delta, `one frame back, not ${delta}`).toBe(1);

		// And the target is at least the platform minimum, since it is tapped repeatedly.
		const box = (await out.boundingBox())!;
		expect(Math.min(box.width, box.height)).toBeGreaterThanOrEqual(44);
	});
});

/* ── One surface per gesture ──
 *
 * Scrub and pan both want a horizontal drag. Disambiguating them by velocity or
 * duration produces a control that behaves differently depending on how fast
 * the operator moved, which is unlearnable; separate surfaces are learnable in
 * one try. These assert the separation holds in both directions, because a
 * surface that does BOTH reads as working right up until it does the wrong one.
 */
test.describe("one surface per gesture", () => {
	/** A real two-finger gesture. Playwright's touchscreen only taps, so the
	 *  pinch goes through CDP — the only way to put two contacts on the screen
	 *  at once, and therefore the only way to exercise the handler at all. */
	async function pinch(
		page: Page,
		cx: number,
		cy: number,
		from: number,
		to: number,
	): Promise<void> {
		const cdp = await page.context().newCDPSession(page);
		const pair = (gap: number) => [
			{ x: cx - gap / 2, y: cy, radiusX: 8, radiusY: 8, force: 1 },
			{ x: cx + gap / 2, y: cy, radiusX: 8, radiusY: 8, force: 1 },
		];
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pair(from) });
		for (let i = 1; i <= 8; i++) {
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: pair(from + ((to - from) * i) / 8),
			});
		}
		await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
		await cdp.detach();
	}

	async function cancelledSweep(page: Page, fromX: number, toX: number, y: number): Promise<void> {
		const cdp = await page.context().newCDPSession(page);
		const point = (x: number) => [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 9 }];
		await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(fromX) });
		for (let i = 1; i <= 6; i++) {
			await cdp.send("Input.dispatchTouchEvent", {
				type: "touchMove",
				touchPoints: point(fromX + ((toX - fromX) * i) / 6),
			});
		}
		await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
		await cdp.detach();
	}

	test("dragging the ruler moves the playhead", async ({ page }) => {
		const before = await page.locator("[data-transport='timecode']").innerText();
		const ruler = (await page.locator("[data-vui-slot='ruler']").boundingBox())!;
		const y = Math.round(ruler.y + ruler.height / 2);
		await page.mouse.move(Math.round(ruler.x + 30), y);
		await page.mouse.down();
		await page.mouse.move(Math.round(ruler.x + 150), y, { steps: 6 });
		await page.mouse.up();
		expect(
			await page.locator("[data-transport='timecode']").innerText(),
			"the ruler did not scrub",
		).not.toBe(before);
	});

	test("dragging the lane area does not move the playhead", async ({ page }) => {
		/* The other half. Empty lane space used to scrub on press, which on a
		 * finger means every attempt to scroll the timeline also seeks. */
		const before = await page.locator("[data-transport='timecode']").innerText();
		const lane = (await page.locator("[data-vui-slot='row']").last().boundingBox())!;
		const y = Math.round(lane.y + lane.height / 2);
		await page.mouse.move(Math.round(lane.x + lane.width - 30), y);
		await page.mouse.down();
		await page.mouse.move(Math.round(lane.x + lane.width - 150), y, { steps: 6 });
		await page.mouse.up();
		expect(
			await page.locator("[data-transport='timecode']").innerText(),
			"the lane area scrubbed",
		).toBe(before);
	});

	test("a pinch zooms the timeline, and the page does not scale", async ({ page }) => {
		const zoomOf = (): Promise<number> =>
			page.locator("[data-vui-slot='rows']").evaluate((el) => el.getBoundingClientRect().width);
		const before = await zoomOf();
		const scroller = (await page.locator("[data-vui-slot='timeline-scroller']").boundingBox())!;

		await pinch(
			page,
			Math.round(scroller.x + scroller.width / 2),
			Math.round(scroller.y + scroller.height / 2),
			60,
			220,
		);
		await page.waitForTimeout(150);

		expect(await zoomOf(), "the pinch did not change the timeline scale").toBeGreaterThan(before);
		/* And it zoomed the TIMELINE, not the document. The PWA viewport disables
		 * user scaling, so a page that scaled here would mean the pinch escaped
		 * to the browser — visible as a changed visual viewport scale. */
		expect(await page.evaluate(() => visualViewport?.scale ?? 1), "the page scaled").toBeCloseTo(
			1,
			2,
		);
	});

	test("a ruler sweep marks a range; a ruler tap clears it", async ({ page }) => {
		/* One gesture, two outputs, rather than a range mode — a mode on top of
		 * selection-as-a-mode is what was rejected for multi-select. */
		await expect(page.locator(".tl2-rulerrange")).toHaveCount(0);

		const ruler = (await page.locator("[data-vui-slot='ruler']").boundingBox())!;
		const y = Math.round(ruler.y + ruler.height / 2);
		await page.mouse.move(Math.round(ruler.x + 40), y);
		await page.mouse.down();
		await page.mouse.move(Math.round(ruler.x + 190), y, { steps: 6 });
		await page.mouse.up();

		const band = page.locator(".tl2-rulerrange");
		await expect(band, "a ruler sweep marked no range").toHaveCount(1);
		expect((await band.boundingBox())!.width).toBeGreaterThan(24);

		/* The explicit control clears it too, and is tested because it is the
		 * dismissal an operator will reach for: it sits inside a surface whose own
		 * handler scrubs, so it has to stop the press reaching that handler or it
		 * would seek and re-mark on the way to clearing. */
		await band.locator('[aria-label="Clear timeline range"]').click();
		await expect(band, "the clear control left the range behind").toHaveCount(0);

		// And a tap clears it as well — the same gesture that seeks, below the threshold.
		await page.mouse.move(Math.round(ruler.x + 40), y);
		await page.mouse.down();
		await page.mouse.move(Math.round(ruler.x + 190), y, { steps: 6 });
		await page.mouse.up();
		await expect(band).toHaveCount(1);
		await page.mouse.click(Math.round(ruler.x + 60), y);
		await expect(band, "a ruler tap left the range behind").toHaveCount(0);

		const beforeCancel = await page.locator("[data-transport='timecode']").innerText();
		await cancelledSweep(page, Math.round(ruler.x + 40), Math.round(ruler.x + 190), y);
		await expect(band, "cancel left transient range behind").toHaveCount(0);
		expect(
			await page.locator("[data-transport='timecode']").innerText(),
			"cancel did not restore playhead",
		).toBe(beforeCancel);
	});

	test("a marked range survives to the operation that consumes it", async ({ page }) => {
		/* The point of the range is not the band. `organizeRange` already took
		 * "selected clips, or the current scene range"; this is the third and
		 * most explicit source, and it has to actually reach it. */
		const ruler = (await page.locator("[data-vui-slot='ruler']").boundingBox())!;
		const y = Math.round(ruler.y + ruler.height / 2);
		await page.mouse.move(Math.round(ruler.x + 20), y);
		await page.mouse.down();
		await page.mouse.move(Math.round(ruler.x + 200), y, { steps: 6 });
		await page.mouse.up();
		await expect(page.locator(".tl2-rulerrange")).toHaveCount(1);

		await page.locator('[title="More tools"]').click();
		const organize = page.locator(".tl2-more-sheet").getByTitle(/^Organize selected clips/);
		await expect(organize).toBeVisible();
		await organize.click();
		// It reports on what it did rather than silently doing nothing.
		await expect(organize).not.toHaveText(/Organize range/);
	});

	test("every timeline surface declares only the axes it handles", async ({ page }) => {
		/* A wrong value fails silently in both directions, so it is asserted
		 * directly rather than inferred from a gesture that might be passing for
		 * an unrelated reason. */
		const declared = async (sel: string): Promise<string> =>
			page
				.locator(sel)
				.first()
				.evaluate((el) => getComputedStyle(el).touchAction);

		// The browser still scrolls this one, and giving up pinch is what lets the
		// zoom handler see both pointers.
		expect(await declared("[data-vui-slot='timeline-scroller']"), "the scroller").toBe("pan-x");
		// Its handler owns the horizontal drag; there is no vertical scroll to keep.
		expect(await declared("[data-vui-slot='ruler']"), "the ruler").toBe("none");
		// An unselected clip's press belongs to the pan.
		expect(await declared("[data-vui-slot='item']"), "an unselected clip").toBe("pan-x");

		await page.locator("[data-vui-slot='item']").first().click();
		expect(await declared("[data-vui-slot='item']"), "a selected clip").toBe("none");
	});
});

/* ── The render guard, walked ──
 *
 * Every surface added by this change, opened and measured. Walked mechanically
 * rather than hand-picked for the reason the rail destinations are: a list
 * someone curated can only contain the surfaces they thought of, and the
 * failure that produced four bugs in the layout work — a correct box with
 * nothing painted inside it — has not been designed out, only detected faster.
 *
 * Every clip in the fixture, and every property group each clip kind offers.
 *
 * The limit is the fixture, and it is worth stating rather than leaving for
 * someone to assume away: this project holds a text clip and an effect clip, so
 * the scene, b-roll and audio kinds — and the groups only they
 * carry, including the Timing group b-roll gained for the frame steppers — are
 * not walked here. Their markup is the same tree from the same source list, but
 * "same code path" is exactly the argument that was wrong four times in the
 * layout work. A fixture with one clip of each kind would close it.
 */
test("every clip's every property group draws in its sheet", async ({ page }) => {
	const clips = await page.locator("[data-vui-slot='item']").count();
	expect(clips, "the fixture has no clips to walk").toBeGreaterThan(0);

	for (let i = 0; i < clips; i++) {
		await page.locator("[data-vui-slot='item']").nth(i).click();
		const id = await page.locator("[data-vui-slot='item']").nth(i).getAttribute("data-clipid");
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		await expectRenders(page, ".tl2-clipbar", `clip ${id}: contextual bar`);

		const groups = page.locator(".tl2-clipbar-groups .tl2-clipbar-btn");
		const count = await groups.count();
		expect(count, `clip ${id}: no property groups`).toBeGreaterThan(0);

		for (let g = 0; g < count; g++) {
			const label = await groups.nth(g).getAttribute("aria-label");
			await groups.nth(g).click();
			await settled(page, ".tl2-clip-sheet");
			await expectRenders(page, ".tl2-clip-sheet", `clip ${id} / ${label}`);
			await expectHasContent(page, ".tl2-clip-sheet", `clip ${id} / ${label}`);
		}

		/* Two steps, because the bar's leading control means the nearest layer:
		 * Back puts the sheet down, Close then ends the selection. */
		await page.locator('.tl2-clipbar [aria-label="Back"]').click();
		await page.locator('.tl2-clipbar [aria-label="Close"]').click();
		await expect(page.locator(".tl2-rail")).toBeVisible();
	}
});

/* ── The bottom bar's own rules ── */
test.describe("the contextual bar", () => {
	/* What each clip kind's bar holds, by name.
	 *
	 * The screenshots cannot make this claim: a group added or removed here is a
	 * glyph's worth of ink on a light strip, which is fewer pixels than the
	 * comparison tolerates — the arithmetic is in `playwright.config.ts`. The
	 * property groups are a requirement of this surface, so they are named.
	 *
	 * Two kinds, because the fixture holds two clips. The same limit the
	 * property-group walk states above: a fixture with one clip of every kind
	 * would close it, and the scene, b-roll and audio bars are
	 * unasserted until it does.
	 */
	const CLIP_BARS = [
		["text:1", ["Close", "Text", "Transform", "Animation", "Blending", "Timing", "Clip actions"]],
		["effect:3", ["Close", "Effect", "Clip actions"]],
	] as const;

	test("holds the property groups its clip kind offers, and nothing else", async ({ page }) => {
		for (const [clipId, inventory] of CLIP_BARS) {
			const clip = page.locator(`[data-vui-slot='item'][data-clipid='${clipId}']`);
			await expect(clip, `the fixture has no ${clipId} clip`).toHaveCount(1);
			await clip.click();
			await expect(page.locator(".tl2-clipbar")).toBeVisible();
			await expectControls(page.locator(".tl2-clipbar"), inventory, `${clipId} bar`);
			await page.locator('.tl2-clipbar [aria-label="Close"]').click();
		}
	});

	test("carries no captions under its glyphs, and one label overall", async ({ page }) => {
		/* Icon-only. The subject is the exception and the reason for it: it is the
		 * one thing in the bar that has to be READ rather than recognised, and a
		 * caption under every glyph competes with it for the same glance. */
		await page.locator("[data-vui-slot='item']").first().click();
		const bar = page.locator(".tl2-clipbar");
		await expect(bar.locator(".tl2-clipbar-btn em")).toHaveCount(0);

		const text = (await bar.innerText()).trim();
		const subject = (await bar.locator(".tl2-clipbar-subject").innerText()).trim();
		expect(text, "the bar carries text beyond its subject label").toBe(subject);
		expect(subject.length, "the subject label is empty").toBeGreaterThan(0);
	});

	test("spaces its controls evenly and scrolls rather than shrinking them", async ({ page }) => {
		await page.locator("[data-vui-slot='item']").first().click();
		const bar = page.locator(".tl2-clipbar");

		// Every control keeps the platform minimum, whatever the group count.
		for (const b of await bar.locator(".tl2-clipbar-btn").all()) {
			const box = (await b.boundingBox())!;
			expect(
				Math.min(box.width, box.height),
				"a control was squeezed below the touch minimum",
			).toBeGreaterThanOrEqual(44);
		}

		/* One gap everywhere. Measured between rendered boxes rather than read
		 * from the declaration, because `margin-left: auto` produced a bar that
		 * declared a uniform gap and did not have one. */
		const gaps = await bar.evaluate((el) => {
			const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
			return kids.slice(1).map((r, i) => Math.round(r.left - kids[i]!.right));
		});
		expect(gaps.length).toBeGreaterThan(0);
		expect(new Set(gaps).size, `uneven gaps: ${gaps.join(", ")}`).toBe(1);

		// And it is a scroll container on the axis it can overflow.
		expect(await bar.evaluate((el) => getComputedStyle(el).overflowX)).toBe("auto");
		expect(await bar.evaluate((el) => getComputedStyle(el).touchAction)).toBe("pan-x");
	});

	test("only one bottom sheet can be open at a time", async ({ page }) => {
		/* Three sheets share this edge and used to hold three private booleans, so
		 * nothing stopped two being true: clip properties and the tools sheet
		 * stacked, the lower one showing around the edges of the upper and both
		 * claiming the same scrim.
		 *
		 * Driven through the transitions an operator can actually reach. The
		 * transport sits ABOVE the bar and therefore behind the scrim, so "open
		 * tools while properties is open" is not a path a finger can take — the
		 * pairs below are, because the contextual bar deliberately stays live
		 * underneath its own sheets. */
		const open = (): Promise<number> => page.locator(".ui-sheet.ui-sheet-open").count();

		// Tools alone, before any clip is selected.
		await page.locator('.tl2-tlbar [aria-label="More tools"]').click();
		await expect(page.locator(".tl2-more-sheet")).toHaveClass(/ui-sheet-open/);
		expect(await open()).toBe(1);
		await page.locator(".ui-sheet-scrim.ui-sheet-open").click({ position: { x: 10, y: 10 } });
		await expect(page.locator(".tl2-more-sheet")).not.toHaveClass(/ui-sheet-open/);

		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await expect(page.locator(".tl2-clip-sheet")).toHaveClass(/ui-sheet-open/);
		expect(await open()).toBe(1);

		// Actions, opened from the bar while properties is showing.
		await page.locator('.tl2-clipbar [aria-label="Clip actions"]').click();
		await expect(page.locator(".tl2-clipactions-sheet")).toHaveClass(/ui-sheet-open/);
		await expect(
			page.locator(".tl2-clip-sheet"),
			"properties stayed open under the actions sheet",
		).not.toHaveClass(/ui-sheet-open/);
		expect(await open()).toBe(1);

		// And back the other way.
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await expect(page.locator(".tl2-clip-sheet")).toHaveClass(/ui-sheet-open/);
		await expect(
			page.locator(".tl2-clipactions-sheet"),
			"actions stayed open under the properties sheet",
		).not.toHaveClass(/ui-sheet-open/);
		expect(await open(), "more than one bottom sheet is open").toBe(1);
	});
});

/* ── Close on a sheet, Back on the bar ──
 *
 * Two different exits, and the distinction is load-bearing. A sheet is a thing
 * you CLOSE — it came from somewhere and that somewhere is still on screen
 * underneath it. The contextual bar is a MODE you go BACK from, and what you go
 * back to is the tool rail it replaced. Giving both the same glyph made the bar
 * look dismissible and the sheets look like navigation.
 *
 * The device's Back button still closes an open sheet, which is not the same
 * claim as the header making: it is the platform gesture for "undo this
 * layer", and without it Back leaves the editor from a project mid-edit.
 */
test.describe("close on a sheet, back on the bar", () => {
	const sheets = [
		{
			name: "tools",
			open: '.tl2-tlbar [aria-label="More tools"]',
			sheet: ".tl2-more-sheet",
			selectFirst: false,
		},
		{
			name: "clip properties",
			open: ".tl2-clipbar-groups .tl2-clipbar-btn",
			sheet: ".tl2-clip-sheet",
			selectFirst: true,
		},
		{
			name: "clip actions",
			open: '.tl2-clipbar [aria-label="Clip actions"]',
			sheet: ".tl2-clipactions-sheet",
			selectFirst: true,
		},
	] as const;

	test("the bar's leading control leaves the nearest layer, whichever that is", async ({
		page,
	}) => {
		/* Two things can be open and they nest, so one control cannot mean one
		 * thing. With a sheet up the nearest layer is the sheet; with nothing up
		 * it is the selection. Getting this wrong in the obvious direction —
		 * always deselect — threw the selection away when the operator only meant
		 * to put a sheet down. */
		await page.locator("[data-vui-slot='item']").first().click();
		const bar = page.locator(".tl2-clipbar");
		await expect(bar).toBeVisible();

		// Nothing open: Close, and it ends the selection.
		await expect(bar.locator('[aria-label="Close"]')).toHaveCount(1);
		await expect(
			bar.locator('[aria-label="Back"]'),
			"offers Back with no sheet to go back from",
		).toHaveCount(0);

		// Leading, so it reads as the way out rather than a confirm.
		const lead = (await bar.locator(".tl2-clipbar-lead").boundingBox())!;
		const barBox = (await bar.boundingBox())!;
		expect(lead.x - barBox.x, "the exit is not the leading control").toBeLessThan(20);

		// Sheet open: Back, and it puts the sheet down WITHOUT deselecting.
		await bar.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await expect(page.locator(".tl2-clip-sheet")).toHaveClass(/ui-sheet-open/);
		await expect(bar.locator('[aria-label="Back"]')).toHaveCount(1);
		await expect(
			bar.locator('[aria-label="Close"]'),
			"offers Close while a sheet is up",
		).toHaveCount(0);

		await bar.locator('[aria-label="Back"]').click();
		await expect(page.locator(".tl2-clip-sheet")).not.toHaveClass(/ui-sheet-open/);
		await expect(page.locator(".tl2-clipbar"), "back threw the selection away too").toBeVisible();

		// And now Close again, which does end it.
		await page.locator('.tl2-clipbar [aria-label="Close"]').click();
		await expect(page.locator(".tl2-rail"), "close did not return to the tool rail").toBeVisible();
	});

	test("the tools sheet also turns the bar's exit into Back", async ({ page }) => {
		/* The tools sheet opens from the transport, not from this bar, but it
		 * covers the same layer — so the bar has to offer the way out of it or it
		 * would offer to deselect with something still open on top. */
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator('.tl2-tlbar [aria-label="More tools"]').click();
		await expect(page.locator(".tl2-more-sheet")).toHaveClass(/ui-sheet-open/);
		await expect(page.locator('.tl2-clipbar [aria-label="Back"]')).toHaveCount(1);

		await page.locator('.tl2-clipbar [aria-label="Back"]').click();
		await expect(page.locator(".tl2-more-sheet")).not.toHaveClass(/ui-sheet-open/);
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
	});

	for (const s of sheets) {
		test(`${s.name}: the sheet offers Close, not Back`, async ({ page }) => {
			if (s.selectFirst) await page.locator("[data-vui-slot='item']").first().click();
			await page.locator(s.open).first().click();
			await expect(page.locator(s.sheet)).toHaveClass(/ui-sheet-open/);
			await settled(page, s.sheet);

			const close = page.locator(`${s.sheet} [aria-label="Close"]`);
			await expect(close, "no close control in the sheet header").toHaveCount(1);
			await expect(
				page.locator(`${s.sheet} [aria-label="Back"]`),
				"the sheet offers a back instead of a close",
			).toHaveCount(0);

			/* Trailing, where a dismissal belongs. A close on the leading edge
			 * reads as navigation, which is the bar's job and not this one's. */
			const closeBox = (await close.boundingBox())!;
			const header = (await page.locator(`${s.sheet} header`).boundingBox())!;
			expect(
				header.x + header.width - (closeBox.x + closeBox.width),
				"close is not the trailing control",
			).toBeLessThan(24);

			await close.click();
			await expect(page.locator(s.sheet)).not.toHaveClass(/ui-sheet-open/);
		});

		test(`${s.name}: the device back button closes it rather than leaving the editor`, async ({
			page,
		}) => {
			const url = page.url();
			if (s.selectFirst) await page.locator("[data-vui-slot='item']").first().click();
			await page.locator(s.open).first().click();
			await expect(page.locator(s.sheet)).toHaveClass(/ui-sheet-open/);

			await page.goBack();
			await expect(page.locator(s.sheet), "back left the sheet open").not.toHaveClass(
				/ui-sheet-open/,
			);
			expect(page.url(), "back left the editor with a sheet open").toBe(url);
			await expect(page.locator(".tl2-timeline")).toBeVisible();
		});
	}

	test("closing by the header leaves Back pointing out of the editor again", async ({ page }) => {
		/* The bookkeeping half. Opening a sheet adds a history entry; closing it
		 * from the UI has to consume that entry, or Back needs pressing twice —
		 * once for a sheet that is no longer on screen. */
		const url = page.url();
		await page.locator('.tl2-tlbar [aria-label="More tools"]').click();
		await expect(page.locator(".tl2-more-sheet")).toHaveClass(/ui-sheet-open/);
		await page.locator('.tl2-more-sheet [aria-label="Close"]').click();
		await expect(page.locator(".tl2-more-sheet")).not.toHaveClass(/ui-sheet-open/);

		await page.goBack();
		expect(page.url(), "a stale history entry survived the sheet").not.toBe(url);
	});
});

/* ── What an open sheet covers, and what it does not ──
 *
 * A sheet spans the whole timeline region: the toolbar and the lanes. The
 * bottom bar is the only chrome left live under it, and it is the one that has
 * to be — it carries the selection, the way out of it, and the navigation
 * between rail destinations.
 *
 * The toolbar is covered BY REQUEST, and what that costs is asserted below
 * rather than left to be rediscovered. It holds undo, redo, play, the timecode
 * and the control that opens the tools sheet, so none of those can be reached
 * while any sheet is up.
 */
test.describe("what an open sheet covers", () => {
	for (const [name, open] of [
		["clip properties", ".tl2-clipbar-groups .tl2-clipbar-btn"],
		["clip actions", '.tl2-clipbar [aria-label="Clip actions"]'],
	] as const) {
		test(`${name}: covers the toolbar, spares the bar`, async ({ page }) => {
			await page.locator("[data-vui-slot='item']").first().click();
			await expect(page.locator(".tl2-clipbar")).toBeVisible();
			await page.locator(open).first().click();
			await settled(page, ".ui-sheet.ui-sheet-open");

			const geo = await page.evaluate(() => {
				const box = (q: string) => document.querySelector(q)!.getBoundingClientRect();
				return {
					sheet: box(".ui-sheet.ui-sheet-open"),
					transport: box(".tl2-tlbar"),
					bar: box(".tl2-bottombar"),
				};
			});
			expect(Math.round(geo.sheet.top), `${name}: left the toolbar showing`).toBeLessThanOrEqual(
				Math.round(geo.transport.top),
			);

			/* The bar, hittable rather than merely visible — the scrim has to
			 * stand off by the same amount as the sheet, or the bar is visible
			 * and dead, which reads as a broken control rather than a covered
			 * one. */
			await expectRenders(page, ".tl2-clipbar", `${name}: the bar`);
			expect(Math.round(geo.sheet.bottom), `${name}: runs under the bar`).toBeLessThanOrEqual(
				Math.round(geo.bar.top) + 1,
			);
		});
	}

	test("the toolbar's controls are unreachable while a sheet is up", async ({ page }) => {
		/* Recorded as a test rather than left as a surprise. Undo is what an
		 * operator reaches for straight after an edit they did not mean, and the
		 * tools sheet cannot be opened from another sheet at all — switching to
		 * it costs a dismiss and a reopen. That is the price of a sheet that
		 * spans the whole timeline region, and it was asked for knowingly.
		 *
		 * If this ever needs to change, the fix is not to shrink the sheet: it is
		 * to move the affected controls onto the bottom bar, which is the one
		 * surface that stays live. */
		await page.locator("[data-vui-slot='item']").first().click();
		await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
		await settled(page, ".tl2-clip-sheet");

		for (const sel of [
			'.tl2-tlbar [aria-label="More tools"]',
			'.tl2-tlbar [title^="Undo"]',
			".tl2-tlbar [data-transport='play']",
		]) {
			const covered = await page.evaluate((q) => {
				const el = document.querySelector(q as string)!;
				const r = el.getBoundingClientRect();
				const at = document.elementFromPoint(
					Math.round(r.x + r.width / 2),
					Math.round(r.y + r.height / 2),
				);
				return !at || !at.closest(q as string);
			}, sel);
			expect(covered, `${sel} is still reachable — the sheet did not span the toolbar`).toBe(true);
		}

		// The bar is the way out, and it still is.
		await page.locator('.tl2-clipbar [aria-label="Back"]').click();
		await expect(page.locator(".tl2-clip-sheet")).not.toHaveClass(/ui-sheet-open/);
		await expectRenders(
			page,
			'.tl2-tlbar [aria-label="More tools"]',
			"More, once the sheet is down",
		);
	});
});

test("one sheet replacing another keeps a single history entry", async ({ page }) => {
	/* The case that broke the first attempt at this. React runs the closing
	 * sheet's cleanup and the opening sheet's effect in one commit, so a
	 * per-sheet history entry had the outgoing sheet's pop land on the incoming
	 * sheet's listener — which closed itself the instant it opened. Asserted
	 * from both ends: the replacement stays open, and Back still has exactly one
	 * entry to consume afterwards rather than none or two. */
	const url = page.url();
	await page.locator("[data-vui-slot='item']").first().click();
	await page.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
	await expect(page.locator(".tl2-clip-sheet")).toHaveClass(/ui-sheet-open/);

	await page.locator('.tl2-clipbar [aria-label="Clip actions"]').click();
	await expect(
		page.locator(".tl2-clipactions-sheet"),
		"the replacement closed itself as it opened",
	).toHaveClass(/ui-sheet-open/);

	// One entry, not two: one Back closes the sheet and stays in the editor.
	await page.goBack();
	await expect(page.locator(".tl2-clipactions-sheet")).not.toHaveClass(/ui-sheet-open/);
	expect(page.url(), "the swap left the editor on a stale entry").toBe(url);

	// And not zero: the next Back leaves, rather than doing nothing.
	await page.goBack();
	expect(page.url(), "the swap leaked an entry").not.toBe(url);
});

/* ── One bottom bar, worn by two ──
 *
 * The project bar (the tool rail, rotated) and the clip bar occupy the same
 * slot, one at a time. Any difference in their metrics is something the
 * operator sees as the bar jumping when a clip is tapped — so the structure is
 * declared once and both wear it. These assert the two are actually the same
 * bar rather than two near-copies that happen to agree today.
 */
test.describe("the bottom bar is one structure", () => {
	async function metrics(
		page: Page,
		sel: string,
	): Promise<{ gaps: number[]; min: number; overflowX: string; touch: string; height: number }> {
		return page.evaluate((s) => {
			const el = document.querySelector(s as string)!;
			const cs = getComputedStyle(el);
			const kids = Array.from(el.children).map((c) => c.getBoundingClientRect());
			const controls = Array.from(el.querySelectorAll("button")).map((b) =>
				b.getBoundingClientRect(),
			);
			return {
				gaps: kids.slice(1).map((r, i) => Math.round(r.left - kids[i]!.right)),
				min: Math.min(...controls.map((r) => Math.min(r.width, r.height))),
				overflowX: cs.overflowX,
				touch: cs.touchAction,
				height: Math.round(el.getBoundingClientRect().height),
			};
		}, sel);
	}

	test("both bars space, size and scroll identically", async ({ page }) => {
		const rail = await metrics(page, ".tl2-rail");
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		const clip = await metrics(page, ".tl2-clipbar");

		for (const [name, m] of [
			["project bar", rail],
			["clip bar", clip],
		] as const) {
			expect(new Set(m.gaps).size, `${name}: uneven gaps (${m.gaps.join(", ")})`).toBe(1);
			expect(m.min, `${name}: a control under the touch minimum`).toBeGreaterThanOrEqual(44);
			expect(m.overflowX, `${name}: does not scroll`).toBe("auto");
			expect(m.touch, `${name}: wrong touch axis`).toBe("pan-x");
		}
		expect(rail.gaps[0], "the two bars use different gaps").toBe(clip.gaps[0]);

		/* Same height, which is the one the operator actually feels: the bars
		 * swap in place, and a difference here moves the timeline under their
		 * thumb the instant a clip is tapped. */
		expect(clip.height, `project bar ${rail.height}px vs clip bar ${clip.height}px`).toBe(
			rail.height,
		);
	});

	test("the project bar scrolls to its last tool", async ({ page }) => {
		/* Ten tools do not fit 393px. Scrolling is what keeps every one of them
		 * reachable without picking a subset that then drifts from the desktop. */
		const rail = page.locator(".tl2-rail");
		const overflow = await rail.evaluate((el) => el.scrollWidth - el.clientWidth);
		expect(overflow, "the project bar does not overflow — nothing to prove").toBeGreaterThan(0);

		await rail.evaluate((el) => {
			el.scrollLeft = el.scrollWidth;
		});
		await expectRenders(page, '.tl2-rail [aria-label="Project"]', "the last tool after scrolling");
	});
});

/* ── The bottom bar outlives every sheet ──
 *
 * Walked over all four rather than asserted on the two that were reported,
 * because "which sheets cover the bar" is not a property anyone can hold in
 * their head — each one is opened by a different component and passes its own
 * standoff, so the next sheet added is the next one to get it wrong.
 *
 * The bar is the only navigation these surfaces have: it is how the operator
 * reaches another tool, another property group, or out of the selection
 * entirely. A sheet that covers it turns every one of those into three taps.
 */
test.describe("the bottom bar outlives every sheet", () => {
	const cases = [
		{
			name: "rail panel",
			bar: ".tl2-rail",
			selectFirst: false,
			open: async (p: Page) => {
				await p.keyboard.press("Alt+Digit1");
			},
			sheet: ".tl2-panel-sheet",
		},
		{
			name: "tools, with nothing selected",
			bar: ".tl2-rail",
			selectFirst: false,
			open: async (p: Page) => {
				await p.locator('.tl2-tlbar [aria-label="More tools"]').click();
			},
			sheet: ".tl2-more-sheet",
		},
		{
			name: "tools, with a clip selected",
			bar: ".tl2-clipbar",
			selectFirst: true,
			open: async (p: Page) => {
				await p.locator('.tl2-tlbar [aria-label="More tools"]').click();
			},
			sheet: ".tl2-more-sheet",
		},
		{
			name: "clip properties",
			bar: ".tl2-clipbar",
			selectFirst: true,
			open: async (p: Page) => {
				await p.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
			},
			sheet: ".tl2-clip-sheet",
		},
		{
			name: "clip actions",
			bar: ".tl2-clipbar",
			selectFirst: true,
			open: async (p: Page) => {
				await p.locator('.tl2-clipbar [aria-label="Clip actions"]').click();
			},
			sheet: ".tl2-clipactions-sheet",
		},
	] as const;

	for (const c of cases) {
		test(`${c.name}: the bar stays visible and hittable`, async ({ page }) => {
			if (c.selectFirst) {
				await page.locator("[data-vui-slot='item']").first().click();
				await expect(page.locator(".tl2-clipbar")).toBeVisible();
			}
			await c.open(page);
			await expect(page.locator(c.sheet)).toHaveClass(/ui-sheet-open/);
			await settled(page, c.sheet);

			/* Hittable, not merely visible. The scrim has to stand off by the same
			 * amount as the sheet — left flush it renders the bar visible and dead,
			 * which reads as a broken control rather than a covered one. */
			await expectRenders(page, c.bar, `${c.name}: the bar`);

			const bar = (await page.locator(c.bar).boundingBox())!;
			const sheet = (await page.locator(c.sheet).boundingBox())!;
			expect(
				Math.round(sheet.y + sheet.height),
				`${c.name}: the sheet runs under the bar`,
			).toBeLessThanOrEqual(Math.round(bar.y) + 1);
		});
	}

	test("a rail panel cannot be open behind the clip bar", async ({ page }) => {
		/* The one combination the walk above does not contain, recorded rather
		 * than left as a hole someone re-derives later.
		 *
		 * Selecting a clip UNMOUNTS the rail — the clip bar is what replaces it —
		 * and the rail owns both the panel state and the Alt+digit shortcut that
		 * reaches it, so neither route survives the swap. Nor can it be reached
		 * the other way round: with a panel open its sheet covers the timeline,
		 * so there is no clip to tap.
		 *
		 * That is the contextual bar working as specified ("deselecting SHALL
		 * restore the tool rail"), not a gap. It does mean the nine rail
		 * destinations cost a deselect while a clip is selected. */
		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		await expect(page.locator(".tl2-rail"), "the rail outlived the swap").toHaveCount(0);

		await page.keyboard.press("Alt+Digit1");
		await expect(
			page.locator(".tl2-panel-sheet"),
			"a panel opened with no rail to own it",
		).toHaveCount(0);

		// And it comes back with the selection, shortcut included.
		await page.locator('.tl2-clipbar [aria-label="Close"]').click();
		await expect(page.locator(".tl2-rail")).toBeVisible();
		await page.keyboard.press("Alt+Digit1");
		await expect(page.locator(".tl2-panel-sheet")).toHaveClass(/ui-sheet-open/);
	});

	test("a rail tool switches destinations in one tap while a panel is open", async ({ page }) => {
		/* The reason the bar has to stay live rather than merely be uncovered. */
		await page.keyboard.press("Alt+Digit1");
		const sheet = page.locator(".tl2-panel-sheet");
		await expect(sheet).toHaveClass(/ui-sheet-open/);
		await settled(page, ".tl2-panel-sheet");
		const first = await sheet.locator("header").first().innerText();

		await page.locator('.tl2-rail [aria-label="Style"]').click();
		await expect(sheet).toHaveClass(/ui-sheet-open/);
		await expect(sheet.locator("header").first(), "the tap did not reach the rail").not.toHaveText(
			first,
		);
	});
});

/* ── A sheet is exactly the timeline region ──
 *
 * One geometry for all four bottom sheets, and it is a statement about WHERE
 * rather than how big: a sheet covers the timeline region — its toolbar and its
 * lanes — and stops at the bottom bar. Asserted per sheet rather than once,
 * because each is opened by a different component and passes its own band —
 * which is how they came to have three different heights in the first place.
 */
test.describe("a sheet covers the timeline region", () => {
	const sheets = [
		{
			name: "rail panel",
			selectFirst: false,
			open: async (p: Page) => {
				await p.keyboard.press("Alt+Digit1");
			},
			sheet: ".tl2-panel-sheet",
		},
		{
			name: "tools",
			selectFirst: false,
			open: async (p: Page) => {
				await p.locator('.tl2-tlbar [aria-label="More tools"]').click();
			},
			sheet: ".tl2-more-sheet",
		},
		{
			name: "clip properties",
			selectFirst: true,
			open: async (p: Page) => {
				await p.locator(".tl2-clipbar-groups .tl2-clipbar-btn").first().click();
			},
			sheet: ".tl2-clip-sheet",
		},
		{
			name: "clip actions",
			selectFirst: true,
			open: async (p: Page) => {
				await p.locator('.tl2-clipbar [aria-label="Clip actions"]').click();
			},
			sheet: ".tl2-clipactions-sheet",
		},
	] as const;

	for (const s of sheets) {
		test(`${s.name}: fills the band exactly`, async ({ page }) => {
			if (s.selectFirst) {
				await page.locator("[data-vui-slot='item']").first().click();
				await expect(page.locator(".tl2-clipbar")).toBeVisible();
			}
			await s.open(page);
			await expect(page.locator(s.sheet)).toHaveClass(/ui-sheet-open/);
			await settled(page, s.sheet);

			const geo = await page.evaluate((sel) => {
				const box = (q: string) => document.querySelector(q)!.getBoundingClientRect();
				return {
					sheet: box(sel as string),
					transport: box(".tl2-tlbar"),
					bar: box(".tl2-bottombar"),
				};
			}, s.sheet);

			/* Top flush to the transport and bottom flush to the bar, both within
			 * a pixel. Either edge short leaves a strip of dimmed timeline that
			 * reads as a sheet which failed to reach its own bounds — which is
			 * exactly what a fixed `svh` height produced. */
			expect(Math.round(geo.sheet.top), `${s.name}: gap above the toolbar`).toBe(
				Math.round(geo.transport.top),
			);
			expect(Math.round(geo.sheet.bottom), `${s.name}: does not meet the bar`).toBe(
				Math.round(geo.bar.top),
			);
		});
	}

	test("every sheet is the same height as every other", async ({ page }) => {
		/* The bar stays put across a sheet swap, so a sheet that changed shape
		 * behind it made the surface jump for no reason the operator can see.
		 *
		 * Tools is measured FIRST, with nothing selected. It cannot be opened
		 * from another sheet any more — its control lives on the toolbar, which
		 * a sheet now covers — so measuring it last meant clicking a button that
		 * was underneath the sheet being replaced. */
		const heights: Record<string, number> = {};

		await page.locator('.tl2-tlbar [aria-label="More tools"]').click();
		await settled(page, ".tl2-more-sheet");
		heights.tools = Math.round((await page.locator(".tl2-more-sheet").boundingBox())!.height);
		await page.locator('.tl2-more-sheet [aria-label="Close"]').click();

		await page.locator("[data-vui-slot='item']").first().click();
		await expect(page.locator(".tl2-clipbar")).toBeVisible();
		for (const [name, opener, sel] of [
			["properties", ".tl2-clipbar-groups .tl2-clipbar-btn", ".tl2-clip-sheet"],
			["actions", '.tl2-clipbar [aria-label="Clip actions"]', ".tl2-clipactions-sheet"],
		] as const) {
			await page.locator(opener).first().click();
			await settled(page, sel);
			heights[name] = Math.round((await page.locator(sel).boundingBox())!.height);
		}

		const distinct = new Set(Object.values(heights));
		expect(distinct.size, `sheets disagree: ${JSON.stringify(heights)}`).toBe(1);
	});
});

/* timeline-lane-types: lane height follows lane group. The phone is where that
 * pays: one visual lane, two audio lanes, one text lane and the scene row all fit
 * without scrolling, which uniform heights could not promise. */
test("a mixed project's lanes all fit the phone timeline without scrolling", async ({
	page,
	context,
}) => {
	await typedLanesFixture(context, ["visual", "audio", "audio", "text"]);
	await page.goto(`/content/${TYPED_LANES_PROJECT_ID}`);
	await page
		.locator(".tl2-timeline .tl2-lane[data-lane-group='text']")
		.waitFor({ timeout: 60_000 });
	const fit = await page.locator(EDITOR_TIMELINE).evaluate((scroller) => {
		const bottom =
			scroller.getBoundingClientRect().top + scroller.clientTop + scroller.clientHeight;
		const lanes = [...scroller.querySelectorAll<HTMLElement>(".tl2-lanes > .tl2-lane")];
		return {
			count: lanes.length,
			scrollTop: scroller.scrollTop,
			overflow: lanes.map((lane) => lane.getBoundingClientRect().bottom - bottom),
		};
	});
	expect(fit.count).toBe(5);
	expect(fit.scrollTop).toBe(0);
	for (const over of fit.overflow) expect(over).toBeLessThanOrEqual(0.5);
});

test("the phone tools sheet carries the snapping and ripple modes", async ({ page }) => {
	await page.getByRole("button", { name: "More tools", exact: true }).click();
	const sheet = page.getByRole("dialog", { name: "Timeline tools", exact: true });
	await expect(sheet.getByRole("button", { name: "Snapping", exact: true })).toHaveAttribute(
		"aria-pressed",
		"true",
	);
	await expect(sheet.getByRole("button", { name: "Ripple editing", exact: true })).toHaveAttribute(
		"aria-pressed",
		"false",
	);
	await expect(sheet.getByRole("button", { name: "Duplicate", exact: true })).toBeDisabled();
	await expect(sheet.getByRole("button", { name: "Delete", exact: true })).toBeDisabled();
	await expect(sheet.getByRole("button", { name: "Keyframe easing", exact: true })).toHaveCount(0);
	await expect(sheet).toHaveScreenshot("timeline-tools-sheet-phone.png");
});

/* ── The Elements list in a landscape phone ──
 *
 * Found while recording the CSS baselines (migrate-editor-to-shared-rust-core
 * task 1.7): at 852×393 the Elements sheet's scroll body is ~118px tall, and
 * its sticky search-and-tabs block is taller than that. Every group header
 * stuck beneath the block, outside the body, so no scroll ever showed the list
 * and Motion Studio could not be opened in landscape at all. */
test("the Elements list is reachable on a landscape phone", async ({ page }) => {
	await page.setViewportSize({ width: 852, height: 393 });
	await page
		.locator("nav.tl2-bottombar")
		.getByRole("button", { name: "Elements", exact: true })
		.click();
	const create = page.getByRole("button", { name: /New motion/ }).first();
	await expect(create).toBeAttached();
	/* A finger scrolls the list body; bring the Motion group to its top. */
	const reach = await create.evaluate((button) => {
		const body = button.closest(".tl2-elements-body") as HTMLElement;
		const section = button.closest("section") as HTMLElement;
		body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top;
		const box = button.getBoundingClientRect();
		const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
		return {
			onTop: hit === button || button.contains(hit),
			top: Math.round(box.top),
			bodyBottom: Math.round(body.getBoundingClientRect().bottom),
		};
	});
	expect(
		reach.onTop,
		`New motion sits at ${reach.top}px, below the list body's ${reach.bodyBottom}px edge`,
	).toBe(true);
	await create.click();
	await expect(page.locator(".tl2-studio")).toBeVisible();
});
