import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_MEDIA_IMPORT_LIMITS } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const) {
		test(`tool headers and asset sources at ${width}px ${theme}`, async ({ browser }, testInfo) => {
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, HAR);
				let available = false;
				await context.route(/\/media\/import\/readiness(\?|$)/, (route) =>
					route.fulfill({
						json: {
							available,
							reason: available ? undefined : "Storage offline",
							limits: DEFAULT_MEDIA_IMPORT_LIMITS,
						},
					}),
				);
				await context.route("**/media/import?*", (route) =>
					route.fulfill({ json: { items: [], nextCursor: null } }),
				);
				const page = await context.newPage();
				await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const tools = page.getByRole("navigation", { name: "Editor tools" });
				const heading = page.getByRole("heading", { name: "Assets", exact: true });
				if (!(await heading.isVisible()))
					await tools.getByRole("button", { name: /^Assets/ }).click();
				await expect(heading).toBeVisible();
				const header = heading.locator("..").locator("..");
				await expect(header).toHaveAttribute("data-density", "tool");
				const close = header.getByRole("button", { name: "Hide panel", exact: true });
				await expect(close).toBeVisible();
				if (width === 1440) {
					await expect(heading).toHaveCSS("font-size", "13px");
					await expect(heading).toHaveCSS("font-weight", "400");
					expect((await header.boundingBox())!.height).toBe(44);
				} else {
					await expect(heading).toHaveCSS("font-weight", "600");
					const hit = (await close.boundingBox())!;
					expect(hit.width).toBeGreaterThanOrEqual(44);
					expect(hit.height).toBeGreaterThanOrEqual(44);
				}
				const sources = page.getByRole("tablist", { name: "Asset source" });
				await expect(sources.getByRole("tab")).toHaveText(["Media", "References", "Stock"]);
				const search = page.getByRole("searchbox", { name: "Search media", exact: true });
				const importer = page.getByRole("button", { name: "Import files", exact: true });
				await expect(search).toBeVisible();
				await expect(importer).toBeDisabled();
				await expect(page.getByText("File import unavailable", { exact: true })).toBeVisible();
				await expect(
					page.getByRole("alert").filter({ hasText: "File import unavailable" }),
				).toContainText("Storage offline");
				available = true;
				await page.getByRole("button", { name: "Try again", exact: true }).click();
				await expect(importer).toBeEnabled();
				const order = await search.evaluate((element) => {
					const create = document.querySelector('[aria-label="Media filters and view"]');
					return Boolean(
						create && element.compareDocumentPosition(create) & Node.DOCUMENT_POSITION_FOLLOWING,
					);
				});
				expect(order).toBe(true);
				await expect(page.locator(".fc-quickcreate")).toHaveCount(0);
				await search.fill("missing-source");
				await expect(search).toHaveValue("missing-source");
				await page.getByRole("button", { name: "Clear search", exact: true }).click();
				await expect(search).toHaveValue("");
				await expect(search).toBeFocused();
				const chooser = page.waitForEvent("filechooser");
				await importer.click();
				expect((await chooser).isMultiple()).toBe(true);
				await sources.getByRole("tab", { name: "References", exact: true }).click();
				await expect(
					page.getByRole("searchbox", { name: "Search references", exact: true }),
				).toBeVisible();
				await expect(
					page.getByText(
						"Workspace library. Select references to guide this project; drag images to place them on the timeline.",
						{ exact: true },
					),
				).toBeVisible();
				await sources.getByRole("tab", { name: "Stock", exact: true }).click();
				await expect(page.getByRole("searchbox", { name: /^Search/ })).toBeVisible();
				await sources.getByRole("tab", { name: "Media", exact: true }).click();
				await page.screenshot({ path: testInfo.outputPath("assets.png") });
				await close.focus();
				await close.press("Enter");
				await expect(heading).not.toBeVisible();
				await tools.getByRole("button", { name: /^Captions/ }).click();
				await expect(page.getByRole("heading", { name: "Captions", exact: true })).toBeVisible();
			} finally {
				await context.close();
			}
		});
	}
