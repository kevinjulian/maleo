/* Baselines for the editor's own surfaces.
 *
 * `screens.spec.ts` captures the editor once per width, which covers the frame
 * and the timeline and nothing else. Every rail panel, and the docked inspector
 * a selected clip fills, render from stylesheets and a component tree that no
 * baseline could see — and those are exactly the surfaces the decomposition
 * work moves. One screenshot per rail is what makes that work reviewable.
 *
 * Regenerate with `bun run visual:update`, and read the image diff as the
 * change: these are states of one screen, so a diff in one rail and not the
 * others names the panel that moved.
 */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();

/** The rail destinations, by the title their buttons carry. */
const RAILS = [
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

/** One width. The rails are a fixed 312px panel, so a second width would
 *  re-photograph the same panel beside a wider stage. */
const WIDTH = 1440;

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
		const mq = globalThis.matchMedia;
		globalThis.matchMedia = (q) => q.includes("prefers-reduced-motion")
			? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
			: mq(q);
	}`);
	await page.setViewportSize({ width: WIDTH, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.evaluate(() => document.fonts.ready);
});

for (const [index, rail] of RAILS.entries()) {
	test(`editor rail ${rail.toLowerCase()}`, async ({ page }) => {
		// Alt+1..9, not a click: the rail button toggles, so clicking whichever
		// rail the editor already opened would close the panel instead of showing
		// it. The shortcut sets the destination and opens unconditionally.
		await page.keyboard.press(`Alt+Digit${index + 1}`);
		await expect(page.locator(".tl2-panel")).toBeVisible();
		await page.evaluate(() => document.fonts.ready);
		await expect(page).toHaveScreenshot(`editor-rail-${rail.toLowerCase()}-${WIDTH}.png`, {
			fullPage: true,
		});
	});
}

/* The Studio view is deliberately NOT captured. `SceneStudio` returns null when
 * the project has no scenes (studio.tsx:168), and the fixture project is two
 * clips with none — so the screenshot is the topbar on an empty page. That
 * image would stay green if the whole studio stopped rendering, which is worse
 * than having no baseline. Covering it needs a fixture with scenes, which means
 * re-recording the HAR against a different project. */

test("editor clip selected", async ({ page }) => {
	// Selecting a clip fills the docked inspector on the right, which is the one
	// editor surface driven by selection rather than by a rail.
	await page.locator("[data-vui-slot='item']").first().click();
	await expect(page.locator(".tl2-clippanel")).toBeVisible();
	await page.evaluate(() => document.fonts.ready);
	await expect(page).toHaveScreenshot(`editor-clip-selected-${WIDTH}.png`, { fullPage: true });
});

test("VUI template and Motion Studio adapters remain reachable on desktop", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	const templateTrigger = page.locator(".tl2-template-create");
	await templateTrigger.click();
	const templateModal = page.locator(".tl2-template-editor-modal");
	await expect(templateModal).toBeVisible();
	for (const selector of [
		".tl2-template-editor-preview",
		".tl2-template-editor-form",
		"[data-vui-slot='timeline']",
	]) {
		const box = (await templateModal.locator(selector).boundingBox())!;
		expect(box.width, `${selector} has no width`).toBeGreaterThan(1);
		expect(box.height, `${selector} has no height`).toBeGreaterThan(1);
	}
	await page.locator("[data-vui-overlay-kind='workspace']").click({ position: { x: 2, y: 2 } });
	await expect(templateModal).toHaveCount(0);
	await templateTrigger.click();
	await expect(templateModal).toBeVisible();
	await page
		.locator(".tl2-template-editor-modal .cv-modal-actions button")
		.filter({ hasText: "Cancel" })
		.click();
	await expect(page.locator(".tl2-template-editor-modal")).toHaveCount(0);

	await page.keyboard.press("Alt+Digit5");
	const motionSection = page
		.locator("section")
		.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
		.first();
	await motionSection.getByRole("button", { name: /New motion/ }).click();
	await expect(page.locator(".tl2-studio")).toBeVisible();
	/* The Motion workspace as composed, scoped to the modal rather than the page:
	   a full-page shot of this screen would also carry the editor behind it, and
	   then drift with every unrelated change to the editor. */
	await page.evaluate(() => document.fonts.ready);
	await expect(page.locator(".tl2-studio")).toHaveScreenshot("vui-motion-desktop.png");
	/* Scoped to the studio, like the two selectors beside it. The content editor
	   behind this modal now fills the workspace's inspector slot with its own
	   docked clip panel, so a bare slot selector matches two regions on two
	   different surfaces and resolves to neither. */
	for (const selector of [
		".tl2-studio-stage",
		".tl2-motion-timeline",
		".tl2-studio [data-vui-slot='inspector']",
	]) {
		const box = (await page.locator(selector).boundingBox())!;
		expect(box.width, `${selector} has no width`).toBeGreaterThan(1);
		expect(box.height, `${selector} has no height`).toBeGreaterThan(1);
	}
	await page.locator(".tl2-studio [title='Close']").click();
	await expect(page.locator(".tl2-studio")).toHaveCount(0);
});

test("VUI template desktop flow inspects, resizes, previews, saves, cancels, and restores focus", async ({
	page,
}) => {
	let saved: Record<string, unknown> | null = null;
	/* Assigned by the route handler; read through a call so the check sees
	 * the declared type rather than the `null` it started as. */
	const readSaved = (): Record<string, unknown> | null => saved;
	await page.route("**/*timeline-templates*", async (route) => {
		if (route.request().method() !== "POST") {
			await route.fallback();
			return;
		}
		saved = route.request().postDataJSON() as Record<string, unknown>;
		await route.fulfill({
			status: 200,
			contentType: "application/json",
			body: JSON.stringify({
				item: { id: "visual-template", ...saved, createdAt: 1, updatedAt: 1 },
			}),
		});
	});
	await page.keyboard.press("Alt+Digit4");
	const trigger = page.locator(".tl2-template-create");
	await trigger.click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();
	await modal.getByRole("button", { name: "Jump to start" }).click();
	await page.evaluate(() => document.fonts.ready);
	await expect(modal).toHaveScreenshot("vui-template-desktop.png");

	const range = modal.locator("[data-vui-slot='item']").filter({ hasText: "Opening title" });
	await range.click();
	const opening = modal
		.locator("[data-vui-slot='accordion']")
		.filter({ hasText: "Opening · section 1" });
	await expect(opening.locator("button").first()).toHaveAttribute("aria-expanded", "true");
	const before = (await range.boundingBox())!;
	await range.focus();
	await page.keyboard.press("Shift+ArrowRight");
	const after = (await range.boundingBox())!;
	expect(after.width).toBeGreaterThan(before.width);

	const ruler = modal.locator("[data-vui-slot='ruler']");
	const rulerBox = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: rulerBox.width * 0.7, y: rulerBox.height / 2 } });
	await expect
		.poll(async () =>
			Number.parseFloat(
				await modal
					.locator("[data-vui-slot='playhead']")
					.evaluate((element) => getComputedStyle(element).left),
			),
		)
		.toBeGreaterThan(50);

	/* Switch destination through the rail. The inspector shows one category at a
	   time now, so identity is reached by choosing it rather than by opening one
	   of six accordions that were all on screen at once. */
	await modal.locator("[data-vui-slot='category'][data-vui-category='identity']").click();
	const identity = modal
		.locator("[data-vui-slot='accordion']")
		.filter({ hasText: "Template identity" });
	await expect(identity.locator("button").first()).toHaveAttribute("aria-expanded", "true");
	await identity.locator("input").first().fill("Visual adapter template");
	await modal.getByRole("button", { name: "Create template" }).click();
	await expect(modal).toHaveCount(0);
	expect(readSaved()?.name).toBe("Visual adapter template");
	await expect(trigger).toBeFocused();

	await trigger.click();
	await modal.getByRole("button", { name: "Cancel" }).click();
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

/* The popover's behavior, which no screenshot can judge.
 *
 * It is Radix underneath, and that dependency survived the Tailwind removal for
 * exactly the reasons asserted here: it portals out of the modal, dismisses on
 * Escape and on an outside click, and returns focus to its trigger. What was
 * removed was the shadcn utility class string, so the appearance assertions
 * check that `.tl2-selection-popover` in editing.css is what paints it.
 *
 * Reached through the template editor rather than a rail: the pickers live in
 * the draft form's Opening section, which is why a sweep of the nine rails
 * finds no trigger and this surface looked unreachable. */
test("selection popover portals, takes app styling, and dismisses", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	const create = page.locator(".tl2-template-create");
	await create.click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();

	// Opening · section 1 is the destination that renders the title picker.
	await modal.locator("[data-vui-slot='item']").filter({ hasText: "Opening title" }).click();
	const trigger = modal.locator(".tl2-selection-trigger").first();
	await expect(trigger).toBeVisible();
	await trigger.click();

	// Portalled to the body, not nested in the modal that opened it.
	const content = page.locator(".tl2-selection-popover");
	await expect(content).toBeVisible();
	expect(await content.evaluate((el) => el.closest(".tl2-template-editor-modal") === null)).toBe(
		true,
	);

	/* The canonical Popover paints the surface and stacks its positioner at
	   --z-floating; the picker sets only its size. */
	const style = await content.evaluate((el) => {
		const c = getComputedStyle(el);
		return {
			z: getComputedStyle(el.parentElement!).zIndex,
			border: c.borderTopWidth,
			bg: c.backgroundColor,
			radius: c.borderTopLeftRadius,
		};
	});
	expect(style.z).toBe("1100");
	expect(style.border).toBe("1px");
	expect(style.bg).not.toBe("rgba(0, 0, 0, 0)");
	expect(style.radius).not.toBe("0px");

	// Radix dismissal, both routes, with focus handed back.
	await page.keyboard.press("Escape");
	await expect(content).toBeHidden();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await expect(content).toBeVisible();
	await page.mouse.click(4, 4);
	await expect(content).toBeHidden();
});

test("template timeline ruler forwards seek to preview", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	const ruler = modal.locator("[data-vui-slot='ruler']");
	await expect(ruler).toBeVisible();
	const box = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
	await expect
		.poll(
			async () =>
				await modal
					.locator("[data-vui-slot='playhead']")
					.evaluate((element) => Number.parseFloat(getComputedStyle(element).left)),
		)
		.toBeGreaterThan(60);
});

test("VUI timeline keeps mouse range manipulation direct", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	const range = modal.locator("[data-vui-slot='item']").first();
	await range.click();
	await expect(range).toHaveAttribute("aria-selected", "true");
	const box = (await range.boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.waitForTimeout(140);
	await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2);
	await expect(range, "fine pointer starts selected-item manipulation").toHaveAttribute(
		"data-vui-gesturing",
		"",
	);
	await page.mouse.up();
});

test("Motion Studio timeline uses shared VUI ruler, ranges, and playhead", async ({ page }) => {
	await page.keyboard.press("Alt+Digit5");
	const motionSection = page
		.locator("section")
		.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
		.first();
	await motionSection.getByRole("button", { name: /New motion/ }).click();
	const timeline = page.locator(".tl2-motion-timeline");
	const range = timeline.locator("[data-vui-slot='item']").first();
	await range.click();
	await expect(range).toHaveAttribute("aria-selected", "true");
	const ruler = timeline.locator("[data-vui-slot='ruler']");
	await ruler.click({ position: { x: 80, y: 8 } });
	await expect(ruler).toHaveAttribute("aria-valuenow", /.+/);
	await expect(timeline.locator("[data-vui-slot='playhead']")).toBeVisible();
	await page.locator(".tl2-studio [title='Close']").click();
});

test("VUI Motion Studio desktop flow edits layers and keyframes, saves, cancels, and restores focus", async ({
	page,
}) => {
	let saved: Record<string, unknown> | null = null;
	/* Assigned by the route handler; read through a call so the check sees
	 * the declared type rather than the `null` it started as. */
	const readSaved = (): Record<string, unknown> | null => saved;
	await page.route("**/*clip-templates*", async (route) => {
		if (route.request().method() === "GET") {
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({ items: [] }),
			});
			return;
		}
		if (route.request().method() === "POST") {
			saved = route.request().postDataJSON() as Record<string, unknown>;
			await route.fulfill({
				status: 200,
				contentType: "application/json",
				body: JSON.stringify({
					item: { id: "visual-motion", ...saved, createdAt: 1, updatedAt: 1 },
				}),
			});
			return;
		}
		await route.fallback();
	});
	await page.keyboard.press("Alt+Digit5");
	const motionSection = page
		.locator("section")
		.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
		.first();
	const trigger = motionSection.getByRole("button", { name: /New motion/ });
	/* The EDITOR's clips, scoped to its own row area. `data-vui-slot="item"` is
	   the published contract for every timeline in the app, so an unscoped count
	   would also pick up Motion Studio's layer bars once the modal is open —
	   which is the thing this is checking Delete does not touch. */
	const editorClips = page.locator("[data-vui-slot='rows'] [data-vui-slot='item']");
	const mainClipCount = await editorClips.count();
	await trigger.click();
	const modal = page.locator(".tl2-studio");
	await expect(modal).toBeVisible();
	await modal.locator("[data-vui-slot='item']").first().click();
	const ruler = modal.locator("[data-vui-slot='ruler']");
	const rulerBox = (await ruler.boundingBox())!;
	await ruler.click({ position: { x: rulerBox.width / 2, y: rulerBox.height / 2 } });
	await modal.getByLabel("Scale", { exact: true }).fill("1.5");
	const markers = modal.locator("[data-vui-slot='marker']");
	await expect(markers).toHaveCount(2);
	await markers.last().click();
	await expect(modal.locator(".tl2-studio-markbar")).toContainText("Scale keyframe");
	const markerLabel = await markers.last().getAttribute("aria-label");
	await markers.last().focus();
	await page.keyboard.press("ArrowLeft");
	await expect(markers.last()).not.toHaveAttribute("aria-label", markerLabel!);
	await ruler.focus();
	await page.keyboard.press("Delete");
	await expect(modal).toBeVisible();
	expect(await editorClips.count()).toBe(mainClipCount);
	await modal.getByRole("button", { name: "Motion identity" }).click();
	await modal.getByPlaceholder("Motion name").fill("Visual motion");
	await modal.getByRole("button", { name: "Save motion" }).click();
	await expect(modal).toHaveCount(0);
	expect(readSaved()?.label).toBe("Visual motion");
	expect((readSaved()?.config as { overlays?: unknown[] } | undefined)?.overlays).toHaveLength(1);
	await expect(trigger).toBeFocused();

	await trigger.click();
	await modal.getByRole("button", { name: "Cancel" }).click();
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

test("VUI timeline exposes keyboard seek and resize announcements", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	const ruler = modal.locator("[data-vui-slot='ruler']");
	await ruler.focus();
	await page.keyboard.press("ArrowRight");
	await expect(ruler).toHaveAttribute("aria-valuenow", "0.03333333333333333");
	await page.keyboard.press("End");
	await expect(ruler).toHaveAttribute("aria-valuenow", /.+/);

	const range = modal.locator("[data-vui-slot='item']").filter({ hasText: "Max visual beat" });
	await range.focus();
	const before = (await range.boundingBox())!;
	await page.keyboard.press("Shift+ArrowRight");
	await expect(range.locator("[data-vui-slot='label']")).toBeVisible();
	await expect(range.locator("[data-vui-slot='announcer']")).toContainText("end is");
	const after = (await range.boundingBox())!;
	expect(after.width).toBeGreaterThan(before.width);
});

test("VUI overlay restores opener focus on close button, Escape, and scrim", async ({ page }) => {
	await page.keyboard.press("Alt+Digit4");
	const trigger = page.locator(".tl2-template-create");
	const modal = page.locator(".tl2-template-editor-modal");
	await trigger.click();
	await modal.getByTitle("Close").click();
	await expect(trigger).toBeFocused();

	await trigger.click();
	await page.keyboard.press("Escape");
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();

	await trigger.click();
	await page.locator("[data-vui-overlay-kind='workspace']").click({ position: { x: 2, y: 2 } });
	await expect(modal).toHaveCount(0);
	await expect(trigger).toBeFocused();
});

/**
 * The overlay contract, driven for real on both VUI editors.
 *
 * Focus containment, background inertness and the body scroll lock were
 * previously proved by throwaway fixtures that no longer exist, so nothing
 * guarded them. These assert the behavior on the actual editors, which is the
 * only place a regression would matter.
 */
for (const editor of [
	{
		name: "template editor",
		open: async (page: Page) => {
			await page.keyboard.press("Alt+Digit4");
			const trigger = page.locator(".tl2-template-create");
			await trigger.click();
			return trigger;
		},
		modal: ".tl2-template-editor-modal",
	},
	{
		name: "Motion Studio",
		open: async (page: Page) => {
			await page.keyboard.press("Alt+Digit5");
			const section = page
				.locator("section")
				.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
				.first();
			const trigger = section.getByRole("button", { name: /New motion/ });
			await trigger.click();
			return trigger;
		},
		modal: ".tl2-studio",
	},
]) {
	test(`${editor.name} contains focus, inerts the background, and locks body scroll`, async ({
		page,
	}) => {
		const bodyOverflowBefore = await page.evaluate(() => getComputedStyle(document.body).overflow);
		const trigger = await editor.open(page);
		const modal = page.locator(editor.modal);
		await expect(modal).toBeVisible();

		/* Labelled dialog, and focus starts inside it. */
		const dialog = page.locator("[data-vui-slot='dialog']");
		await expect(dialog).toHaveAttribute("aria-modal", "true");
		await expect(dialog).toHaveAttribute("aria-label", /.+/);
		expect(
			await page.evaluate(
				() => document.activeElement?.closest("[data-vui-slot='dialog']") != null,
			),
			"focus did not enter the dialog",
		).toBe(true);

		/* The background is inert and hidden from assistive technology, and the
		   overlay's own host is not. */
		const background = await page.evaluate(() =>
			Array.from(document.body.children)
				.filter((element) => element.querySelector("[data-vui-slot='overlay']") == null)
				.map((element) => ({
					inert: (element as HTMLElement & { inert?: boolean }).inert === true,
					hidden: element.getAttribute("aria-hidden"),
				})),
		);
		expect(background.length, "no background siblings to inert").toBeGreaterThan(0);
		for (const sibling of background)
			expect(sibling, "background sibling not inerted").toEqual({ inert: true, hidden: "true" });
		expect(
			await page.evaluate(() => getComputedStyle(document.body).overflow),
			"body scroll not locked",
		).toBe("hidden");

		/* Tab cycles within the dialog rather than escaping to the page behind. */
		for (let press = 0; press < 12; press++) {
			await page.keyboard.press("Tab");
			expect(
				await page.evaluate(
					() => document.activeElement?.closest("[data-vui-slot='dialog']") != null,
				),
				`focus escaped the dialog after ${press + 1} Tab presses`,
			).toBe(true);
		}
		await page.keyboard.press("Shift+Tab");
		expect(
			await page.evaluate(
				() => document.activeElement?.closest("[data-vui-slot='dialog']") != null,
			),
			"focus escaped the dialog on Shift+Tab",
		).toBe(true);

		/* Closing restores the opener, un-inerts the background and releases the
		   scroll lock — all three, because a leak in any one is invisible. */
		await page.keyboard.press("Escape");
		await expect(modal).toHaveCount(0);
		await expect(trigger).toBeFocused();
		expect(await page.evaluate(() => getComputedStyle(document.body).overflow)).toBe(
			bodyOverflowBefore,
		);
		expect(
			await page.evaluate(() =>
				Array.from(document.body.children).some(
					(element) =>
						(element as HTMLElement & { inert?: boolean }).inert === true ||
						element.getAttribute("aria-hidden") === "true",
				),
			),
			"background left inert after close",
		).toBe(false);
	});
}
