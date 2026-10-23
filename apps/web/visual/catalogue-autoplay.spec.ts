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
									kind: "text",
									label: "Saved countdown",
									intent: "Countdown",
									category: "text",
									base: "rve-countdown-intro",
									config: { seconds: 3 },
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
				const preview = (label: string) =>
					surface === "tools"
						? page
								.getByRole("button", { name: `Add ${label}`, exact: true })
								.locator(".tl2-element-preview")
						: page
								.locator(".catalog-el-tile")
								.filter({ has: page.getByText(label, { exact: true }) })
								.locator(".fc-data-preview");
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
				const motion = preview("Countdown Intro");
				if (surface === "library")
					await page
						.locator(".catalog-el-tile")
						.filter({ has: page.getByText("Countdown Intro", { exact: true }) })
						.scrollIntoViewIfNeeded();
				await motion.scrollIntoViewIfNeeded();
				await expectPlayback(motion);
				if (surface === "library") await category("Custom Elements");
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
				if (surface === "library") {
					await category("Motion");
					await page
						.locator(".catalog-el-tile")
						.filter({ has: page.getByText("Countdown Intro", { exact: true }) })
						.scrollIntoViewIfNeeded();
				}
				await motion.scrollIntoViewIfNeeded();
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
