/* The foundation board, at both ends of the responsive range, in both themes.
 *
 * Four captures rather than one because that is what the decision needs: the
 * display and title roles are `clamp()` expressions, so a single width shows one
 * arbitrary point on them, and the palette is two palettes.
 *
 * These baselines are expected to move when a foundation is decided — that is
 * the point of them. `web-design-system-convergence` requires a moved capture to
 * be grouped by cause and inspected before refresh; these four are the captures
 * that make a token change visible enough to inspect.
 */
import { expect, test } from "@playwright/test";
import { foundationsHtml } from "./foundations.ts";

const MOUNT = "__foundations__";

/** Phone and desktop. The two ends of `WIDTHS`, which is what the clamps span. */
const WIDTHS = [320, 1440] as const;
const THEMES = ["light", "dark"] as const;

for (const width of WIDTHS) {
	for (const theme of THEMES) {
		test(`foundations @ ${width} ${theme}`, async ({ page }) => {
			await page.goto("/");

			/* Wait for the product's stylesheet, not for the app. The board reads
			 * tokens and component recipes; none of it needs the app to have
			 * finished booting, and waiting on the app makes this fail for reasons
			 * that have nothing to do with foundations. */
			await page.waitForFunction(
				() => {
					const probe = document.createElement("div");
					probe.className = "tw:rounded-md";
					document.body.appendChild(probe);
					const seen = getComputedStyle(probe).borderRadius !== "0px";
					probe.remove();
					return seen;
				},
				undefined,
				{ timeout: 30_000 },
			);

			await page.setViewportSize({ width, height: 900 });

			await page.evaluate(
				({ id, html, dark }) => {
					document.documentElement.classList.toggle("dark", dark);
					/* Mounted over the app rather than replacing it, so nothing the app
					 * does on unmount can pull the stylesheet out from under the shot. */
					const el = document.getElementById(id) ?? document.createElement("div");
					el.id = id;
					el.innerHTML = html;
					document.body.appendChild(el);
				},
				{ id: MOUNT, html: foundationsHtml(), dark: theme === "dark" },
			);

			// Web fonts change metrics; a type-scale capture taken before they load
			// is a picture of the fallback stack.
			await page.evaluate(() => document.fonts.ready);
			await expect(page.locator(`#${MOUNT}`)).toHaveScreenshot(`foundations-${width}-${theme}.png`);
		});
	}
}
