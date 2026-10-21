import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.beforeEach(async ({ context }) => replayApi(context, HAR));

for (const width of [320, 1440]) {
	test(`Projects empty workspace at ${width}px`, async ({ page, context }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await context.route("**/api/operations/content/feed**", (route) =>
			route.fulfill({ json: { items: [], total: 0, facets: { platforms: [] } } }),
		);
		await page.goto("/content");
		await expect(page.getByText("default has no projects yet")).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath(`content-empty-${width}.png`) });
	});

	test(`Projects search, filter, loading, error and create at ${width}px`, async ({
		page,
		context,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		await expect(page.locator(".content-row").first()).toBeVisible();
		const search = page.getByRole("searchbox", { name: "Search projects" });
		await expect(search).toBeVisible();
		/* The field's box is the SearchField wrapper; the input inside is bare. */
		await expect
			.poll(() =>
				search.evaluate(
					(el) => getComputedStyle(el.closest('[data-slot="search-field"]')!).minHeight,
				),
			)
			.toBe("40px");
		await page.screenshot({ path: testInfo.outputPath(`content-normal-${width}.png`) });

		let releasePending: (() => void) | undefined;
		let brokenCalls = 0;
		await context.route("**/api/operations/content/feed**", async (route) => {
			const url = new URL(route.request().url());
			const q = url.searchParams.get("search");
			if (!q && !url.searchParams.has("type")) return route.fallback();
			if (q === "pending")
				await new Promise<void>((resolvePending) => {
					releasePending = resolvePending;
				});
			if (q === "broken" && brokenCalls++ === 0)
				return route.fulfill({ status: 503, json: { error: "fixture unavailable" } });
			return route.fulfill({ json: { items: [], total: 0, facets: { platforms: [] } } });
		});
		await search.fill("missing");
		await expect(page.getByText(/Nothing in .* matches/)).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath(`content-filtered-${width}.png`) });
		await search.fill("");
		const filters = page.getByRole("group", { name: "Filter projects by type" });
		await filters.getByRole("button", { name: "Video" }).click();
		await expect(filters.getByRole("button", { name: "Video" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(page.getByText(/Nothing in .* matches/)).toBeVisible();
		await filters.getByRole("button", { name: "All" }).click();
		await expect(page.locator(".content-row").first()).toBeVisible();
		await search.fill("pending");
		await expect(page.getByRole("status").filter({ hasText: "Loading projects" })).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath(`content-loading-${width}.png`) });
		releasePending?.();
		await expect(page.getByText(/Nothing in .* matches/)).toBeVisible();
		await search.fill("broken");
		const alert = page.getByRole("alert");
		await expect(alert).toBeVisible();
		await expect(alert).not.toBeEmpty();
		const alertStyle = await alert.evaluate((el) => {
			const style = getComputedStyle(el);
			const token = document.createElement("div");
			token.style.background = "var(--err-bg)";
			document.body.append(token);
			const expected = getComputedStyle(token).backgroundColor;
			token.remove();
			return { color: style.color, background: style.backgroundColor, expected };
		});
		expect(alertStyle.background).toBe(alertStyle.expected);
		await expect(page.locator(".content-list")).toHaveCount(0);
		await page.screenshot({ path: testInfo.outputPath(`content-error-${width}.png`) });
		await alert.getByRole("button", { name: "Retry" }).click();
		await expect(page.getByText(/Nothing in .* matches/)).toBeVisible();
		await page.getByRole("main").getByRole("button", { name: "New project", exact: true }).click();
		await expect(page).toHaveURL(/\/create\?workspace=default$/);
	});
}
