import { chromium, expect } from "@playwright/test";
import { join } from "node:path";

// Run after build-storybook. Static, synthetic fixtures; no app/API/provider access.
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
		for (const theme of ["light", "dark"]) {
			const context = await browser.newContext({
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
				colorScheme: theme === "dark" ? "dark" : "light",
			});
			try {
				const page = await context.newPage();
				await page.goto(
					`${server.url}iframe.html?id=features-timeline-clipcompositing--controls&viewMode=story&globals=theme:${theme}`,
				);
				const shape = page.getByRole("combobox", { name: "Mask shape" });
				await expect(shape).toHaveValue("none");
				await shape.selectOption("ellipse");
				const feather = page.getByRole("spinbutton", { name: "Mask feather" });
				await feather.fill("12");
				await feather.press("Tab");
				await expect(feather).toHaveValue("12");
				const brightness = page.getByRole("spinbutton", { name: "brightness", exact: true });
				await brightness.fill("50");
				await brightness.press("Tab");
				await page.getByRole("button", { name: "Reset color adjustment", exact: true }).click();
				await expect(brightness).toHaveValue("100");
				await shape.focus();
				await expect(shape).toBeFocused();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				await page.screenshot({
					path: `/tmp/maleo-compositing-story-${width}-${theme}.png`,
					fullPage: true,
				});
				await page.goto(
					`${server.url}iframe.html?id=features-timeline-clipcompositing--locked&viewMode=story&globals=theme:${theme}`,
				);
				await expect(page.getByRole("combobox", { name: "Mask shape" })).toBeDisabled();
				await expect(
					page.getByRole("spinbutton", { name: "brightness", exact: true }),
				).toBeDisabled();
				console.log(
					JSON.stringify({
						width,
						theme,
						controls: true,
						locked: true,
						focus: true,
						overflow: false,
					}),
				);
			} finally {
				await context.close();
			}
		}
} finally {
	await browser.close();
	void server.stop(true);
}
