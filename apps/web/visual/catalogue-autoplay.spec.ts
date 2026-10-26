import { expect, test, type Locator } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID } from "./fixtures/editor-chat-data.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

async function expectPlayback(preview: Locator) {
	await expect(preview).toBeVisible();
	await preview.scrollIntoViewIfNeeded();
	const first = await preview.screenshot();
	await expect
		.poll(async () => !first.equals(await preview.screenshot()), {
			timeout: 6500,
			intervals: [200, 400, 800],
		})
		.toBe(true);
}

for (const width of [1440, 320])
	for (const surface of ["tools", "library"] as const)
		test(`catalogue autoplay and reduced motion in ${surface} at ${width}px`, async ({
			browser,
		}) => {
			test.setTimeout(60_000);
			const phone = width === 320;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: phone ? 740 : 900 },
				hasTouch: phone,
				isMobile: phone,
				reducedMotion: "no-preference",
			});
			try {
				await replayApi(
					context,
					resolve(HERE, surface === "tools" ? "fixtures/api-editor-chat.har" : "fixtures/api.har"),
				);
				await context.route(/\/api\/operations\/clip-templates(\?|$)/, (route) =>
					route.fulfill({
						json: {
							items: [
								{
									id: "saved-countdown",
									kind: "composition",
									label: "Saved countdown",
									intent: "Countdown",
									category: "motion",
									base: "composition",
									config: {
										schemaVersion: 1,
										spanSec: 3,
										overlays: [
											{
												preset: "shape-star",
												content: "",
												relStart: 0,
												dur: 3,
												params: { fill: "#ff3b64" },
												layout: { xPct: 30, yPct: 25, widthPct: 40, heightPct: 50, fit: "contain" },
												anim: {
													tracks: {
														rotate: [
															{ t: 0, v: 0 },
															{ t: 1, v: 180 },
														],
													},
												},
											},
										],
									},
								},
							],
						},
					}),
				);
				const page = await context.newPage(),
					errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				page.setDefaultTimeout(10_000);
				const category = async (name: string) => {
					if (surface === "tools")
						await page
							.getByRole("tablist", { name: "Element category", exact: true })
							.getByRole("tab", { name, exact: true })
							.click();
					else
						await page
							.getByRole("group", { name: "Filter by element family", exact: true })
							.getByRole("button", { name, exact: true })
							.click();
				};
				if (surface === "tools") {
					await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					if (phone)
						await page
							.getByRole("navigation", { name: "Editor tools", exact: true })
							.getByRole("button", { name: "Elements", exact: true })
							.tap();
					else await page.keyboard.press("Alt+Digit5");
				} else await page.goto("/library/elements");
				await page.evaluate(() => document.fonts.ready);
				await category("Motion");
				const saved =
					surface === "tools"
						? page
								.getByRole("button", { name: "Add Saved countdown", exact: true })
								.locator(".tl2-element-preview")
						: page
								.locator(".fc-template-tile")
								.filter({ has: page.getByText("Saved countdown", { exact: true }) })
								.locator(".fc-data-preview");
				if (surface === "library")
					await page
						.locator(".fc-template-tile")
						.filter({ has: page.getByText("Saved countdown", { exact: true }) })
						.scrollIntoViewIfNeeded();
				await expectPlayback(saved);
				const motion = saved;
				// A live preference change remounts at an arrived frame, rather than pausing mid-reveal.
				await page.emulateMedia({ reducedMotion: "reduce" });
				await page.waitForTimeout(300);
				const still = await motion.screenshot();
				await page.waitForTimeout(4200);
				expect((await motion.screenshot()).equals(still)).toBe(true);
				expect(errors).toEqual([]);
			} finally {
				await context.close();
			}
		});
