import { chromium, expect } from "@playwright/test";
import { join } from "node:path";

const root = join(import.meta.dir, "../storybook-static");
const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: (request) => {
		const path = new URL(request.url).pathname;
		return new Response(Bun.file(join(root, path === "/" ? "index.html" : path)));
	},
});
const browser = await chromium.launch();
try {
	for (const width of [1440, 320])
		for (const theme of ["light", "dark"] as const) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
				colorScheme: theme,
			});
			try {
				const page = await context.newPage();
				await page.goto(
					`${server.url}iframe.html?id=patterns-inspector-inspectorsection--project-settings&viewMode=story&globals=theme:${theme}`,
				);
				await expect(page.getByRole("combobox", { name: "Aspect ratio" })).toBeVisible();
				const audio = page.getByRole("button", { name: "Audio", exact: true });
				await expect(audio).toHaveAttribute("aria-expanded", "true");
				await audio.focus();
				await audio.press("Enter");
				await expect(audio).toHaveAttribute("aria-expanded", "false");
				await expect(audio).toBeFocused();
				await audio.press("Enter");
				await page.getByRole("combobox", { name: "Voice", exact: true }).selectOption("Bright");
				await expect(page.getByRole("combobox", { name: "Voice", exact: true })).toHaveValue(
					"Bright",
				);
				const action = (await page
					.getByRole("button", { name: "Voice default actions" })
					.boundingBox())!;
				expect(action.x + action.width).toBeLessThanOrEqual(width);
				if (width === 320) expect(action.height).toBeGreaterThanOrEqual(44);
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				await page.screenshot({ path: `/tmp/maleo-project-settings-story-${width}-${theme}.png` });
				console.log(
					JSON.stringify({ width, theme, disclosure: true, labels: true, compoundControls: true }),
				);
			} finally {
				await context.close();
			}
		}
} finally {
	await browser.close();
	void server.stop();
}
