/* The content editor's preview region, as geometry rather than as a picture.
 *
 * A screenshot cannot fail when this region collapses. It photographs whatever
 * is there, and a blank preview is a valid image — it gets blessed into a
 * baseline and the suite reports green over the one surface the editor exists
 * to show. That is how the preview went missing while every check passed.
 *
 * The readiness gate was the other half of the same hole. `screens.ts` waited on
 * `.tl2-timeline`, so the editor was declared loaded by its timeline and the
 * preview was never named by anything. These tests wait on the timeline too —
 * deliberately, so a missing preview arrives as an assertion that names it
 * rather than as a timeout that names nothing — and then assert the preview.
 *
 * Three viewport classes, because the defect this covers was invisible in two of
 * them: below 860px the phone rules stack the stage over the timeline whatever
 * the workspace does, and the desktop composition is the only one that depended
 * on the region that had been flattened away.
 */
import { expect, test, devices, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { expectRenders } from "./vui-geometry.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();

/** The workspace's own preview region. Flattening it with `display: contents`
 *  leaves the element in the tree with no box at all, which is why this asserts
 *  the slot and not the app wrapper inside it. */
const PREVIEW = "[data-vui-slot='preview']";
/** The renderer, inside the preview. A sized region containing nothing would
 *  satisfy the slot check on its own. */
const STAGE = ".tl2-remotion-stage";
const TIMELINE = "[data-vui-slot='timeline']";

/* A device's options without its browser choice.
 *
 * `defaultBrowserType` cannot be set on a describe — it forces a new worker —
 * and it is not wanted here anyway: the rest of this suite is Chromium and the
 * browser is not what is under test. What IS wanted from the descriptor is
 * `hasTouch` and `isMobile`, which are what make Chromium report
 * `pointer: coarse`; a narrow window on a fine pointer exercises none of the
 * editor's phone rules. */
function coarseDevice(name: "iPhone 15" | "iPhone 15 landscape") {
	const { defaultBrowserType, ...options } = devices[name];
	void defaultBrowserType;
	return { ...options, deviceScaleFactor: 1 };
}

async function openEditor(page: Page): Promise<void> {
	await page.addInitScript(`{
		const FROZEN = ${FROZEN_NOW};
		const RealDate = Date;
		class FrozenDate extends RealDate {
			constructor(...args) { super(...(args.length ? args : [FROZEN])); }
			static now() { return FROZEN; }
		}
		globalThis.Date = FrozenDate;
		const mq = globalThis.matchMedia;
		globalThis.matchMedia = (q) => q.includes("prefers-reduced-motion")
			? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
			: mq(q);
	}`);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
}

/** Preview, renderer and timeline all have a box and none is covered. The three
 *  together are the claim: a preview region with no renderer in it, and a
 *  renderer in a region the timeline has taken over, both read as "present". */
async function expectPreviewAndTimeline(page: Page, where: string): Promise<void> {
	await expectRenders(page, PREVIEW, `${where}: preview region`);
	await expectRenders(page, STAGE, `${where}: renderer stage`);
	await expectRenders(page, TIMELINE, `${where}: timeline region`);
}

test.describe("desktop", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
	});

	test("opens on a preview, with nothing selected", async ({ page }) => {
		await expectPreviewAndTimeline(page, "desktop");
	});

	/* The preview and the timeline are stacked, not side by side.
	 *
	 * This is the regression itself, stated as a relationship rather than as two
	 * sizes. Flattening the workspace let both fall into `.tl2-body`, which is a
	 * row: the timeline took 912 of 1074px, the stage was left with 114, and the
	 * aspect-ratio canvas inside it collapsed to width 0. Every box involved was
	 * non-zero except the last one, so only the ordering catches it early.
	 *
	 * The timeline is measured against the workspace rather than against the
	 * preview, because the preview shares its row with the docked inspector while
	 * the timeline spans both. */
	test("the timeline is below the preview, not beside it", async ({ page }) => {
		const tools = (await page.locator("[data-vui-slot='tools']").boundingBox())!;
		const inspector = (await page.locator("[data-vui-slot='inspector']").boundingBox())!;
		const preview = (await page.locator(PREVIEW).boundingBox())!;
		const timeline = (await page.locator(TIMELINE).boundingBox())!;
		expect(Math.round(timeline.y), "timeline starts below the preview").toBeGreaterThanOrEqual(
			Math.round(preview.y + preview.height) - 1,
		);
		expect(Math.round(timeline.x), "timeline starts at the tools pane").toBe(Math.round(tools.x));
		expect(Math.round(timeline.x + timeline.width), "timeline reaches the inspector edge").toBe(
			Math.round(inspector.x + inspector.width),
		);
	});

	/* The docked inspector is a region of its own, beside the preview.
	 *
	 * It used to be a child of the stage, which put it inside the PREVIEW slot —
	 * so with nothing selected the "Inspector ready" empty state was rendered in
	 * the region whose whole purpose is to show the video. Both halves are
	 * asserted: the inspector has its own slot with a box, and no empty state is
	 * a descendant of the preview. */
	test("the empty inspector is a region beside the preview, not inside it", async ({ page }) => {
		await expectRenders(page, "[data-vui-slot='inspector']", "desktop: inspector region");
		await expect(
			page
				.locator('[data-vui-slot="inspector"]')
				.getByRole("region", { name: "Canvas", exact: true }),
		).toBeVisible();
		const containment = await page.evaluate(() => {
			const preview = document.querySelector("[data-vui-slot='preview']");
			const empty = document.querySelector(
				'[data-vui-slot="inspector"] [data-slot="inspector-section"]',
			);
			return { found: Boolean(empty), insidePreview: Boolean(empty && preview?.contains(empty)) };
		});
		expect(containment.found, "canvas settings are on screen").toBe(true);
		expect(containment.insidePreview, "canvas settings stay outside the preview region").toBe(
			false,
		);
		const preview = (await page.locator(PREVIEW).boundingBox())!;
		const inspector = (await page.locator("[data-vui-slot='inspector']").boundingBox())!;
		expect(
			Math.round(inspector.x),
			"the inspector starts where the preview ends",
		).toBeGreaterThanOrEqual(Math.round(preview.x + preview.width) - 1);
	});

	/* The splitter, which measures the workspace to resolve a height. It was dead
	 * before this change — the ref it reads was attached to nothing after the
	 * editor became a package component — and a dead splitter is indistinguishable
	 * from a working one until the boundary is measured on both sides of a drag. */
	test("the splitter moves the preview/timeline boundary", async ({ page }) => {
		const before = (await page.locator(TIMELINE).boundingBox())!;
		const handle = (await page
			.getByRole("separator", { name: "Resize upper panels and timeline", exact: true })
			.boundingBox())!;
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2 - 120, {
			steps: 12,
		});
		await page.mouse.up();
		await expect(async () => {
			const after = (await page.locator(TIMELINE).boundingBox())!;
			expect(Math.round(after.height)).toBeGreaterThan(Math.round(before.height));
		}).toPass({ timeout: 3000 });
		await expectPreviewAndTimeline(page, "desktop after splitter drag");
	});

	/* Seeking from the timeline moves the preview's playhead, which is what makes
	 * this the preview the operator is editing against rather than a still. */
	test("the timeline seeks the preview", async ({ page }) => {
		const timecode = page.locator("[data-transport='timecode']").first();
		const before = await timecode.textContent();
		const ruler = (await page.locator(".tl2-ruler").boundingBox())!;
		await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + ruler.height / 2);
		await expect(timecode).not.toHaveText(before ?? "", { timeout: 3000 });
		await expectRenders(page, STAGE, "renderer stage after a seek");
	});
});

/* Phone portrait. A real coarse pointer, because half the editor's phone rules
 * key off `pointer: coarse` rather than off width. */
test.describe("phone portrait", () => {
	test.use(coarseDevice("iPhone 15"));

	test("opens on a preview, above the timeline", async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
		await expectPreviewAndTimeline(page, "phone portrait");
		const preview = (await page.locator(PREVIEW).boundingBox())!;
		const timeline = (await page.locator(TIMELINE).boundingBox())!;
		expect(Math.round(timeline.y)).toBeGreaterThanOrEqual(
			Math.round(preview.y + preview.height) - 1,
		);
	});

	/* The splitter is desktop-only on purpose: a height dragged on a desktop
	 * session would otherwise still apply after a rotation to phone width, with no
	 * control on screen to correct it. */
	test("has no splitter", async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
		await expect(
			page.getByRole("separator", { name: "Resize upper panels and timeline", exact: true }),
		).toHaveCount(0);
	});
});

/* Short landscape. The viewport where a fixed timeline height is most likely to
 * push the preview to nothing — 392px of timeline in a 393px viewport. */
test.describe("short landscape", () => {
	test.use(coarseDevice("iPhone 15 landscape"));

	test("keeps both the preview and the timeline", async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
		await expectPreviewAndTimeline(page, "short landscape");
	});
});
