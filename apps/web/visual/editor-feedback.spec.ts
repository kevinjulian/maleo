import { chooseOption } from "./options.ts";
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`editor feedback at ${width}px ${theme}`, async ({ browser }, info) => {
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
				let state: Record<string, unknown> = {
					...editorChatProjectDetail.project.editor_state_json,
				};
				let storyboard: Record<string, unknown> = {
					...editorChatProjectDetail.storyboards[0]!.storyboard_json,
				};
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
					(route) =>
						route.fulfill({
							json: {
								...editorChatProjectDetail,
								project: { ...editorChatProjectDetail.project, editor_state_json: state },
								storyboards: [
									{ ...editorChatProjectDetail.storyboards[0], storyboard_json: storyboard },
								],
							},
						}),
				);
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/editor-state(\\?|$)`),
					(route) => {
						if (route.request().method() === "PUT")
							state = route.request().postDataJSON().editor_state;
						return route.fulfill({ json: { ok: true } });
					},
				);
				await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
					stored: () => storyboard,
					onSave: (next) => {
						storyboard = next;
					},
				});
				const page = await context.newPage();
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const tools = page.getByRole("navigation", { name: "Editor tools" });
				await expect(page.locator(".tl2-timeline")).toHaveCSS("cursor", "default");
				await expect(page.locator(".tl2-ruler")).toHaveCSS("cursor", "default");
				await expect(page.locator(".tl2-lane").first()).toHaveCSS("cursor", "default");
				await tools.getByRole("button", { name: "Assets", exact: true }).click();
				await chooseOption(page.getByRole("combobox", { name: "Filter media by kind" }), "image");
				await chooseOption(page.getByRole("combobox", { name: "Sort media" }), "name");
				const list = page.getByRole("button", { name: "List view", exact: true });
				await list.click();
				await expect(list).toHaveAttribute("aria-pressed", "true");
				await expect(list.locator("svg")).toHaveCount(1);
				expect(await list.innerText()).toBe("");
				if (width === 320) {
					const box = (await list.boundingBox())!;
					expect(box.width).toBeGreaterThanOrEqual(44);
					expect(box.height).toBeGreaterThanOrEqual(44);
				}
				await page.getByRole("button", { name: "Grid view", exact: true }).click();
				await expect(page.locator(".fc-quickcreate")).toHaveCount(0);
				await tools.getByRole("button", { name: "Style", exact: true }).click();
				const style = page.locator(".fc-style-panel");
				const section = style.getByRole("button", { name: "Brand", exact: true });
				await expect(section.locator("svg")).toHaveCount(1);
				await expect(section).toHaveAttribute("aria-expanded", "false");
				await section.press("Enter");
				await expect(section).toHaveAttribute("aria-expanded", "true");
				await expect(section).toBeFocused();
				await expect(style.getByText("Changed", { exact: true })).toHaveCount(0);
				await style
					.getByRole("textbox", { name: "Background CSS color or gradient" })
					.fill("#123456");
				await expect.poll(() => state.settings).toMatchObject({ backgroundFill: "#123456" });
				expect(JSON.stringify(state.element_sources)).toContain("operator");
				await style
					.getByRole("button", { name: "Background default actions", exact: true })
					.click();
				await page.getByRole("button", { name: "Reset to shipped default", exact: true }).click();
				await expect
					.poll(() => (state.settings as Record<string, unknown>).backgroundFill)
					.not.toBe("#123456");
				await tools.getByRole("button", { name: "Captions", exact: true }).click();
				await page.getByRole("tab", { name: "Style", exact: true }).click();
				const enabled = page.getByRole("switch", { name: "Enable captions" });
				if ((await enabled.getAttribute("aria-checked")) === "true") await enabled.click();
				await expect(page.locator('.fc-cap [data-slot="inspector-section"]')).toHaveCount(0);
				await expect(
					page.locator(".fc-cap").getByRole("combobox", { name: "Font family", exact: true }),
				).toHaveCount(0);
				await enabled.click();
				const size = page.getByRole("combobox", { name: "Font size", exact: true });
				await chooseOption(size, "96");
				await enabled.click();
				await expect(size).toHaveCount(0);
				await enabled.click();
				await expect(size).toHaveAttribute("data-value", "96");
				const typography = page.getByRole("button", { name: "Typography & motion", exact: true });
				await typography.click();
				await expect(size).not.toBeVisible();
				await typography.press("Enter");
				await expect(size).toBeVisible();
				await expect(typography).toBeFocused();
				await page.getByRole("tab", { name: "Transcript", exact: true }).click();
				await page.locator('input[type="file"][accept=".srt"]').setInputFiles({
					name: "invalid.srt",
					mimeType: "text/plain",
					buffer: Buffer.from("invalid captions"),
				});
				await expect(
					page.getByRole("alert").filter({ hasText: "No valid captions found" }),
				).toBeVisible();
				await expect.poll(() => JSON.stringify(storyboard)).toContain('"fontSize":96');
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await tools.getByRole("button", { name: "Captions", exact: true }).click();
				await page.getByRole("tab", { name: "Style", exact: true }).click();
				await expect(size).toHaveAttribute("data-value", "96");
				await page.screenshot({ path: info.outputPath("captions.png") });
				await tools.getByRole("button", { name: "Templates", exact: true }).click();
				const header = page.getByRole("heading", { name: "Templates", exact: true, level: 2 });
				const override = page.getByRole("button", { name: "Render override", exact: true });
				await expect(override).toBeVisible();
				expect((await header.boundingBox())!.y).toBeLessThan((await override.boundingBox())!.y);
				await expect(
					page.locator('.tl2-template-library [data-slot="inspector-section"]'),
				).toHaveCount(2);
				const beat = page.getByRole("spinbutton", { name: "Max visual beat", exact: true });
				await beat.fill("8.5");
				await beat.press("Tab");
				await expect(beat).toHaveValue("8.5");
				await expect.poll(() => state.render_overrides).toMatchObject({ maxVisualBeatSec: 8.5 });
				await override.click();
				await expect(beat).not.toBeVisible();
				await override.press("Enter");
				await expect(beat).toBeVisible();
				await page.getByRole("button", { name: "Revert to template", exact: true }).click();
				await expect(beat).not.toHaveValue("8.5");
				await page.screenshot({ path: info.outputPath("templates.png") });
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();
				await expect(header).not.toBeVisible();
				if (width === 320) await expect(page.getByRole("separator")).toHaveCount(0);
			} finally {
				await context.close();
			}
		});

test("resize targets cover complete panel gaps and inspector uses SVG disclosure", async ({
	page,
	context,
}) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await replayApi(context, HAR);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	// The fixture opens on chat, which resizes by its own handle; the generic tools
	// boundary belongs to an ordinary panel.
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	for (const name of [
		"Resize tools and preview",
		"Resize preview and inspector",
		"Resize upper panels and timeline",
	]) {
		const handle = page.getByRole("separator", { name, exact: true });
		const box = (await handle.boundingBox())!;
		expect(name.includes("timeline") ? box.height : box.width).toBe(8);
		for (const fraction of [0.1, 0.5, 0.9]) {
			const current = (await handle.boundingBox())!;
			const point = {
				x: current.x + current.width * fraction,
				y: current.y + current.height * fraction,
			};
			expect(
				await page.evaluate(
					({ x, y }) => document.elementFromPoint(x, y)?.getAttribute("aria-label"),
					point,
				),
			).toBe(name);
			const before = Number(await handle.getAttribute("aria-valuenow"));
			await page.mouse.move(point.x, point.y);
			await page.mouse.down();
			await page.mouse.move(
				point.x + (name.includes("timeline") ? 0 : -6),
				point.y + (name.includes("timeline") ? -6 : 0),
				{ steps: 3 },
			);
			await page.mouse.up();
			expect(Number(await handle.getAttribute("aria-valuenow"))).not.toBe(before);
		}
	}
	await page.locator("[data-clipid]").first().click();
	await page.getByRole("button", { name: "Transform", exact: true }).click();
	const disclosure = page.locator('[data-vui-slot="accordion-header"]').first();
	await expect(disclosure.locator("svg")).toHaveCount(1);
	const wasOpen = await disclosure.getAttribute("aria-expanded");
	await disclosure.click();
	await expect(disclosure).toHaveAttribute("aria-expanded", wasOpen === "true" ? "false" : "true");
	await disclosure.press("Enter");
	await expect(disclosure).toHaveAttribute("aria-expanded", wasOpen!);
	await expect(disclosure).toBeFocused();
});
