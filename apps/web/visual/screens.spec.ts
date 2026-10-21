/* One screenshot per screen per breakpoint, compared against a committed
 * baseline.
 *
 * What this asserts is narrow on purpose: that a change did not alter what a
 * screen looks like. It is not a place to assert behaviour — the suites under
 * src/ do that, and a screenshot that encodes behaviour becomes a test nobody
 * can read the failure of.
 *
 * When a diff is intentional, regenerate with `bun run visual:update` and
 * review the image change as part of the diff.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SCREENS, WIDTHS } from "./screens.ts";
import { replayApi } from "./har.ts";
import { mockAdmin } from "./admin-fixture.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_HAR = "fixtures/api.har";

// The clock the app renders against. Fixed so "2 days ago" and "refresh now"
// are part of the baseline rather than a reason it rots.
const FROZEN_NOW = new Date("2026-08-04T09:00:00Z").getTime();

const STOCK_SETTINGS = {
	"settings-stock-visuals": {
		capability: {
			id: "stock-visuals",
			label: "Stock visuals",
			description: "Find licensed stock images and video.",
			provider: "pexels",
			providerLabel: "Pexels",
		},
		key: "PEXELS_API_KEY",
	},
	"settings-sound-effects": {
		capability: {
			id: "sound-effects",
			label: "Sound effects",
			description: "Find licensed sound effects.",
			provider: "freesound",
			providerLabel: "Freesound",
		},
		key: "FREESOUND_API_KEY",
	},
} as const;

/* Which fixture this test replays. `test.info().title` carries the screen name,
 * which is what lets a per-screen fixture be chosen in `beforeEach` rather than
 * threading the replay through every test body. */
function harForTitle(title: string): string {
	const name = title.split(" @ ")[0];
	return resolve(HERE, SCREENS.find((screen) => screen.name === name)?.har ?? DEFAULT_HAR);
}

test.beforeEach(async ({ page, context }, testInfo) => {
	// Replay recorded api responses; never reach a live service.
	await replayApi(context, harForTitle(testInfo.title));
	await mockAdmin(page);

	await page.addInitScript(`{
		const FROZEN = ${FROZEN_NOW};
		const RealDate = Date;
		// Freeze the clock before any app code runs, so relative timestamps and
		// countdowns render the same value on every run.
		class FrozenDate extends RealDate {
			constructor(...args) { super(...(args.length ? args : [FROZEN])); }
			static now() { return FROZEN; }
		}
		globalThis.Date = FrozenDate;
		// Motion is disabled by the config's animation handling; this also stops
		// components that branch on the preference from rendering the other way.
		const mq = globalThis.matchMedia;
		globalThis.matchMedia = (q) => q.includes("prefers-reduced-motion")
			? { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false }
			: mq(q);
	}`);
});

/* The editor and Library in dark, at desktop width. Light is the default theme
 * and was the only one captured for these screens, so a token that resolves
 * wrongly in dark (a literal that stayed light, an ink on its own colour) had
 * nothing to fail. One width: dark changes colour, not layout. */
const DARK = new Set([
	"content-list",
	"library-references",
	"library-materials",
	"library-elements",
	"editor-timeline",
	"editor-storyboard",
	"editor-studio",
	"editor-clip-data",
	"editor-data-style",
]);
const CAPTURES = SCREENS.flatMap((screen) => [
	...(screen.widths ?? WIDTHS).map((width) => ({ screen, width, dark: false })),
	...(DARK.has(screen.name) ? [{ screen, width: 1440, dark: true }] : []),
]);

{
	for (const { screen, width, dark } of CAPTURES) {
		test(`${screen.name} @ ${width}${dark ? " dark" : ""}`, async ({ page }) => {
			if (dark) await page.addInitScript(() => localStorage.setItem("theme", "dark"));
			const stock = STOCK_SETTINGS[screen.name as keyof typeof STOCK_SETTINGS];
			if (stock) {
				const { capability, key } = stock;
				await page.route("**/api/settings/global**", (route) =>
					route.fulfill({ json: { items: [] } }),
				);
				await page.route("**/api/capabilities**", (route) =>
					route.fulfill({
						json: {
							capabilities: [
								{
									id: capability.id,
									label: capability.label,
									description: capability.description,
									state: "not_configured",
									activeProviderId: capability.provider,
									providers: [
										{
											id: capability.provider,
											label: capability.providerLabel,
											state: "unconfigured",
											active: true,
										},
									],
								},
							],
						},
					}),
				);
				await page.route(`**/api/providers/${capability.provider}/config**`, (route) =>
					route.fulfill({
						json: {
							provider: capability.provider,
							label: capability.providerLabel,
							fields: [
								{
									key,
									label: "API key",
									kind: "secret",
									required: true,
									set: false,
									source: "unset",
									shadowed: false,
									value_masked: null,
								},
							],
						},
					}),
				);
			}
			await page.setViewportSize({ width, height: 900 });
			await page.goto(screen.path);
			/* Navigation steps, in order. Each waits for its own target rather than
			 * firing blind: a rail button that is not there yet would otherwise fail
			 * as a click timeout with no indication which step of which screen. */
			for (const step of [screen.click ?? []].flat()) {
				const target = page.locator(step).first();
				await target.waitFor({ state: "visible", timeout: 30_000 });
				await target.click();
			}
			await page.locator(screen.ready).first().waitFor({ state: "visible", timeout: 60_000 });
			// Web fonts change metrics; a screenshot taken before they load is a
			// different screen from the one users see.
			await page.evaluate(() => document.fonts.ready);
			/* A failed-save banner is a harness fault, not a screen. Fail here
			 * rather than let `--update-snapshots` bake it into a baseline. */
			await expect(page.getByText("Auto-save failed")).toHaveCount(0);
			if (screen.name === "video") {
				await expect(
					page.getByRole("list", { name: "Project export attempts" }).getByRole("listitem"),
				).toHaveCount(3);
				await expect(page.getByText("Could not update exports", { exact: true })).toHaveCount(0);
			}
			await expect(page).toHaveScreenshot(`${screen.name}-${width}${dark ? "-dark" : ""}.png`, {
				fullPage: true,
			});
		});
	}
}
