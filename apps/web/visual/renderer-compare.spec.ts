/* Compare mode (`?renderer=compare`, OpenSpec p2-render-foundation D8).
 *
 * Without the parameter the editor never requests the renderer module. With it
 * in a browser without WebGPU, the panel says the Rust renderer is not
 * available, nothing else loads, and the Remotion preview seeks as usual. */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

function rendererRequests(page: Page): string[] {
	const seen: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith("/renderer/")) seen.push(path);
	});
	return seen;
}

async function openEditor(page: Page, search = ""): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}${search}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
}

test("the editor without the parameter never requests the renderer", async ({ page, context }) => {
	await replayApi(context, HAR);
	const requests = rendererRequests(page);
	await openEditor(page);
	await expect(page.locator(".tl2-remotion-stage")).toBeVisible();
	await expect(page.getByRole("region", { name: "Rust renderer" })).toHaveCount(0);
	expect(requests).toEqual([]);
});

test("compare mode without WebGPU says so, loads nothing, and the preview still seeks", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	await page.addInitScript(() =>
		Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined }),
	);
	const requests = rendererRequests(page);
	await openEditor(page, "?renderer=compare");
	const panel = page.getByRole("region", { name: "Rust renderer" });
	await expect(panel.getByRole("status")).toHaveText(
		"The Rust renderer is not available in this browser: it needs WebGPU.",
	);
	expect(requests).toEqual([]);

	const timecode = page.locator("[data-transport='timecode']").first();
	const before = await timecode.textContent();
	const ruler = (await page.locator(".tl2-ruler").boundingBox())!;
	await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + ruler.height / 2);
	await expect(timecode).not.toHaveText(before ?? "", { timeout: 3000 });
	await expect(page.locator(".tl2-remotion-stage")).toBeVisible();
});
