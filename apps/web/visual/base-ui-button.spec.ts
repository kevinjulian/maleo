import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

test.beforeEach(async ({ context }) => replayApi(context, HAR));

for (const width of [320, 1440]) {
	test(`New project action uses Base UI recipe at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		const create = page.getByRole("main").getByRole("button", { name: "New project", exact: true });
		await expect(create).toBeVisible();
		await expect(create).toHaveAttribute("data-slot", "button");
		const light = await create.evaluate((el) => ({
			background: getComputedStyle(el).backgroundColor,
			color: getComputedStyle(el).color,
			height: el.getBoundingClientRect().height,
		}));
		expect(light.height).toBeGreaterThanOrEqual(40);
		expect(light.background).not.toBe("rgba(0, 0, 0, 0)");
		await create.hover();
		expect(await create.evaluate((el) => getComputedStyle(el).backgroundColor)).not.toBe(
			light.background,
		);
		await page.keyboard.press("Tab");
		await create.focus();
		expect(await create.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe("2px");
		await create.evaluate((el) => el.setAttribute("disabled", ""));
		expect(await create.evaluate((el) => getComputedStyle(el).opacity)).toBe("0.5");
		await create.evaluate((el) => el.removeAttribute("disabled"));
		await page.locator("html").evaluate((el) => el.classList.add("dark"));
		const dark = await create.evaluate((el) => ({
			background: getComputedStyle(el).backgroundColor,
			color: getComputedStyle(el).color,
		}));
		expect(dark.background).not.toBe(light.background);
		expect(dark.color).not.toBe(light.color);
		await create.click();
		await expect(page).toHaveURL(/\/create\?workspace=default$/);
	});
	test(`shared recipe colors resolve Maleo tokens at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		for (const theme of ["light", "dark"]) {
			await page
				.locator("html")
				.evaluate((el, dark) => el.classList.toggle("dark", dark), theme === "dark");
			const colors = await page.evaluate(() => {
				const probe = document.createElement("button");
				probe.className = "tw:bg-ai tw:text-ai-foreground tw:rounded-md";
				const reference = document.createElement("div");
				reference.style.background = "var(--ai)";
				reference.style.color = "var(--on-ai)";
				document.body.append(probe, reference);
				const result = {
					background: getComputedStyle(probe).backgroundColor,
					foreground: getComputedStyle(probe).color,
					expectedBackground: getComputedStyle(reference).backgroundColor,
					expectedForeground: getComputedStyle(reference).color,
				};
				probe.remove();
				reference.remove();
				return result;
			});
			expect(colors.background).toBe(colors.expectedBackground);
			expect(colors.foreground).toBe(colors.expectedForeground);
		}
	});
	test(`shared Button recipe paints and focuses at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		const button = page.locator('[data-slot="button"][data-variant]').first();
		await expect(button).toBeVisible();
		const style = await button.evaluate((el) => ({
			height: el.getBoundingClientRect().height,
			background: getComputedStyle(el).backgroundColor,
			color: getComputedStyle(el).color,
		}));
		expect(style.height).toBeGreaterThanOrEqual(32);
		expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
		expect(style.color).not.toBe("rgba(0, 0, 0, 0)");
		await page.keyboard.press("Tab");
		await button.focus();
		expect(
			parseFloat(await button.evaluate((el) => getComputedStyle(el).outlineWidth)),
		).toBeGreaterThanOrEqual(2);
	});
	test(`Content badge uses shared recipe at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await page.goto("/content");
		const badge = page.getByRole("main").locator('[data-slot="chip"]').first();
		await expect(badge).toBeVisible();
		const style = await badge.evaluate((el) => ({
			background: getComputedStyle(el).backgroundColor,
			radius: getComputedStyle(el).borderRadius,
			fontSize: getComputedStyle(el).fontSize,
		}));
		expect(style.background).not.toBe("rgba(0, 0, 0, 0)");
		expect(style.radius).toBe("999px");
		expect(style.fontSize).toBe("11px"); // the Label role
	});
}
