import { chooseOption } from "./options.ts";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { acknowledgeSaves } from "./chat-server.ts";
import { EDITOR_CHAT_FIXTURE_PROJECT_ID } from "./screens.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

for (const width of [320, 1440]) {
	test(`editor chrome stays operable at ${width}px`, async ({ page }, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		await replayApi(page.context(), HAR);
		await acknowledgeSaves(page, EDITOR_CHAT_FIXTURE_PROJECT_ID);
		await page.route(
			new RegExp(`/api/operations/projects/${EDITOR_CHAT_FIXTURE_PROJECT_ID}/storyboards(\\?|$)`),
			async (route) => {
				if (route.request().method() === "POST") {
					await route.fulfill({ json: { storyboard: { id: "sb-editor-shell", version: 2 } } });
					return;
				}
				await route.fallback();
			},
		);
		await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		await page.evaluate(() => document.fonts.ready);

		const modes = page.getByRole("tablist", { name: "Editor mode" });
		await expect(modes.locator('[data-slot="tabs-tab"]')).toHaveCount(4);
		await modes.getByRole("tab", { name: "Script" }).click();
		await expect(modes.getByRole("tab", { name: "Script" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
		await modes.getByRole("tab", { name: "Timeline" }).click();
		await expect(modes.getByRole("tab", { name: "Timeline" })).toHaveAttribute(
			"aria-selected",
			"true",
		);

		const timecode = page.locator('[data-transport="timecode"]');
		await expect(timecode).toHaveCSS("user-select", "none");
		await page.evaluate(() => window.getSelection()?.removeAllRanges());
		await timecode.dblclick();
		expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("");
		// Phone zoom lives in the More sheet, outside the timeline region.
		if (width > 860)
			await expect(page.getByRole("slider", { name: "Timeline zoom" })).toHaveCSS(
				"user-select",
				"text",
			);

		const play = page.getByRole("button", { name: "Play", exact: true });
		/* The transport's own round control (part of the TransportControls
		   pattern), not a shared Button: what matters is that it is a named,
		   enabled button that toggles playback. */
		await expect(play).toBeEnabled();
		await play.click();
		await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect(play).toBeVisible();
		await expect(page.getByRole("button", { name: /Undo/ })).toHaveAttribute(
			"data-slot",
			"icon-button",
		);
		await page.screenshot({ path: testInfo.outputPath(`editor-shell-${width}.png`) });

		const clip = page.locator(`[data-clipid="text:1"]`);
		await expect(clip).toBeVisible();
		await clip.click();
		await page.keyboard.press("Delete");
		await expect(clip).toHaveCount(0);
		const saveBadge = page.locator(".cv-savebadge", { hasText: "Saved" });
		await expect(saveBadge).toHaveClass(/saved/);
		if (width >= 640) await expect(saveBadge).toBeVisible();
		const undo = page.getByRole("button", { name: /Undo/ });
		await expect(undo).toBeEnabled();
		await undo.click();
		await expect(clip).toBeVisible();
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: /^Captions/ })
			.click();
		await page.getByRole("tab", { name: "Style", exact: true }).click();
		const captions = page.getByRole("switch", { name: "Enable captions" });
		await expect(captions).toHaveAttribute("data-slot", "switch");
		const before = await captions.getAttribute("aria-checked");
		await captions.click();
		await expect(captions).toHaveAttribute("aria-checked", before === "true" ? "false" : "true");
		if ((await captions.getAttribute("aria-checked")) === "false") await captions.click();
		const font = page.locator(".fc-cap").getByRole("combobox", { name: "Font family" });
		await font.click();
		const nextFont = await page
			.locator('[data-slot="select-popup"]')
			.getByRole("option")
			.nth(1)
			.getAttribute("data-value");
		await page.keyboard.press("Escape");
		await chooseOption(font, nextFont!);
		await expect(font).toHaveAttribute("data-value", nextFont!);
		/* Caption properties are grouped rows: an amount is a scrubbable number
		 * field sharing a row with its partners, a flag is a named switch. */
		const words = page
			.locator(".fc-cap")
			.getByRole("group", { name: "Placement", exact: true })
			.getByRole("spinbutton", { name: "Vertical position", exact: true });
		await words.fill("6");
		await expect(words).toHaveValue("6");
		const italic = page.locator(".fc-cap").getByRole("switch", { name: "Italic" });
		const italicBefore = await italic.getAttribute("aria-checked");
		await italic.click();
		await expect(italic).toHaveAttribute(
			"aria-checked",
			italicBefore === "true" ? "false" : "true",
		);
		if (width < 640) {
			await page
				.getByRole("tablist", { name: "Workspace view" })
				.getByRole("tab", { name: "Chat" })
				.click();
			await page.keyboard.press("Escape");
			await page.getByRole("button", { name: "Changes + assets audit" }).click();
			await expect(page.getByRole("tablist", { name: "Audit view" })).toBeVisible();
		}
	});
	test(`audit tabs use Base UI keyboard flow at ${width}px`, async ({ page }) => {
		await page.setViewportSize({ width, height: 900 });
		await replayApi(page.context(), HAR);
		await page.goto(`/content/${EDITOR_CHAT_FIXTURE_PROJECT_ID}`);
		if (width >= 640)
			await page
				.getByRole("tablist", { name: "Editor mode" })
				.getByRole("tab", { name: "Timeline" })
				.click();
		if (width < 640)
			await page
				.getByRole("tablist", { name: "Workspace view" })
				.getByRole("tab", { name: "Chat" })
				.click();
		else await page.keyboard.press("Alt+Digit2");
		await page.getByRole("button", { name: "Changes + assets audit" }).click();
		const auditTabs = page.getByRole("tablist", { name: "Audit view" });
		await expect(auditTabs.locator('[data-slot="tabs-tab"]')).toHaveCount(2);
		await auditTabs.getByRole("tab", { name: "Changes" }).focus();
		await page.keyboard.press("ArrowRight");
		await expect(auditTabs.getByRole("tab", { name: "Assets" })).toHaveAttribute(
			"aria-selected",
			"true",
		);
	});
}
