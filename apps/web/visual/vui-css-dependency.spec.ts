/* The three editors' layout no longer depends on @maleo/vui's stylesheet.
 *
 * `@maleo/vui/styles.css` was one `@layer vui { … }` block imported globally.
 * Task 3.5 of `migrate-editor-to-shared-rust-core` moved it into the web app as
 * `components/editor-workspace/editor-workspace.css`, in the `workspace` layer
 * at the same cascade position. Geometry baselines track the accepted layout:
 *
 *   - `vui-css-geometry-*.json`: the box of every published `data-vui-slot`
 *     region. Project geometry is preserved; studio baselines adopt timeline
 *     appearance in `unify-editor-workspace-style`.
 *   - no `vui` layer is left in the page, so nothing depends on one. While the
 *     stylesheet was imported, `vui-css-dependency-*.json` recorded which regions
 *     moved without it; those records retired with the layer.
 *
 * Boxes are rounded to whole pixels, so subpixel layout noise cannot fail it. */
import { expect, test, devices, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

const SLOTS = [
	"workspace",
	"main",
	"preview",
	"preview-stage",
	"preview-frame",
	"transport",
	"timecode",
	"timeline",
	"timeline-toolbar",
	"ruler",
	"markers",
	"timeline-scroller",
	"timeline-grid",
	"rows",
	"row",
	"gutter",
	"gutter-row",
	"item",
	"trim-start",
	"trim-end",
	"playhead",
	"inspector",
	"inspector-rail",
	"inspector-panel",
	"category-rail",
	"accordion-header",
	"mobile-actions",
] as const;

type Box = { x: number; y: number; w: number; h: number } | null;
type Geometry = Record<string, Box>;

const SURFACES = [
	{ name: "editor", root: "body", open: async (_page: Page) => undefined },
	{
		name: "template",
		root: ".tl2-template-editor-modal",
		open: async (page: Page) => {
			await page.keyboard.press("Alt+Digit4");
			await page.locator(".tl2-template-create").click();
		},
	},
	{
		name: "motion",
		root: ".tl2-studio",
		open: async (page: Page) => {
			await page.keyboard.press("Alt+Digit5");
			const section = page
				.locator("section")
				.filter({ has: page.locator(".tl2-elgroup-h", { hasText: "Motion" }) })
				.first();
			await section.getByRole("button", { name: /New motion/ }).click();
		},
	},
] as const;

/* The first visible element of each slot inside the surface, as a rounded box. */
function measure(page: Page, root: string): Promise<Geometry> {
	return page.evaluate(
		({ root, slots }) => {
			const scope = document.querySelector(root);
			const out: Record<string, { x: number; y: number; w: number; h: number } | null> = {};
			for (const slot of slots) {
				const el =
					scope &&
					[...scope.querySelectorAll(`[data-vui-slot='${slot}']`)].find((node) => {
						const r = node.getBoundingClientRect();
						return r.width > 0 || r.height > 0;
					});
				const r = el?.getBoundingClientRect();
				out[slot] = r
					? {
							x: Math.round(r.x),
							y: Math.round(r.y),
							w: Math.round(r.width),
							h: Math.round(r.height),
						}
					: null;
			}
			return out;
		},
		{ root, slots: [...SLOTS] },
	);
}

/* Empty every `@layer vui` block in the page's sheets: the rules @maleo/vui's
 * stylesheet contributed, if any is still loaded. Returns how many it removed. */
function stripVuiLayer(page: Page): Promise<number> {
	return page.evaluate(() => {
		let removed = 0;
		const visit = (rules: CSSRuleList): void => {
			for (const rule of rules) {
				if (rule instanceof CSSLayerBlockRule && rule.name === "vui") {
					removed += rule.cssRules.length;
					while (rule.cssRules.length > 0) rule.deleteRule(0);
				} else if ("cssRules" in rule && (rule as CSSGroupingRule).cssRules) {
					visit((rule as CSSGroupingRule).cssRules);
				}
			}
		};
		for (const sheet of document.styleSheets) {
			try {
				visit(sheet.cssRules);
			} catch {
				/* cross-origin sheet: not ours */
			}
		}
		return removed;
	});
}

const changed = (a: Box, b: Box): boolean =>
	a === null || b === null
		? a !== b
		: Math.abs(a.x - b.x) > 1 ||
			Math.abs(a.y - b.y) > 1 ||
			Math.abs(a.w - b.w) > 1 ||
			Math.abs(a.h - b.h) > 1;

function dependencies(
	before: Geometry,
	after: Geometry,
): Array<{ slot: string; with: Box; without: Box }> {
	return SLOTS.filter((slot) => changed(before[slot] ?? null, after[slot] ?? null)).map((slot) => ({
		slot,
		with: before[slot] ?? null,
		without: after[slot] ?? null,
	}));
}

const phone = (() => {
	const { defaultBrowserType, ...options } = devices["iPhone 15"];
	void defaultBrowserType;
	return { ...options, deviceScaleFactor: 1 };
})();

/* Coarse landscape opens in portrait and then rotates, as the baselines were
 * recorded (task 1.7): Motion Studio could not be opened in landscape then,
 * because the Elements list sat under its sticky toolbar. Task 3.3 fixed that
 * (`mobile-editor.spec.ts` drives it); rotating keeps these measurements
 * comparable with the recorded ones. */
const VIEWPORTS = [
	{ name: "1440", use: { viewport: { width: 1440, height: 900 } }, rotateTo: null },
	{ name: "320", use: { viewport: { width: 320, height: 800 } }, rotateTo: null },
	{
		name: "coarse-landscape",
		use: { ...phone, viewport: { width: 393, height: 852 } },
		rotateTo: { width: 852, height: 393 },
	},
] as const;

for (const viewport of VIEWPORTS) {
	test.describe(viewport.name, () => {
		test.use(viewport.use);
		for (const surface of SURFACES) {
			test(`${surface.name}: geometry and VUI stylesheet dependency`, async ({ page, context }) => {
				await replayApi(context, HAR);
				await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
				await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
				await surface.open(page);
				await page.locator(surface.root).first().waitFor({ state: "visible" });
				if (viewport.rotateTo) await page.setViewportSize(viewport.rotateTo);
				await page
					.locator(surface.root)
					.first()
					.evaluate((node) =>
						Promise.all(node.getAnimations().map((animation) => animation.finished)),
					);
				/* Layout settles over a frame or two after a modal opens. */
				await page.evaluate(
					() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
				);
				const before = await measure(page, surface.root);
				expect(
					Object.values(before).some((box) => box !== null),
					"no published slot rendered",
				).toBe(true);
				expect(`${JSON.stringify(before, null, "\t")}\n`).toMatchSnapshot(
					`vui-css-geometry-${surface.name}-${viewport.name}.json`,
				);
				/* The package stylesheet is gone: no `vui` layer to strip, and nothing
				 * moves when one is stripped. */
				expect(await stripVuiLayer(page), "a `vui` cascade layer is still loaded").toBe(0);
				await page.evaluate(
					() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
				);
				expect(dependencies(before, await measure(page, surface.root))).toEqual([]);
			});
		}
	});
}
