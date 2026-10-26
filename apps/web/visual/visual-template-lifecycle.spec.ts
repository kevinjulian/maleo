import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { clipTemplateInputSchema, readStoryboardDocument, type ClipTemplate } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

for (const width of [1440, 320])
	test(`user motion lifecycle at ${width}px`, async ({ browser }, testInfo) => {
		test.setTimeout(120_000);
		const phone = width === 320;
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: phone ? 740 : 900 },
			hasTouch: phone,
			isMobile: phone,
			reducedMotion: "reduce",
		});
		try {
			await replayApi(context, resolve(import.meta.dirname, "fixtures/api-editor-chat.har"));
			let templates: ClipTemplate[] = [];
			await context.route(
				/\/api\/operations\/clip-templates(?:\/[^?]+)?(?:\?|$)/,
				async (route) => {
					const request = route.request();
					if (request.method() === "GET") return route.fulfill({ json: { items: templates } });
					if (request.method() === "DELETE") {
						templates = [];
						return route.fulfill({ json: { ok: true } });
					}
					const input = clipTemplateInputSchema.parse(request.postDataJSON());
					const item: ClipTemplate = { ...input, id: "user-motion", createdAt: 1, updatedAt: 2 };
					templates = [item];
					return route.fulfill({ status: request.method() === "POST" ? 201 : 200, json: { item } });
				},
			);
			const first = editorChatProjectDetail.storyboards[0]!;
			let saved = first.storyboard_json;
			await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
				stored: () => saved,
				onSave: (next) => {
					saved = next as typeof saved;
				},
			});
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							storyboards: [{ ...first, storyboard_json: saved }],
						},
					}),
			);
			const page = await context.newPage(),
				errors: string[] = [];
			page.on("pageerror", (error) => errors.push(error.message));
			page.setDefaultTimeout(15_000);
			await page.goto("/library/elements");
			await expect(
				page.getByText("No saved motion yet. Create one with New motion.", { exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: "New motion", exact: true }).click();
			const studio = page.locator(".tl2-studio");
			await expect(studio).toBeVisible();
			if (phone) await page.getByRole("button", { name: "Motion identity", exact: true }).click();
			await page.getByPlaceholder("Motion name", { exact: true }).fill("Saved star motion");
			if (phone) {
				await page.getByRole("button", { name: "Back", exact: true }).click();
				await page.getByRole("button", { name: "Add layer", exact: true }).click();
			}
			await page.getByRole("button", { name: "Star", exact: true }).click();
			await page.getByRole("button", { name: "Save motion", exact: true }).click();
			await expect(studio).not.toBeVisible();
			await expect.poll(() => templates.length).toBe(1);
			const created = templates[0]!;
			expect(created.kind).toBe("composition");
			if (created.kind !== "composition") throw new Error("Expected composition");
			expect(created.config.schemaVersion).toBe(1);
			expect(created.config.spanSec).toBe(3);
			expect(created.config.overlays.map((layer) => layer.preset)).toEqual(["plain", "shape-star"]);
			const tile = page
				.locator(".fc-template-tile")
				.filter({ has: page.getByText("Saved star motion", { exact: true }) });
			await tile.click();
			if (phone)
				await page
					.locator("[data-vui-slot=mobile-actions]")
					.getByRole("button", { name: "Close", exact: true })
					.click();
			if (phone) await page.getByRole("button", { name: "Motion identity", exact: true }).click();
			else await page.getByRole("button", { name: "Motion identity", exact: true }).click();
			await page.getByPlaceholder("Motion name", { exact: true }).fill("Edited star motion");
			if (phone) await page.getByRole("button", { name: "Back", exact: true }).click();
			await page.getByRole("button", { name: "Save changes", exact: true }).click();
			await expect(studio).not.toBeVisible();
			await expect.poll(() => templates[0]?.label).toBe("Edited star motion");
			const definition = templates[0]!;
			expect(definition.kind === "composition" && definition.config).toEqual(created.config);
			await page.screenshot({ path: testInfo.outputPath("saved-motion-library.png") });
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			if (phone)
				await page
					.getByRole("navigation", { name: "Editor tools", exact: true })
					.getByRole("button", { name: "Elements", exact: true })
					.tap();
			else await page.keyboard.press("Alt+Digit5");
			await page.getByRole("button", { name: "Add Edited star motion", exact: true }).click();
			const placed = () =>
				readStoryboardDocument(saved).doc.clips.filter(
					(clip) => clip.text?.preset === "motion-comp",
				);
			await expect.poll(() => placed().length).toBe(1);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			const instance = structuredClone(placed()[0]!);
			expect(instance.text?.params).toEqual(created.config);
			if (phone) {
				const close = page.locator('.tl2-clipbar [aria-label="Close"]');
				if (await close.count()) await close.click();
			}
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect.poll(() => placed().length).toBe(0);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(() => placed().length).toBe(1);
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			expect(placed()[0]).toEqual(instance);
			await page.goto("/library/elements");
			const edited = page
				.locator(".fc-template-tile")
				.filter({ has: page.getByText("Edited star motion", { exact: true }) });
			await edited.click({ button: "right" });
			await page.locator(".fc-ctx").getByRole("button", { name: "Delete", exact: true }).click();
			await page
				.locator(".fc-ctx")
				.getByRole("button", { name: "Confirm delete?", exact: true })
				.click();
			await expect.poll(() => templates.length).toBe(0);
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			expect(placed()[0]).toEqual(instance);
			expect(errors).toEqual([]);
		} finally {
			await context.close();
		}
	});
