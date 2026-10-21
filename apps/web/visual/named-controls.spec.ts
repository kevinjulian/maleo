/* Controls that had no name, or a placeholder for one (audit M06, M12). */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test.beforeEach(async ({ context }) => replayApi(context, HAR));

test("the image composer's prompt, send and popover controls are named, and Escape keeps the draft", async ({
	page,
}) => {
	await page.goto("/imagelab");
	const prompt = page.getByRole("textbox", { name: "Image prompt" });
	await expect(prompt).toBeVisible();
	await expect(page.getByRole("button", { name: "Generate image" })).toBeVisible();

	await expect(prompt).toBeEnabled();
	await prompt.fill("a quiet harbour at dawn");
	const refs = page.getByRole("button", { name: /Refs|refs/ });
	await refs.click();
	await expect(refs).toHaveAttribute("aria-expanded", "true");
	await expect(page.getByRole("button", { name: "Close references" })).toBeVisible();
	await page.keyboard.press("Escape");
	await expect(refs).toHaveAttribute("aria-expanded", "false");
	await expect(prompt).toBeFocused();
	await expect(prompt).toHaveValue("a quiet harbour at dawn");

	const ratio = page.getByRole("combobox", { name: /^Aspect ratio/ });
	await ratio.click();
	await expect(ratio).toHaveAttribute("aria-expanded", "true");
	await page.keyboard.press("Escape");
	await expect(ratio).toHaveAttribute("aria-expanded", "false");
});

test("the create form's description is named by its visible label", async ({ page }) => {
	await page.goto("/create");
	await page.locator(".cv-type-grid").waitFor();
	await page.locator(".cv-type-grid button").first().click();
	await page.locator(".cv-setup").waitFor();
	const description = page.getByRole("textbox", { name: "Description" });
	await expect(description).toBeVisible();
	await description.fill("Internal note");
	await expect(description).toHaveValue("Internal note");
});
