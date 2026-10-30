/** Run after build-storybook with its static server on :6006. */
import { chromium, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const output = process.env.MALEO_STORY_PROOF_DIR ?? "/tmp/maleo-preview-loading-stories";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
try {
	for (const width of [1440, 320]) {
		for (const theme of ["light", "dark"] as const) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				colorScheme: theme,
				hasTouch: width === 320,
				isMobile: width === 320,
				reducedMotion: "reduce",
			});
			try {
				const page = await context.newPage();
				const errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				await page.goto(
					`http://127.0.0.1:6006/iframe.html?id=patterns-timeline-preview-clip-badge--states&viewMode=story&globals=theme:${theme}`,
				);
				const badges = page.getByRole("img", { name: /preview/i });
				await expect(badges).toHaveCount(10);
				for (const label of [
					"Preview queued",
					"Loading preview 40%",
					"Loading preview",
					"Validating preview",
					"Preview failed: Unsupported video track",
				]) {
					await expect(page.getByRole("img", { name: label, exact: true })).toHaveCount(2);
				}
				for (const badge of await badges.all()) {
					await expect(badge).toBeVisible();
					await expect(badge).toHaveCSS("pointer-events", "none");
				}
				const line = page
					.locator(
						'[data-preview-state="loading"]:not([data-preview-indeterminate]) .tl2-clip-upload-line',
					)
					.first();
				await expect(line).toHaveCSS("transform", "matrix(0.4, 0, 0, 1, 0, 0)");
				// Ready clips render no badge; narrow clips swap the line for the loader icon.
				await expect(page.locator(".tl2-clip.narrow .tl2-clip-upload-line").first()).toBeHidden();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				expect(errors).toEqual([]);
				await page.screenshot({ path: `${output}/preview-${width}-${theme}.png`, fullPage: true });
				console.log(JSON.stringify({ width, theme, badges: 10, errors, output }));
			} finally {
				await context.close();
			}
		}
	}
} finally {
	await browser.close();
}
