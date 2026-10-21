import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test("neutral presets, style extraction, and Kokoro settings are reachable", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);

	await page.goto("/library/presets");
	await expect(page.getByText("Example Project Preset", { exact: false })).toBeVisible();

	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator("[data-prompt='input']").fill("/extract");
	await expect(page.getByRole("option", { name: /\/extract-style/ })).toBeVisible();

	await page.goto("/settings/capabilities/tts/kokoro");
	await expect(page.getByText("Kokoro", { exact: false }).first()).toBeVisible();
});

test("stock results expose source, creator, and license links", async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.route("**/api/stock/search**", (route) => {
		const audio = new URL(route.request().url()).searchParams.get("type") === "sfx";
		return route.fulfill({
			json: {
				configured: true,
				items: [
					audio
						? {
								id: "sound-1",
								thumb: "",
								url: "https://assets.example.com/sound.mp3",
								kind: "audio",
								title: "Example sound",
								provider: "Freesound",
								pageUrl: "https://freesound.org/s/1/",
								author: "Example Creator",
								authorUrl: "https://freesound.org/people/example/",
								license: "CC0 1.0",
								licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
							}
						: {
								id: "image-1",
								thumb: "https://assets.example.com/image.jpg",
								url: "https://assets.example.com/image.jpg",
								kind: "image",
								provider: "Pexels",
								pageUrl: "https://www.pexels.com/photo/1/",
								author: "Example Creator",
								authorUrl: "https://www.pexels.com/@example/",
								license: "Pexels License",
								licenseUrl: "https://www.pexels.com/license/",
							},
				],
			},
		});
	});

	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator('.tl2-railbtn[aria-label^="Assets"]').click();
	await page.getByRole("tab", { name: "Stock" }).click();
	await expect(page.getByRole("link", { name: "Pexels", exact: true })).toHaveAttribute(
		"href",
		"https://www.pexels.com/photo/1/",
	);
	await expect(page.getByRole("link", { name: "Example Creator" })).toHaveAttribute(
		"href",
		"https://www.pexels.com/@example/",
	);
	await expect(page.getByRole("link", { name: "Pexels License" })).toHaveAttribute(
		"href",
		"https://www.pexels.com/license/",
	);

	// The add action is revealed by hover, so focus has to reveal it too: it
	// used to stay invisible to a keyboard.
	const add = page.getByRole("button", { name: "Add without placing" });
	const actions = page.locator('[data-slot="frame-actions"]', { has: add });
	await expect(actions).toHaveCSS("opacity", "0");
	await add.focus();
	await expect(actions).toHaveCSS("opacity", "1");

	await page.locator(".fc-stock-tab", { hasText: "SFX" }).click();
	await expect(page.getByRole("link", { name: "Freesound" })).toHaveAttribute(
		"href",
		"https://freesound.org/s/1/",
	);
	await expect(page.getByRole("link", { name: "CC0 1.0" })).toHaveAttribute(
		"href",
		"https://creativecommons.org/publicdomain/zero/1.0/",
	);
});
