import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { replayApi } from "./har.ts";
import { chooseOption } from "./options.ts";

const HAR = resolve(import.meta.dirname, "fixtures/api.har");
const project = {
	id: "fixture-project",
	title: "Fixture project with a deliberately long title for narrow filters",
};
const image = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="navy"/></svg>')}`;

for (const width of [1440, 320])
	for (const theme of ["light", "dark"])
		for (const kind of ["images", "speech"] as const) {
			test(`${kind} collection controls ${width} ${theme}`, async ({ browser }, info) => {
				const context = await browser.newContext({
					baseURL: "http://127.0.0.1:3031",
					viewport: { width, height: 900 },
					hasTouch: width === 320,
					isMobile: width === 320,
				});
				try {
					await replayApi(context, HAR);
					await context.addInitScript((value) => localStorage.setItem("theme", value), theme);
					const family = kind === "images" ? "/api/image-gen/images" : "/api/tts/clips";
					const item = {
						id: "fixture-artifact",
						workspace: "default",
						project_id: project.id,
						project_title: project.title,
						prompt: "Fixture artifact",
						source: "lab",
						asset_url: kind === "images" ? image : null,
						duration_sec: 3,
						voice: "Fixture voice",
						provider: "fixture",
						starred: 0,
						created_at: 1_700_000_000_000,
					};
					await context.route(`**${family}**`, (route) =>
						route.fulfill({
							json: new URL(route.request().url()).pathname.endsWith("/facets")
								? { projects: [project], sources: ["lab"] }
								: { items: [item] },
						}),
					);
					const page = await context.newPage();
					await page.goto(`/${kind}`);
					await expect(
						kind === "images"
							? page.getByRole("list", { name: "Generated images" }).getByRole("listitem")
							: page.getByText("Fixture artifact", { exact: true }),
					).toBeVisible();
					const toolbar = page.getByRole("group", {
						name: kind === "images" ? "Search and filter images" : "Search and filter clips",
					});
					const search = toolbar.getByRole("searchbox");
					const filter = toolbar.getByRole("combobox");
					if (width === 1440) {
						const a = await toolbar.locator('[data-slot="search-field"]').boundingBox(),
							b = await filter.boundingBox();
						expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
					}
					await filter.focus();
					await page.keyboard.press("Enter");
					await expect(page.locator('[data-slot="select-list"]:visible')).toBeVisible();
					await page.keyboard.press("Escape");
					await expect(filter).toBeFocused();
					await chooseOption(filter, project.id);
					await expect(page).toHaveURL(/project=fixture-project/);
					await search.fill("Fixture");
					await expect(page).toHaveURL(/q=Fixture/);
					await page.keyboard.press("Escape");
					await expect(search).toHaveValue("");
					for (const control of [toolbar.locator('[data-slot="search-field"]'), filter]) {
						const box = await control.boundingBox();
						expect(box!.x).toBeGreaterThanOrEqual(0);
						expect(box!.x + box!.width).toBeLessThanOrEqual(width);
						if (width === 320) expect(box!.height).toBeGreaterThanOrEqual(44);
					}
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
					).toBe(true);
					await page.screenshot({
						path: info.outputPath(`${kind}-${width}-${theme}.png`),
						fullPage: true,
						animations: "disabled",
					});
				} finally {
					await context.close();
				}
			});
		}
