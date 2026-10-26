/* One shell, three surfaces — asserted rather than intended.
 *
 * Main Editor, Template Studio and Motion Studio all mount the same VUI
 * workspace, and the drift this catches is the kind that reads as fine on each
 * surface alone: two studios naming the same lane column two different things,
 * one reaching its inspector from a text button in the timeline toolbar while
 * the other has a bar, one keeping a modal button row at phone width. Each is
 * defensible on its own screen. Together they are three editors wearing one
 * shell.
 *
 * The assertions are about the PUBLISHED contract — `data-vui-slot` — and not
 * about how each surface draws its rows. Domain rows are meant to differ; the
 * chrome around them is not.
 */
import { expect, test, devices, type Locator, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";
import { controlNames, expectControls } from "./control-inventory.ts";
import { expectRenders, surfaceGeometry } from "./vui-geometry.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

/** The chrome every timeline surface publishes, whatever it draws inside. */
const SHARED_TIMELINE_SLOTS = ["ruler", "timeline-scroller"] as const;
/** The lane column. Both studios draw their own labels; both say so the same way. */
const STUDIO_TIMELINE_SLOTS = [...SHARED_TIMELINE_SLOTS, "gutter"] as const;

/* The transport's two readouts — one pair of selectors, because there is now
 * one transport. These briefly listed the package's `VuiTransport` markup too,
 * whose glyphs are literal "▶"/"||" strings and whose timecode is an `<output>`;
 * that the single pair still resolves on all three surfaces is what says the
 * studios stopped drawing it. */
const TIMECODE = "[data-transport='timecode']";
const PLAY = "[data-transport='play']";

/* The bar each studio carries at phone width, in both of its states.
 *
 * The shape is the content editor's: a tool row until something is selected,
 * that thing's sections once something is, with the commit pinned throughout.
 * Listed per state rather than derived from one another, because the states
 * differ by more than one control and a derived expectation would have agreed
 * with whatever shipped.
 *
 * Motion Studio is converted; Template Studio is not yet, so its bar is still
 * its full category list with a subject always present. That difference is
 * visible here on purpose — it is the remaining half of the change.
 */
const MOTION_BAR_IDLE = ["Motion identity", "Save motion"] as const;
/** Under a sheet the leading control returns, as Back: the sheet is the nearer
 *  layer to leave even when nothing is selected. */
const MOTION_BAR_SHEET = ["Back", "Motion identity", "Save motion"] as const;

/* Template Studio's tool row is longer than Motion Studio's because its
 * destinations are longer: every one of these is a setting of the TEMPLATE, so
 * all of them are reachable with nothing selected. Motion Studio has exactly one
 * such destination. Same rule, different surfaces. */
const TEMPLATE_BAR_IDLE = [
	"Template identity",
	"Opening · section 1",
	"Section entries",
	"Scene behavior",
	"Background music",
	"Visual framework",
	"Create template",
] as const;
const TEMPLATE_BAR_SHEET = ["Back", ...TEMPLATE_BAR_IDLE] as const;

/**
 * The playhead has a box, and that is all this asks.
 *
 * `expectRenders` also requires the element to be topmost at its own centre,
 * which is the right question for a control and the wrong one for a two-pixel
 * line drawn across lanes that paint over it. Asserting presence and width keeps
 * the claim — every surface marks its position the same way — without encoding
 * which of them happens to win the paint order.
 */
async function expectPlayhead(page: Page, selector: string, label: string): Promise<void> {
	const geometry = await surfaceGeometry(page, selector);
	expect(geometry.box, `${label}: no playhead`).not.toBeNull();
	expect(geometry.box!.h, `${label}: playhead has no height`).toBeGreaterThan(1);
}

async function openEditor(page: Page): Promise<void> {
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
}

async function openTemplateStudio(page: Page): Promise<Locator> {
	await page.keyboard.press("Alt+Digit4");
	await page.locator(".tl2-template-create").click();
	const modal = page.locator(".tl2-template-editor-modal");
	await expect(modal).toBeVisible();
	await modal.evaluate((node) =>
		Promise.all(node.getAnimations().map((animation) => animation.finished)),
	);
	return modal;
}

async function openMotionStudio(page: Page): Promise<Locator> {
	await page.keyboard.press("Alt+Digit5");
	const section = page
		.locator("section")
		.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
		.first();
	await section.getByRole("button", { name: /New motion/ }).click();
	const modal = page.locator(".tl2-studio");
	await expect(modal).toBeVisible();
	await modal.evaluate((node) =>
		Promise.all(node.getAnimations().map((animation) => animation.finished)),
	);
	return modal;
}

test.describe("desktop", () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
	});

	for (const theme of ["light", "dark"] as const)
		test(`workspace appearance follows timeline default ${theme}`, async ({ page }, info) => {
			await page.emulateMedia({ colorScheme: theme });
			const appearance = async (root: Locator) =>
				root.locator(':scope > [data-vui-slot="main"]').evaluate((main) => {
					const paint = (node: Element) => {
						const style = getComputedStyle(node);
						return [
							style.backgroundColor,
							style.borderColor,
							style.borderWidth,
							style.borderRadius,
						];
					};
					const style = getComputedStyle(main);
					return {
						gap: style.gap,
						padding: style.padding,
						panes: ["preview", "inspector", "timeline"].map((slot) =>
							paint(main.querySelector(`:scope > [data-vui-slot="${slot}"]`)!),
						),
					};
				});
			const measureStandardModal = () =>
				page.evaluate(() => {
					const backdrop = document.createElement("div");
					backdrop.className = "cv-modal-back";
					backdrop.innerHTML =
						'<div class="cv-modal"><header class="cv-modal-h"><b class="cv-modal-title">Title</b><small class="cv-modal-sub">Subtitle</small></header></div>';
					document.body.append(backdrop);
					const paint = getComputedStyle(backdrop.firstElementChild!);
					const result = {
						scrim: getComputedStyle(backdrop).backgroundColor,
						blur: getComputedStyle(backdrop).backdropFilter,
						surface: paint.backgroundColor,
						radius: paint.borderRadius,
						border: paint.border,
						shadow: paint.boxShadow,
						headerPadding: getComputedStyle(backdrop.querySelector("header")!).padding,
						titleSize: getComputedStyle(backdrop.querySelector("b")!).fontSize,
					};
					backdrop.remove();
					return result;
				});
			const project = page.locator(".tl2-content-vui-shell");
			const ruler = project.locator('[data-vui-slot="ruler"]').first();
			await expect(ruler).toHaveCSS("height", "30px");
			await expect(project.locator(".tl2-gutter")).toHaveCSS("width", "120px");
			const projectClip = project.locator('[data-vui-slot="item"]').first();
			await projectClip.click();
			await expect(projectClip).toHaveClass(/\bon\b/);
			await projectClip.evaluate((node) =>
				Promise.all(node.getAnimations().map((animation) => animation.finished)),
			);
			const selectedShadow = await projectClip.evaluate((node) => getComputedStyle(node).boxShadow);
			const projectIcon = project.locator(".tl2-clip-railbtn svg").first();
			await expect(projectIcon).toHaveAttribute("width", "17");
			const sectionBody = await project
				.locator('[data-vui-slot="accordion-body"]')
				.first()
				.evaluate((node) => {
					const style = getComputedStyle(node);
					return { padding: style.padding, gap: style.gap };
				});
			const sectionStyle = await project
				.locator('[data-vui-slot="accordion-header"]')
				.first()
				.evaluate((node) => {
					const style = getComputedStyle(node);
					return { height: style.minHeight, font: style.fontSize, padding: style.paddingInline };
				});
			const rulerBackground = await ruler.evaluate(
				(node) => getComputedStyle(node).backgroundColor,
			);
			const expected = await appearance(project);
			expect(expected.gap).toBe("8px");
			expect(expected.padding).toBe("8px");
			for (const pane of expected.panes) {
				expect(pane[2]).toBe("1px");
				expect(pane[3]).toBe("8px");
			}
			for (const open of [openTemplateStudio, openMotionStudio]) {
				const modal = await open(page);
				if (open === openTemplateStudio) {
					await modal.locator('[data-vui-category="opening"]').click();
					await expect(modal.getByText("Opening title (section 1)")).toBeVisible();
					await expect(modal.getByText("Controls only the first section opening.")).toHaveCount(0);
					await expect(
						modal.locator(
							'.tl2-template-editor-form [data-vui-slot="accordion-body"] p:not([role="alert"])',
						),
					).toHaveCount(0);
				}
				const standardModal = await measureStandardModal();
				await expect(modal).toHaveCSS("background-color", "rgb(10, 10, 12)");
				await expect(modal.locator('[data-vui-slot="header"]')).toHaveCSS(
					"background-color",
					standardModal.surface,
				);
				await expect(modal.locator('[data-vui-slot="footer"]')).toHaveCSS(
					"background-color",
					standardModal.surface,
				);
				await expect(modal).toHaveCSS("border-radius", standardModal.radius);
				await expect(modal).toHaveCSS("border", standardModal.border);
				await expect(modal).toHaveCSS("box-shadow", standardModal.shadow);
				const overlay = page.locator('[data-vui-overlay-kind="workspace"]');
				await expect(overlay).toHaveCSS("background-color", standardModal.scrim);
				await expect(overlay).toHaveCSS("backdrop-filter", standardModal.blur);
				await expect(modal.locator('[data-vui-slot="header"]')).toHaveCSS(
					"padding",
					standardModal.headerPadding,
				);
				await expect(modal.locator(".tl2-editor-heading b")).toHaveCSS(
					"font-size",
					standardModal.titleSize,
				);
				const heading = modal.locator(".tl2-editor-heading");
				const titleBox = (await heading.locator("b").boundingBox())!,
					subtitleBox = (await heading.locator("small").boundingBox())!;
				expect(subtitleBox.y).toBeGreaterThanOrEqual(titleBox.y + titleBox.height);
				await expect(modal.locator('[data-vui-slot="close"]')).toHaveAttribute(
					"data-slot",
					"icon-button",
				);
				expect(await appearance(modal)).toEqual(expected);
				await expect(modal.locator('[data-vui-slot="category"]').first()).toHaveCSS(
					"width",
					"34px",
				);
				await expect(modal.locator('[data-vui-slot="category"]').first()).toHaveCSS(
					"height",
					"34px",
				);
				await expect(modal.locator('[data-vui-slot="category"] svg').first()).toHaveCSS(
					"width",
					"17px",
				);
				const studioSection = modal.locator('[data-vui-slot="accordion-header"]').first();
				await expect(studioSection).toHaveCSS("min-height", sectionStyle.height);
				await expect(studioSection).toHaveCSS("font-size", sectionStyle.font);
				await expect(studioSection).toHaveCSS("padding-inline", sectionStyle.padding);
				await expect(modal.locator('[data-vui-slot="accordion-body"]').first()).toHaveCSS(
					"padding",
					sectionBody.padding,
				);
				await expect(modal.locator('[data-vui-slot="accordion-body"]').first()).toHaveCSS(
					"gap",
					sectionBody.gap,
				);
				await expect(modal.locator('[data-vui-slot="gutter"]')).toHaveCSS("width", "120px");
				await expect(modal.locator('[data-vui-slot="ruler"]')).toHaveCSS("height", "24px");
				await expect(modal.locator('[data-vui-slot="ruler"]')).toHaveCSS(
					"background-color",
					rulerBackground,
				);
				await expect(modal.locator(".tl2-tick em").first()).toHaveCSS("font-size", "10px");
				await expect(modal.locator('[data-vui-slot="row"]').first()).toHaveCSS("height", "36px");
				await expect(modal.locator('[data-vui-slot="gutter-row"]').first()).toHaveCSS(
					"height",
					"36px",
				);
				const clip = modal.locator('[data-vui-slot="item"]').first();
				await expect(clip).toHaveCSS("border-radius", "4px");
				await info.attach(
					`timeline-${open === openMotionStudio ? "motion" : "template"}-${theme}`,
					{
						body: await modal.screenshot({ animations: "disabled", caret: "hide" }),
						contentType: "image/png",
					},
				);
				await clip.click();
				await expect(clip).toHaveCSS("box-shadow", selectedShadow);
				const preview = modal.locator('[data-vui-slot="preview"]');
				const stage = modal.locator(".tl2-studio-stage");
				await expect(stage).toBeVisible();
				const paneBox = (await preview.boundingBox())!,
					stageBox = (await stage.boundingBox())!;
				expect(stageBox.width).toBeGreaterThan(30);
				expect(stageBox.height).toBeGreaterThan(30);
				expect(stageBox.x).toBeGreaterThanOrEqual(paneBox.x);
				expect(stageBox.y).toBeGreaterThanOrEqual(paneBox.y);
				expect(stageBox.x + stageBox.width).toBeLessThanOrEqual(paneBox.x + paneBox.width);
				expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height);
				await expect(stage).toHaveCSS("box-shadow", "none");
				await expect(stage).toHaveCSS("border-width", "0px");
				const accordion = modal.locator('[data-vui-slot="accordion-header"]').first();
				await expect(accordion).toHaveCSS("min-height", "44px");
				await expect(accordion).toHaveCSS("padding-inline", "12px");
				await expect(accordion).toHaveCSS("font-size", "12px");
				const timelinePane = modal.locator('[data-vui-slot="timeline"]');
				const scroller = modal.locator('[data-vui-slot="timeline-scroller"]');
				const gutter = modal.locator('[data-vui-slot="gutter"]');
				const ruler = modal.locator('[data-vui-slot="ruler"]');
				const toolbar = modal.locator(".vui-workspace-timeline-toolbar");
				if (open === openMotionStudio) {
					for (let index = 0; index < 8; index++)
						await toolbar.getByRole("button", { name: "Text" }).click();
				}
				const clipPaint = await modal.locator('[data-vui-slot="row"]').evaluateAll((rows) =>
					rows.flatMap((row) => {
						const clip = row.querySelector<HTMLElement>(':scope > [data-vui-slot="item"]');
						return clip
							? [
									{
										fill: getComputedStyle(clip).backgroundColor,
										lane: getComputedStyle(row).backgroundColor,
										stripe: getComputedStyle(clip).borderLeftColor,
										stripeWidth: getComputedStyle(clip).borderLeftWidth,
									},
								]
							: [];
					}),
				);
				expect(clipPaint.length).toBeGreaterThanOrEqual(3);
				expect(new Set(clipPaint.slice(0, 3).map((clip) => clip.fill)).size).toBe(3);
				expect(new Set(clipPaint.slice(0, 3).map((clip) => clip.stripe)).size).toBe(3);
				for (const clip of clipPaint.slice(0, 3)) {
					expect(clip.fill).not.toBe(clip.lane);
					expect(clip.stripeWidth).toBe("3px");
				}
				const lastRow = modal.locator('[data-vui-slot="gutter-row"]').last();
				if (await scroller.evaluate((node) => node.scrollHeight > node.clientHeight)) {
					const toolbarY = (await toolbar.boundingBox())!.y;
					const rulerY = (await ruler.boundingBox())!.y;
					const wheelBox = (await scroller.boundingBox())!;
					await page.mouse.move(wheelBox.x + wheelBox.width / 2, wheelBox.y + wheelBox.height / 2);
					await page.mouse.wheel(0, 1000);
					await expect.poll(() => scroller.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
					expect((await toolbar.boundingBox())!.y).toBeCloseTo(toolbarY, 0);
					expect((await ruler.boundingBox())!.y).toBeCloseTo(rulerY, 0);
					await expect
						.poll(async () =>
							Math.abs(
								(await scroller.evaluate((node) => node.scrollTop)) -
									(await gutter.evaluate((node) => node.scrollTop)),
							),
						)
						.toBeLessThan(1);
				}
				await lastRow.scrollIntoViewIfNeeded();
				const timelineBox = (await timelinePane.boundingBox())!,
					rowBox = (await lastRow.boundingBox())!,
					rulerBox = (await ruler.boundingBox())!;
				expect(rowBox.y).toBeGreaterThanOrEqual(rulerBox.y + rulerBox.height);
				expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(timelineBox.y + timelineBox.height);
				const lastItem = modal.locator('[data-vui-slot="item"]').last();
				await lastItem.scrollIntoViewIfNeeded();
				await expect(lastItem).toBeInViewport();
				await modal.locator("[title='Close']").click();
			}
		});

	/* The transport sits in the same region on all three, and at the same offset.
	 *
	 * Both halves matter and they failed differently. Before this, the studios put
	 * their transport under the PREVIEW while the editor kept it in the timeline —
	 * a different region entirely. And the studios positioned by flexible spacer,
	 * so Motion Studio's timecode sat further right than Template Studio's purely
	 * because three add-layer buttons preceded it. A fixed centre track answers
	 * the second: the offset cannot depend on what the neighbours hold. */
	/* The transport drives its renderer, and says so.
	 *
	 * Both studios shipped a transport that issued the command and then reported
	 * the state it had before: play started the player, and the timecode stayed
	 * at 0:00 while the accessible name stayed "Play preview". Measured here at
	 * 1440x900, the editor ran 00:00:00 to 00:01:43 over the same interval.
	 *
	 * The cause was not playback. `useRemotionPlayhead` attached its listeners in
	 * an effect that read `playerRef.current` at mount, before Remotion had
	 * attached its handle, and nothing re-ran it — assigning `.current` is not a
	 * render. The preview was playing the whole time and nothing was subscribed
	 * to it, which is why this asserts the READOUT rather than the player: a
	 * check that asked the player whether it was playing would have passed
	 * throughout.
	 *
	 * Driven at desktop width because the defect is not a phone one; the phone
	 * composition of the same transport is covered in mobile-editor.spec.ts. */
	test("Motion Studio advances when audio output cannot resume", async ({ page }) => {
		await page.addInitScript(() => {
			const NativeAudioContext = window.AudioContext;
			window.AudioContext = class extends NativeAudioContext {
				override resume(): Promise<void> {
					return new Promise(() => {});
				}
			};
		});
		await openEditor(page);
		const modal = await openMotionStudio(page);
		const readout = modal.locator(TIMECODE);
		const before = await readout.textContent();
		await modal.locator(PLAY).click();
		await expect.poll(() => readout.textContent()).not.toBe(before);
	});

	test("every surface's transport reports the playback it started", async ({ page }) => {
		for (const [name, open, scope] of [
			["main editor", null, ".tl2-timeline"],
			["Template Studio", openTemplateStudio, ".tl2-template-editor-modal"],
			["Motion Studio", openMotionStudio, ".tl2-studio"],
		] as const) {
			const modal = open ? await open(page) : null;
			const readout = page.locator(`${scope} ${TIMECODE}`).first();
			const play = page.locator(`${scope} ${PLAY}`).first();
			await expect(readout, `${name}: no timecode`).toBeVisible();

			/* The control's own state, not only the readout's. These fail
			   differently and the bar shipped failing both: the timecode froze
			   because `frameupdate` was unheard, and the label stuck because `play`
			   was. A fix that restored one and not the other would still leave a
			   control that lies about what it does. */
			const named = async (): Promise<string> =>
				(await play.getAttribute("aria-label")) ?? (await play.getAttribute("title")) ?? "";
			const idle = await named();
			const before = (await readout.textContent())?.trim() ?? "";

			await play.click();
			/* A wall-clock wait, deliberately: the claim is that time passes and the
			   readout follows, and there is no event to await that is not the very
			   subscription under test. */
			await page.waitForTimeout(1200);
			const after = (await readout.textContent())?.trim() ?? "";
			expect(after, `${name}: the timecode did not move while playing (${before})`).not.toBe(
				before,
			);
			expect(
				await named(),
				`${name}: the play control still reads "${idle}" while playing`,
			).not.toBe(idle);

			await play.click();
			await expect
				.poll(named, {
					message: `${name}: the play control did not return to "${idle}" when paused`,
				})
				.toBe(idle);
			if (modal) await modal.locator("[title='Close']").click();
		}
	});

	/* The view tracks the renderer.
	 *
	 * Only the content editor followed, because the follow lived inside
	 * `use-clip-position.ts` — a hook about committing a dragged clip — where no
	 * studio could reach it. Playing past the visible width in either studio left
	 * the operator watching a timeline that no longer showed where playback was.
	 *
	 * Asserted as "the scroller moved while playing", not as a position: the
	 * arithmetic is `nextTimelineFollowScroll`'s and is unit-tested against exact
	 * numbers in `timeline-editor.test.ts`. What cannot be unit-tested is whether
	 * anything calls it on this surface, with this surface's gutter. */
	/* Each surface needs its timeline to EXCEED its view before following can be
	   observed at all, and by default none of them does: measured, the scrollers
	   report scrollWidth === clientWidth on the editor and Motion Studio at every
	   width, because their content is sized to fit. Only Template Studio's eleven
	   seconds overflow, and only when narrow.

	   So each surface is put into the state the requirement describes rather than
	   asserted in a state where the assertion cannot fail. That is setup, not
	   staging: a fitted timeline genuinely has nothing to follow.

	   The content editor is absent on purpose. Its scroller is kernel-windowed and
	   never overflows at any zoom — measured, `scrollLeft = 200` reads back 0 — so
	   it cannot follow by moving a scroller and does not today. Asserting it here
	   would be asserting a thing this change deliberately does not do; it has its
	   own change. */
	test("Motion Studio follows the playhead during playback", async ({ page }) => {
		/* Motion Studio at the default width: a thirty-second motion at a fixed
		   72px/s overflows any viewport, so nothing needs resizing. Template
		   Studio's eleven seconds only overflow when narrow, so its own check
		   lives in a describe that OPENS at that width — resizing a page mid-test
		   raced the compact re-layout and failed at the studio's own trigger. */
		const modal = await openMotionStudio(page);
		const duration = modal.locator("input[type=number]").first();
		await duration.fill("30");
		await duration.blur();

		const el = page.locator(".tl2-studio [data-vui-slot='timeline-scroller']").first();
		await expect(el, "Motion Studio: no scroller").toBeVisible();
		await expect
			.poll(async () => el.evaluate((n) => n.scrollWidth - n.clientWidth), {
				message: "Motion Studio: nothing to scroll, so following cannot be observed",
				timeout: 4000,
			})
			.toBeGreaterThan(0);

		const before = await el.evaluate((n) => n.scrollLeft);
		await modal.locator(PLAY).first().click();
		/* Long, because following legitimately does nothing until the playhead
		   passes `clientWidth - padding`: measured, that is 13.06s in here. */
		await expect
			.poll(async () => el.evaluate((n) => n.scrollLeft), {
				message: `Motion Studio: the view did not follow the playhead (stayed at ${before})`,
				timeout: 20_000,
			})
			.toBeGreaterThan(before);

		await modal.locator("[title='Close']").click();
	});

	test("Motion Studio stops following while the operator holds the timeline", async ({ page }) => {
		/* Motion Studio, at the default width: it needs no resize to overflow, and
		   resizing an open studio races its compact re-layout. */
		const modal = await openMotionStudio(page);
		const duration = modal.locator("input[type=number]").first();
		await duration.fill("30");
		await duration.blur();
		const el = page.locator(".tl2-studio [data-vui-slot='timeline-scroller']").first();

		const timecode = modal.locator(TIMECODE).first();
		const start = await timecode.textContent();
		await modal.locator(PLAY).first().click();
		await expect
			.poll(() => timecode.textContent(), { message: "playback never started", timeout: 10_000 })
			.not.toBe(start);
		await expect
			.poll(async () => el.evaluate((n) => n.scrollLeft), {
				message: "played but never started following",
				timeout: 20_000,
			})
			.toBeGreaterThan(0);

		/* A real pan, then held still. A motionless press is deliberately NOT the
		   trigger — the surface reports a gesture only once one has started, and a
		   press that never moves is not one. So the pointer travels far enough to
		   begin the pan, and the assertion is about what happens AFTER it stops:
		   the view must stay where the finger left it rather than resuming its
		   creep underneath a hand that is still down. */
		const box = (await el.boundingBox())!;
		const cx = Math.round(box.x + box.width / 2);
		const cy = Math.round(box.y + box.height / 2);
		await page.mouse.move(cx, cy);
		await page.mouse.down();
		await page.mouse.move(cx - 60, cy, { steps: 6 });
		await page.waitForTimeout(300);
		const held = await el.evaluate((n) => n.scrollLeft);
		await page.waitForTimeout(1500);
		expect(
			await el.evaluate((n) => n.scrollLeft),
			"the view followed out from under the pointer",
		).toBe(held);

		await page.mouse.up();
		await modal.locator("[title='Close']").click();
	});

	test("the transport is in the timeline region, at the same offset, on every surface", async ({
		page,
	}) => {
		const centres: number[] = [];

		const editorBar = page.locator(".tl2-timeline [data-vui-slot='timeline-toolbar'] .tl2-tlbar-c");
		await expectRenders(
			page,
			".tl2-timeline [data-vui-slot='timeline-toolbar']",
			"main editor toolbar region",
		);
		centres.push(Math.round((await editorBar.boundingBox())!.x));

		const template = await openTemplateStudio(page);
		await expectRenders(
			page,
			".tl2-template-editor-modal [data-vui-slot='timeline'] [data-vui-slot='timeline-toolbar']",
			"Template Studio toolbar region",
		);
		expect(
			await template
				.locator(".tl2-template-editor-preview [data-vui-slot='transport-toggle']")
				.count(),
			"Template Studio's transport left the preview",
		).toBe(0);
		centres.push(Math.round((await template.locator(".tl2-tlbar-c").boundingBox())!.x));
		await template.locator("[title='Close']").click();

		const motion = await openMotionStudio(page);
		await expectRenders(
			page,
			".tl2-studio [data-vui-slot='timeline'] [data-vui-slot='timeline-toolbar']",
			"Motion Studio toolbar region",
		);
		expect(
			await motion.locator(".tl2-studio-stagewrap [data-vui-slot='transport-toggle']").count(),
			"Motion Studio's transport left the preview",
		).toBe(0);
		centres.push(Math.round((await motion.locator(".tl2-tlbar-c").boundingBox())!.x));

		/* The two studios are the same width, so their centre tracks start at the
		   same x whatever their leading regions hold — Motion's has three buttons
		   and Template's is empty. The editor is a different width, so only the
		   studios are compared to each other. */
		expect(
			centres[1],
			"the studios centre their transport identically despite different leading content",
		).toBe(centres[2]);
		await motion.locator("[title='Close']").click();
	});

	/* The other half of the phone bar's requirement, which is stated as a pair:
	 * below the breakpoint the toolbar keeps undo, redo and play and puts the
	 * rest behind More; at this width it carries all of it. The phone half is
	 * asserted in `mobile-editor.spec.ts`; without this one, a control that
	 * vanished from BOTH would still pass there.
	 *
	 * Twenty-three controls' worth of strip, most of them 15px glyphs. One of them
	 * disappearing is well inside the screenshot's budget, so they are named. */
	test("the editor's toolbar carries its full control set at desktop width", async ({ page }) => {
		await expectControls(
			page.locator(".tl2-timeline [data-vui-slot='timeline-toolbar']"),
			[
				"Undo",
				"Redo",
				"Split at playhead",
				"Trim clip",
				"Duplicate",
				"Delete",
				"Bookmarks",
				"Hook takes",
				"Playback speed",
				"Jump to start",
				"Play",
				"Jump to end",
				"Snapping",
				"Ripple editing",
				"Aspect ratio",
				"Organize range",
				"Pacing insights",
				"Beat grid",
				"Comfortable density",
				"Track headers",
				"Zoom out",
				"Timeline zoom",
				"Zoom in",
			],
			"main editor toolbar",
		);
	});

	/* The studios' desktop toolbars, named.
	 *
	 * Added because this change nearly shipped a stale one: Jump to start was
	 * given back to Motion Studio's desktop toolbar and `vui-motion-desktop.png`
	 * PASSED against a baseline taken before it — one 15px glyph is inside the
	 * pixel budget, which is the blind spot `bound-screenshot-tolerance` exists
	 * to record. A screenshot cannot say which controls a strip has; this can. */
	test("the studios' desktop toolbars carry their own control sets", async ({ page }) => {
		const template = await openTemplateStudio(page);
		await expectControls(
			template.locator("[data-vui-slot='timeline-toolbar']").first(),
			["Jump to start", "Play"],
			"Template Studio desktop toolbar",
		);
		await template.locator("[title='Close']").click();

		const motion = await openMotionStudio(page);
		await expectControls(
			motion.locator("[data-vui-slot='timeline-toolbar']").first(),
			["Text", "Rectangle", "Circle", "Triangle", "Star", "Cross", "Jump to start", "Play"],
			"Motion Studio desktop toolbar",
		);
		await motion.locator("[title='Close']").click();
	});

	test("every surface publishes the same timeline chrome", async ({ page }) => {
		for (const slot of SHARED_TIMELINE_SLOTS) {
			await expectRenders(page, `.tl2-timeline [data-vui-slot='${slot}']`, `main editor ${slot}`);
		}
		await expectPlayhead(page, ".tl2-timeline [data-vui-slot='playhead']", "main editor");

		const template = await openTemplateStudio(page);
		for (const slot of STUDIO_TIMELINE_SLOTS) {
			await expectRenders(
				page,
				`.tl2-template-editor-modal [data-vui-slot='${slot}']`,
				`Template Studio ${slot}`,
			);
		}
		await expectPlayhead(
			page,
			".tl2-template-editor-modal [data-vui-slot='playhead']",
			"Template Studio",
		);
		await template.locator("[title='Close']").click();
		await expect(template).toHaveCount(0);

		const motion = await openMotionStudio(page);
		for (const slot of STUDIO_TIMELINE_SLOTS) {
			await expectRenders(page, `.tl2-studio [data-vui-slot='${slot}']`, `Motion Studio ${slot}`);
		}
		await expectPlayhead(page, ".tl2-studio [data-vui-slot='playhead']", "Motion Studio");
		await motion.locator("[title='Close']").click();
		await expect(motion).toHaveCount(0);
	});

	/* Both studios inspect through the shared rail, and reach it the same way.
	 * Template Studio was a stack of six accordions — a third inspector model
	 * across three surfaces that are supposed to be one. */
	test("both studios inspect through the same rail", async ({ page }) => {
		const template = await openTemplateStudio(page);
		await expectRenders(
			page,
			".tl2-template-editor-modal [data-vui-slot='inspector-rail']",
			"Template Studio rail",
		);
		expect(
			await template.locator("[data-vui-slot='category']").count(),
			"Template Studio has rail destinations",
		).toBeGreaterThan(1);
		await template.locator("[title='Close']").click();

		const motion = await openMotionStudio(page);
		await expectRenders(page, ".tl2-studio [data-vui-slot='inspector-rail']", "Motion Studio rail");
		expect(
			await motion.locator("[data-vui-slot='category']").count(),
			"Motion Studio has rail destinations",
		).toBeGreaterThan(0);
		await motion.locator("[title='Close']").click();
	});

	/* The desktop footer is the desktop's action row. It is asserted here so the
	 * phone's replacement of it, below, is a deliberate difference rather than
	 * something that quietly went missing on both. */
	test("both studios keep a desktop action row", async ({ page }) => {
		const template = await openTemplateStudio(page);
		await expectRenders(
			page,
			".tl2-template-editor-modal [data-vui-slot='footer']",
			"Template Studio footer",
		);
		expect(
			await page.locator("[data-vui-slot='mobile-actions']").count(),
			"no phone bar on desktop",
		).toBe(0);
		await template.locator("[title='Close']").click();

		const motion = await openMotionStudio(page);
		await expectRenders(page, ".tl2-studio [data-vui-slot='footer']", "Motion Studio footer");
		expect(
			await page.locator("[data-vui-slot='mobile-actions']").count(),
			"no phone bar on desktop",
		).toBe(0);
		await motion.locator("[title='Close']").click();
	});
});

test.describe("phone", () => {
	test.use(
		(() => {
			const { defaultBrowserType, ...options } = devices["iPhone 15"];
			void defaultBrowserType;
			return { ...options, deviceScaleFactor: 1 };
		})(),
	);

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
	});

	test("shared workspace fits 320px and keeps studio inspectors reachable", async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 740 });
		await expect(page.locator(".tl2-canvas")).toBeVisible();
		for (const open of [openTemplateStudio, openMotionStudio]) {
			const modal = await open(page);
			const preview = modal.locator('[data-vui-slot="preview"]');
			const stage = modal.locator(".tl2-studio-stage");
			await expect(stage).toBeVisible();
			const paneBox = (await preview.boundingBox())!,
				stageBox = (await stage.boundingBox())!;
			expect(stageBox.width).toBeGreaterThan(30);
			expect(stageBox.height).toBeGreaterThan(30);
			expect(stageBox.width).toBeLessThanOrEqual(paneBox.width);
			expect(stageBox.y + stageBox.height).toBeLessThanOrEqual(paneBox.y + paneBox.height);
			expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
				320,
			);
			await expect(modal.locator('[data-vui-slot="timeline"]')).toBeVisible();
			const scroller = modal.locator('[data-vui-slot="timeline-scroller"]');
			const toolbarY = (await modal.locator(".vui-workspace-timeline-toolbar").boundingBox())!.y;
			const rulerY = (await modal.locator('[data-vui-slot="ruler"]').boundingBox())!.y;
			await modal.locator('[data-vui-slot="gutter-row"]').last().scrollIntoViewIfNeeded();
			if (await scroller.evaluate((node) => node.scrollTop > 0)) {
				expect(
					(await modal.locator(".vui-workspace-timeline-toolbar").boundingBox())!.y,
				).toBeCloseTo(toolbarY, 0);
				expect((await modal.locator('[data-vui-slot="ruler"]').boundingBox())!.y).toBeCloseTo(
					rulerY,
					0,
				);
			}
			const lastItem = modal.locator('[data-vui-slot="item"]').last();
			await lastItem.scrollIntoViewIfNeeded();
			await expect(lastItem).toBeInViewport();
			await expect(stage).toBeInViewport();
			const bar = page.locator('[data-vui-slot="mobile-actions"]');
			await bar.locator("[data-studio-category]").first().click();
			const sheet = page.locator('[data-vui-slot="sheet"]');
			await expect(sheet.locator("input").first()).toBeVisible();
			await sheet.locator("input").first().fill("Compact shared editor");
			await bar.getByRole("button", { name: "Back", exact: true }).click();
			await expect(sheet).toHaveCount(0);
			await expect(modal).toBeVisible();
			await modal.locator("[title='Close']").click();
		}
	});

	/* The rule this exists to hold: a studio's inspector and actions come from the
	 * bottom bar, not from a text button wedged into the timeline toolbar, whose
	 * width belongs to the timeline and which does not scale past one panel. */
	/* The two states, on the surface that has them.
	 *
	 * This is the change the screenshots could not see and a count could not
	 * catch: the bar used to list every layer at once in both states, so
	 * selecting one changed nothing about it. Now the bar becomes the selected
	 * layer's sections, and deselecting returns it to the tool row.
	 */
	/* The toolbar, named. Three add-layer buttons crowded the transport on a
	 * 393px strip; they are one `+` opening a sheet now, and Stop is behind the
	 * disclosure where the content editor already keeps the same command. */
	/* Template Studio's two states, and its one-control selected bar.
	 *
	 * One control is not a thinner Motion Studio: `timelineTemplateInspectorSection`
	 * maps every range to exactly one section, so a selected range has exactly one
	 * place its properties live. Asserted rather than smoothed over, because the
	 * honest rendering of this inspector is what the bar should show. */
	test("Template Studio's bar becomes the selected range, and returns", async ({ page }) => {
		const modal = await openTemplateStudio(page);
		const bar = page.locator("[data-vui-slot='mobile-actions']");
		await expectControls(bar, TEMPLATE_BAR_IDLE, "Template Studio bar, nothing selected");

		await modal.locator("[data-vui-slot='item']").first().click();
		const selected = await controlNames(bar);
		expect(selected[0], "the leading control clears the selection").toBe("Close");
		expect(selected.at(-1), "the commit stays pinned").toBe("Create template");
		expect(
			selected.length,
			`one section for the selected range, got ${JSON.stringify(selected)}`,
		).toBe(3);
		await expect(bar.locator(".tl2-studiobar-subject")).not.toBeEmpty();

		await bar.getByRole("button", { name: "Close", exact: true }).click();
		await expectControls(bar, TEMPLATE_BAR_IDLE, "Template Studio bar, deselected");
		await modal.locator("[title='Close']").click();
	});

	/* No add control: a template's ranges are derived from its settings, so there
	 * is nothing to add to this timeline. */
	test("Template Studio's phone toolbar is play and one disclosure", async ({ page }) => {
		const modal = await openTemplateStudio(page);
		const toolbar = modal.locator("[data-vui-slot='timeline-toolbar']").first();
		await expectControls(toolbar, ["Play", "More tools"], "Template Studio phone toolbar");

		await toolbar.getByRole("button", { name: "More tools" }).click();
		const sheet = page.locator("[data-vui-slot='sheet']");
		await expect(sheet.getByRole("button", { name: "Jump to start" })).toBeVisible();
		await sheet.getByRole("button", { name: "Close Tools" }).click();
		await expect(sheet).toHaveCount(0);
		await modal.locator("[title='Close']").click();
	});

	test("Motion Studio's phone toolbar is add, play and one disclosure", async ({ page }) => {
		const modal = await openMotionStudio(page);
		const toolbar = modal.locator("[data-vui-slot='timeline-toolbar']").first();
		await expectControls(
			toolbar,
			["Add layer", "Play", "More tools"],
			"Motion Studio phone toolbar",
		);

		/* The kinds moved behind the control rather than being deleted, and the
		   sheet actually adds one. */
		await toolbar.getByRole("button", { name: "Add layer" }).click();
		const addSheet = page.locator("[data-vui-slot='sheet']");
		await expect(addSheet).toBeVisible();
		await expectControls(
			addSheet,
			["Close Add layer", "Text", "Rectangle", "Circle", "Triangle", "Star", "Cross"],
			"add-layer sheet",
		);
		const before = await modal.locator("[data-vui-slot='item']").count();
		await addSheet.getByRole("button", { name: "Rectangle" }).click();
		await expect(modal.locator("[data-vui-slot='item']")).toHaveCount(before + 1);

		/* And Stop is reachable, under the name the content editor gives it. */
		await toolbar.getByRole("button", { name: "More tools" }).click();
		await expect(
			page.locator("[data-vui-slot='sheet']").getByRole("button", { name: "Jump to start" }),
		).toBeVisible();
		await page
			.locator("[data-vui-slot='sheet']")
			.getByRole("button", { name: "Close Tools" })
			.click();
		await expect(page.locator("[data-vui-slot='sheet']")).toHaveCount(0);
		await modal.locator("[title='Close']").click();
	});

	test("Motion Studio's bar becomes the selected layer, and returns", async ({ page }) => {
		const modal = await openMotionStudio(page);
		const bar = page.locator("[data-vui-slot='mobile-actions']");
		await expectControls(bar, MOTION_BAR_IDLE, "Motion Studio bar, nothing selected");

		await modal.locator("[data-vui-slot='item']").first().click();
		await expectControls(
			bar,
			["Close", "Content", "Placement", "Motion", "Style", "Timing", "Save motion"],
			"Motion Studio bar, layer selected",
		);
		/* And the caption, which is not a control and so is deliberately outside
		   the inventory: [close] SUBJECT [sections] [save]. */
		await expect(bar.locator(".tl2-studiobar-subject")).toHaveText("Text");

		/* And back, by the same route the content editor's clip bar takes: the
		   leading control clears the selection rather than leaving the studio. */
		await bar.getByRole("button", { name: "Close", exact: true }).click();
		await expectControls(bar, MOTION_BAR_IDLE, "Motion Studio bar, deselected");
		await modal.locator("[title='Close']").click();
	});

	test("both studios put their actions on the bar, not in the timeline toolbar", async ({
		page,
	}) => {
		for (const [name, open, inventory, underSheet, pinnedLead] of [
			/* No pinned lead either, now: with nothing selected this is a tool row
			   and the studio's exit is the compact header's back control. */
			["Template Studio", openTemplateStudio, TEMPLATE_BAR_IDLE, TEMPLATE_BAR_SHEET, null],
			/* No pinned lead: with nothing selected Motion Studio's bar is a tool
			   row, and the studio's exit is the compact header's back control. */
			["Motion Studio", openMotionStudio, MOTION_BAR_IDLE, MOTION_BAR_SHEET, null],
		] as const) {
			const modal = await open(page);
			/* Page level, not inside the modal: the region is portalled to a sibling of
			   the workspace so a sheet cannot inert it. */
			await expectRenders(page, "[data-vui-slot='mobile-actions']", `${name} action bar`);
			expect(
				await modal.locator("[data-vui-slot='footer']").count(),
				`${name} has no desktop footer row on a phone`,
			).toBe(0);
			expect(
				await modal
					.locator(".tl2-studio-tl-toolbar")
					.getByRole("button", { name: /Inspector/ })
					.count(),
				`${name} has no Inspector text button in its timeline toolbar`,
			).toBe(0);
			/* One control per inspector category, not one control that opens a rail.
			   Icon controls with accessible names, which is what lets the bar carry
			   several without captions competing for the same glance.

			   Named rather than counted, and this is the surface that taught the
			   difference: the bar arrived in this shape — a gear replaced by six
			   category glyphs and a caption — and both phone screenshots passed
			   against their old baselines, because the redesign moved 189 pixels
			   against a 518-pixel budget. A count would have passed it too. */
			const bar = page.locator("[data-vui-slot='mobile-actions']");
			await expectControls(bar, inventory, `${name} action bar`);

			/* One tap to the field: the sheet opens AT the chosen category, and does
			   not repeat the bar as a column inside itself. */
			await bar.locator("[data-studio-category]").first().click();
			await expect(page.locator("[data-vui-slot='sheet']")).toBeVisible();
			await expect(
				page.locator("[data-vui-slot='sheet'] [data-vui-slot='category-rail']"),
			).toBeHidden();
			/* The bar under a sheet is the same bar with one control renamed —
			   nothing else about it may move, or the strip jumps when a sheet
			   opens. Asserted as an inventory because the rename IS the change. */
			await expectControls(bar, underSheet, `${name} action bar under a sheet`);

			/* The bar is USED under the sheet, not merely read.
			   It previously read "Back", sat clear of the scrim, and did nothing: a
			   sheet inerts the workspace behind it and `inert` cannot be escaped
			   from within. The region is a sibling now, exempted from that pass, so
			   the control acts — and the assertion is the resulting state rather
			   than the control's label, because a label was exactly what was right
			   about the broken version. */
			/* `exact`, because the default is a substring match and "Back" is inside
			   "Background music" — one of the very category controls beside it. */
			await bar.getByRole("button", { name: "Back", exact: true }).click();
			await expect(page.locator("[data-vui-slot='sheet']")).toHaveCount(0);
			await expect(modal, "the studio stayed open").toBeVisible();

			/* The ends do not scroll away, with no sheet over them. */
			await bar.locator("[data-studio-category]").last().scrollIntoViewIfNeeded();
			if (pinnedLead) await expect(bar.getByRole("button", { name: pinnedLead })).toBeVisible();
			await expect(bar.locator(".tl2-studiobar-commit")).toBeVisible();
			await modal.locator("[title='Close']").click();
			await expect(modal).toHaveCount(0);
		}
	});
});

/* The band where the editor used to disagree with itself.
 *
 * `usePhoneLayout` answered at 860; each studio declared `(max-width: 700px)` in
 * its own component. Between those two numbers the main editor composed as a
 * phone while the studios composed as desktops, in the same window, and the
 * studios held the same media query twice so a change to either copy would have
 * widened the gap rather than closed it. 780 is the width that proves it: inside
 * the old disagreement, outside neither.
 */
test.describe("the compact band", () => {
	for (const width of [700, 780, 860] as const) {
		test(`the editor and the studios agree at ${width}px`, async ({ page, context }) => {
			await page.setViewportSize({ width, height: 900 });
			await replayApi(context, HAR);
			await openEditor(page);

			/* The editor's own answer, read from the chrome it drives: below the
			   breakpoint the tool rail is a bottom bar. */
			const editorIsCompact = (await page.locator(".tl2-rail.tl2-bottombar").count()) > 0;

			const template = await openTemplateStudio(page);
			const studioIsCompact =
				(await template.locator(".tl2-editor-heading.is-compact").count()) > 0;
			const footers = await template.locator("[data-vui-slot='footer']").count();
			const bars = await page.locator("[data-vui-slot='mobile-actions']").count();

			expect(studioIsCompact, `studio and editor agree at ${width}px`).toBe(editorIsCompact);
			/* And the studio's chrome is internally consistent with its own answer:
			   the compact header comes with the bar and without the footer row. */
			expect(bars > 0, "the bar follows the compact answer").toBe(studioIsCompact);
			expect(footers > 0, "the footer row is the desktop shape").toBe(!studioIsCompact);
			await template.locator("[title='Close']").click();
		});
	}
});

/* Template Studio's follow, on a page that OPENS narrow.
 *
 * Eleven seconds at 68px/s is 748px, which fits every desktop width and only
 * overflows a narrow one — so this is the width at which the assertion can fail.
 * It is a describe rather than a `setViewportSize` inside the test because
 * resizing an already-open editor races its compact re-layout: the studio's own
 * trigger had not re-rendered when the test reached for it, every time.
 */
test.describe("the narrow band", () => {
	test.use({ viewport: { width: 700, height: 900 } });

	test.beforeEach(async ({ page, context }) => {
		await replayApi(context, HAR);
		await openEditor(page);
	});

	test("Template Studio follows the playhead during playback", async ({ page }) => {
		const modal = await openTemplateStudio(page);
		const el = page
			.locator(".tl2-template-editor-modal [data-vui-slot='timeline-scroller']")
			.first();
		await expect(el, "Template Studio: no scroller").toBeVisible();
		await expect
			.poll(async () => el.evaluate((n) => n.scrollWidth - n.clientWidth), {
				message: "Template Studio: nothing to scroll, so following cannot be observed",
				timeout: 4000,
			})
			.toBeGreaterThan(0);

		const before = await el.evaluate((n) => n.scrollLeft);
		await modal.locator(PLAY).first().click();
		/* Measured: this one starts moving 7.96s in. */
		await expect
			.poll(async () => el.evaluate((n) => n.scrollLeft), {
				message: `Template Studio: the view did not follow the playhead (stayed at ${before})`,
				timeout: 20_000,
			})
			.toBeGreaterThan(before);
	});
});
