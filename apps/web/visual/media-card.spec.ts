/* MediaCard in the surfaces that use it, with real items.
 *
 * The fixture workspace has no generated images and no project media, so the
 * screen baselines show these surfaces empty and cannot see a card at all. */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
// A 1x1 PNG, so "loads" and "fails to load" are both under the test's control.
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
	"base64",
);

test.beforeEach(async ({ context }) => {
	await replayApi(context, HAR);
});

test("image gallery: one activation per card, selection is announced, a broken image says so", async ({
	page,
}) => {
	await page.route("**/media-fixture/ok-*.png", (route) =>
		route.fulfill({ contentType: "image/png", body: PIXEL }),
	);
	await page.route("**/media-fixture/gone.png", (route) =>
		route.fulfill({ status: 404, body: "" }),
	);
	await page.route(/\/api\/image-gen\/images\/facets/, (route) =>
		route.fulfill({ json: { projects: [], sources: [] } }),
	);
	await page.route(/\/api\/image-gen\/images(\?|$)/, (route) =>
		route.fulfill({
			json: {
				items: [
					{
						id: "a",
						asset_url: "/media-fixture/ok-a.png",
						prompt: "A lighthouse",
						workspace: "default",
						project_id: "p1",
						project_title: "Tides explainer",
						starred: true,
						created_at: "2026-01-01T00:00:00Z",
					},
					{
						id: "b",
						asset_url: "/media-fixture/ok-b.png",
						prompt: "A harbour",
						workspace: "default",
						project_id: null,
						project_title: null,
						starred: false,
						created_at: "2026-01-01T00:00:00Z",
					},
					{
						id: "c",
						asset_url: "/media-fixture/gone.png",
						prompt: "Lost",
						workspace: "default",
						project_id: null,
						project_title: null,
						starred: false,
						created_at: "2026-01-01T00:00:00Z",
					},
				],
			},
		}),
	);
	await page.goto("/images");
	const grid = page.getByRole("list", { name: "Generated images" });
	const cards = grid.locator("[data-slot='media-card']");
	await expect(cards).toHaveCount(3);
	// No interactive control nested inside the card's button.
	expect(await grid.locator("button button, button a").count()).toBe(0);

	const first = page.getByRole("button", { name: "Image, Tides explainer" });
	await expect(first).toHaveAttribute("aria-pressed", "false");
	await first.focus();
	await page.keyboard.press("Enter");
	await expect(first).toHaveAttribute("aria-pressed", "true");
	await expect(cards.nth(0)).toHaveAttribute("data-selected", "true");

	await expect(cards.nth(2)).toContainText("Image unavailable");
	await expect(cards, "a failed preview does not remove the item").toHaveCount(3);
});

test("stock results: the add action sits beside the card, not inside an activation", async ({
	page,
}) => {
	await page.route("**/api/stock/search**", (route) =>
		route.fulfill({
			json: {
				configured: true,
				items: [
					{
						id: "v1",
						thumb: "",
						url: "https://assets.example.com/v.mp4",
						kind: "video",
						dur: 12,
						provider: "Pexels",
						author: "A",
						pageUrl: "https://www.pexels.com/video/1/",
					},
					{
						id: "i1",
						thumb: "",
						url: "https://assets.example.com/i.jpg",
						kind: "image",
						provider: "Pexels",
						author: "B",
						pageUrl: "https://www.pexels.com/photo/1/",
					},
				],
			},
		}),
	);
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator('.tl2-railbtn[aria-label^="Assets"]').click();
	await page.getByRole("tab", { name: "Stock" }).click();
	const grid = page.getByRole("list", { name: "Stock results" });
	await expect(grid.locator("[data-slot='media-card']")).toHaveCount(2);
	await expect(grid.locator("[data-slot='media-card']").first()).toHaveAttribute(
		"draggable",
		"true",
	);
	expect(await grid.locator("button button, button a").count()).toBe(0);
	await expect(grid.getByRole("button", { name: "Add without placing" })).toHaveCount(2);
	await expect(grid.locator("[data-slot='frame-badge']")).toHaveText("0:12");
});
