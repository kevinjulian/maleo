import { chooseOption } from "./options.ts";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const THUMB = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90"><rect width="160" height="90" fill="#595df0"/><circle cx="80" cy="45" r="25" fill="#49ddcc"/></svg>')}`;

for (const width of [320, 1440])
	for (const theme of ["light", "dark"]) {
		test.describe(`Projects ${width} ${theme}`, () => {
			test.use({
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
			});
			test("list/grid retain metadata, sort resets page, failed previews stay openable", async ({
				page,
				context,
			}, testInfo) => {
				await replayApi(context, HAR);
				await page.addInitScript((value) => localStorage.setItem("theme", value), theme);
				const requests: Array<{ sort: string; offset: number }> = [];
				await context.route("**/api/operations/content/feed**", (route) => {
					const params = new URL(route.request().url()).searchParams;
					const sort = params.get("sort") ?? "modified";
					const offset = Number(params.get("offset") ?? 0);
					requests.push({ sort, offset });
					const rows = Array.from({ length: 24 }, (_, i) => ({
						id: i === 0 ? FIXTURE_PROJECT_ID : `fixture-${i}`,
						title: i === 0 ? "Alpha video" : `Project ${String(i).padStart(2, "0")}`,
						type: i === 2 ? "image" : i === 3 ? "text" : "video",
						created_at: 1_700_000_000_000,
						updated_at: 1_700_000_000_000 + i * 1000,
						thumbnail_url: i === 0 ? THUMB : i === 1 ? "/api/fixture-missing-preview" : null,
						duration_sec: i === 0 ? 84 : null,
					}));
					if (sort === "modified" || sort === "name-desc") rows.reverse();
					const matching = params.get("search")
						? rows.filter((row) =>
								row.title.toLowerCase().includes(params.get("search")!.toLowerCase()),
							)
						: rows;
					return route.fulfill({
						json: { items: matching.slice(offset, offset + 20), total: matching.length },
					});
				});
				await context.route("**/api/fixture-missing-preview", (route) =>
					route.fulfill({ status: 404, body: "" }),
				);
				await page.goto("/content");
				const collection = page.getByRole("list", { name: "Projects", exact: true });
				await expect(collection).toHaveAttribute("data-layout", "list");
				await page.getByRole("button", { name: "Next", exact: true }).click();
				await expect(page.getByText("Page 2 of 2")).toBeVisible();
				await chooseOption(page.getByRole("combobox", { name: "Sort projects" }), "name");
				await expect(page.getByText("Page 1 of 2")).toBeVisible();
				await expect.poll(() => requests.at(-1)).toEqual({ sort: "name", offset: 0 });
				const alpha = collection.getByRole("button", { name: "Alpha video", exact: true });
				await expect(alpha).toContainText("1:24");
				await expect(alpha).toContainText("edited");
				await expect(alpha).toContainText("created");
				await expect(alpha.locator("img")).toBeVisible();
				await expect(collection.getByText("Preview unavailable")).toBeVisible();
				await expect(collection.getByText("Duration unknown").first()).toBeVisible();
				const calls = requests.length;
				await page.screenshot({ path: testInfo.outputPath("projects-list.png"), fullPage: true });
				await page.getByRole("button", { name: "Grid", exact: true }).click();
				await expect(collection).toHaveAttribute("data-layout", "grid");
				await expect(alpha).toContainText("1:24");
				expect(requests.length).toBe(calls);
				expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
					width,
				);
				await page.screenshot({ path: testInfo.outputPath("projects-grid.png"), fullPage: true });
				for (const sort of ["name-desc", "modified-asc", "modified", "name"]) {
					await chooseOption(page.getByRole("combobox", { name: "Sort projects" }), sort);
					await expect.poll(() => requests.at(-1)?.sort).toBe(sort);
				}
				const search = page.getByRole("searchbox", { name: "Search projects" });
				await search.fill("Alpha");
				await expect(collection.getByRole("listitem")).toHaveCount(1);
				await page.getByRole("button", { name: "List", exact: true }).click();
				await expect(search).toHaveValue("Alpha");
				await expect(page.getByRole("combobox", { name: "Sort projects" })).toHaveAttribute(
					"data-value",
					"name",
				);
				if (width === 320) await alpha.tap();
				else {
					await alpha.focus();
					await page.keyboard.press("Enter");
				}
				await expect(page).toHaveURL(new RegExp(`/content/${FIXTURE_PROJECT_ID}`));
				await expect(page.locator(".tl2")).toBeVisible();
			});
		});
	}
