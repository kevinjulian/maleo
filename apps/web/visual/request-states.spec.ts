/* A collection that failed to load says so, and offers the way back.
 *
 * Audit M07. These surfaces used to say "none yet" beside their own error,
 * while still loading, or — for references and voices — instead of an error
 * they had swallowed. Each is forced to fail, then allowed to succeed on retry:
 * the failure is an alert, emptiness is never announced, and the rows come back
 * without a reload. A slow load shows the loading status, not "none yet".
 */
import { expect, test, type Page, type Route } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

const SURFACES = [
	{
		name: "presets",
		path: "/library/presets",
		api: /\/api\/operations\/content-presets(\?|$)/,
		failed: "Could not load presets",
		empty: /No presets yet/,
		row: ".collection-card",
	},
	{
		name: "materials",
		path: "/library/materials",
		api: /\/api\/operations\/content-materials(\?|$)/,
		failed: "Could not load materials",
		empty: /No materials in/,
		row: ".collection-card",
	},
	{
		name: "video templates",
		path: "/library/templates",
		api: /\/api\/operations\/timeline-templates(\?|$)/,
		failed: "Could not load video templates",
		empty: /No video templates yet/,
		row: ".collection-card",
	},
	{
		name: "references",
		path: "/library/references",
		api: /\/api\/operations\/catalogue(\?|$)/,
		failed: "Could not load reference images",
		empty: /No reference images in/,
		row: "[data-slot='media-card']",
	},
	{
		name: "voices",
		path: "/library/voices",
		api: /\/api\/operations\/catalogue(\?|$)/,
		failed: "Could not load voices",
		empty: /No voices/,
		row: ".collection-card",
	},
] as const;

/** Fail GETs to `api` until released; afterwards they fall through to the fixture. */
async function failUntilReleased(page: Page, api: RegExp): Promise<() => void> {
	let failing = true;
	await page.route(api, async (route: Route) => {
		if (failing && route.request().method() === "GET")
			await route.fulfill({ status: 500, json: { error: "forced failure" } });
		else await route.fallback();
	});
	return () => {
		failing = false;
	};
}

for (const surface of SURFACES) {
	test(`${surface.name}: a failed load is an alert with a retry, never "none yet"`, async ({
		page,
		context,
	}) => {
		await replayApi(context, HAR);
		const release = await failUntilReleased(page, surface.api);
		await page.goto(surface.path);

		const failure = page.locator('[data-slot="error-state"]');
		await expect(failure).toBeVisible();
		await expect(failure).toHaveAttribute("role", "alert");
		await expect(failure).toContainText(surface.failed);
		await expect(page.locator('[data-slot="empty-state"]')).toHaveCount(0);
		await expect(page.getByText(surface.empty)).toHaveCount(0);

		release();
		await failure.getByRole("button", { name: "Try again" }).click();
		await expect(page.locator(surface.row).first()).toBeVisible();
		await expect(failure).toHaveCount(0);
	});
}

test("a slow load shows the loading status, not an empty library", async ({ page, context }) => {
	await replayApi(context, HAR);
	let finish: (() => void) | undefined;
	const held = new Promise<void>((done) => {
		finish = done;
	});
	await page.route(/\/api\/operations\/timeline-templates(\?|$)/, async (route) => {
		if (route.request().method() === "GET") await held;
		await route.fallback();
	});
	await page.goto("/library/templates");
	const loading = page.locator('[data-slot="loading-state"]');
	await expect(loading).toBeVisible();
	await expect(loading).toHaveAttribute("role", "status");
	await expect(page.getByText(/No video templates yet/)).toHaveCount(0);
	finish?.();
	await expect(page.locator(".collection-card").first()).toBeVisible();
	await expect(loading).toHaveCount(0);
});
