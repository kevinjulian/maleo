import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
test.beforeEach(async ({ context }) => replayApi(context, HAR));

for (const width of [320, 1440]) {
	test(`create picker and setup preserve selection, busy and failure at ${width}px`, async ({
		page,
		context,
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await page.emulateMedia({ reducedMotion: "reduce" });
		await page.goto("/create");
		const video = page.locator(".cv-typecard").filter({ hasText: "Video" });
		await expect(video).toBeVisible();
		// Image and text are retired: video is the only type a new project can be.
		await expect(page.locator(".cv-typecard")).toHaveCount(1);
		await video.focus();
		await expect
			.poll(() => video.evaluate((el) => parseFloat(getComputedStyle(el).outlineWidth)))
			.toBeGreaterThanOrEqual(2);
		await page.screenshot({ path: testInfo.outputPath(`create-picker-${width}.png`) });
		await video.click();
		const title = page.getByRole("textbox", { name: "Project title" });
		const create = page.getByRole("button", { name: "Create video project" });
		await expect(create).toBeDisabled();
		await expect(create).toHaveAttribute("data-slot", "button");
		await title.fill("Sample video");
		const format = page.getByRole("group", { name: "Video format" });
		await format.getByRole("button", { name: "Landscape" }).click();
		await expect(format.getByRole("button", { name: "Landscape" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await page.screenshot({ path: testInfo.outputPath(`create-setup-${width}.png`) });

		let release: (() => void) | undefined;
		let requests = 0;
		await context.route("**/api/operations/projects**", async (route) => {
			if (route.request().method() !== "POST") return route.fallback();
			requests++;
			await new Promise<void>((done) => {
				release = done;
			});
			return route.fulfill({ status: 503, json: { error: "fixture unavailable" } });
		});
		await create.click();
		await expect(page.getByRole("button", { name: "Creating…" })).toBeDisabled();
		await page.screenshot({ path: testInfo.outputPath(`create-busy-${width}.png`) });
		release?.();
		const alert = page.getByRole("alert");
		await expect(alert).toHaveText("Could not create project. Please try again.");
		const alertBox = await alert.boundingBox();
		expect(alertBox).not.toBeNull();
		expect(alertBox!.y + alertBox!.height).toBeLessThanOrEqual(900);
		expect(requests).toBe(1);
		await expect(create).toBeEnabled();
		await page.screenshot({ path: testInfo.outputPath(`create-error-${width}.png`) });
	});
}
