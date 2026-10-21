import { expect, test } from "@playwright/test";
import { readStoryboardDocument } from "@maleo/shared";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

// Exercise production components with authored API fixtures, without provider spend.
const destinations = [
	"Assets",
	"Style",
	"Templates",
	"Elements",
	"Transitions",
	"Effects",
	"Captions",
	"Project",
];
const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");
const viewports = [
	{ label: "desktop", width: 1440, height: 900, touch: false },
	{ label: "phone", width: 320, height: 740, touch: true },
	{ label: "landscape", width: 844, height: 390, touch: true },
];

for (const viewport of viewports) {
	for (const theme of ["light", "dark"] as const) {
		test(`editor destinations survive at ${viewport.label} in ${theme}`, async ({
			browser,
		}, testInfo) => {
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width: viewport.width, height: viewport.height },
				hasTouch: viewport.touch,
				isMobile: viewport.touch,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, HAR);
				const page = await context.newPage();
				await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
				await expect(page.locator(".tl2-timeline")).toBeVisible();
				const preview = page.locator(".tl2-preview");
				const canvas = page.locator(".tl2-canvas");
				await expect(preview).toBeVisible();
				const canvasBox = await canvas.boundingBox();
				expect(canvasBox?.width).toBeGreaterThan(40);
				expect(canvasBox?.height).toBeGreaterThan(40);
				await page.screenshot({ path: testInfo.outputPath("workspace.png") });
				for (const label of destinations) {
					const trigger = page
						.getByRole("navigation", { name: "Editor tools" })
						.getByRole("button", { name: label, exact: true });
					await trigger.click();
					const panel = page.locator(
						viewport.touch ? ".tl2-panel-sheet" : '[data-vui-slot="tools"] .tl2-panel',
					);
					await expect(panel).toBeVisible();
					await expect(panel).not.toBeEmpty();
					const box = await panel.boundingBox();
					expect(box?.width).toBeGreaterThan(100);
					expect(box?.height).toBeGreaterThan(80);
				}
				await page.screenshot({ path: testInfo.outputPath("project-settings.png") });
			} finally {
				await context.close();
			}
		});
	}
}

for (const width of [900, 1024, 1440]) {
	test(`desktop timeline spans tools and inspector at ${width}px and remains resizable`, async ({
		page,
		context,
	}, testInfo) => {
		await replayApi(context, HAR);
		await page.setViewportSize({ width, height: 900 });
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		const root = page.locator(".tl2-content-vui-shell");
		const timeline = root.locator('[data-vui-slot="timeline"]');
		const preview = root.locator('[data-vui-slot="preview"]');
		const tools = root.locator('[data-vui-slot="tools"]');
		await expect(timeline).toBeVisible();
		await page.screenshot({ path: testInfo.outputPath("editor-initial.png") });
		const assertSpan = async (): Promise<void> => {
			const tl = (await timeline.boundingBox())!;
			const left = (await tools.boundingBox())!;
			const right = (await root.locator('[data-vui-slot="inspector"]').count())
				? (await root.locator('[data-vui-slot="inspector"]').boundingBox())!
				: (await preview.boundingBox())!;
			expect(Math.abs(tl.x - left.x)).toBeLessThan(2);
			expect(Math.abs(tl.x + tl.width - right.x - right.width)).toBeLessThan(2);
			expect(tl.y).toBeGreaterThan(left.y + left.height);
			const canvas = (await page.locator(".tl2-canvas").boundingBox())!;
			expect(canvas.width).toBeGreaterThan(40);
			expect(Math.abs(canvas.width / canvas.height - 9 / 16)).toBeLessThan(0.01);
		};
		await assertSpan();
		const initial = (await timeline.boundingBox())!;
		const rootBox = (await root.boundingBox())!;
		expect(initial.height / rootBox.height).toBeGreaterThan(0.47);
		expect(initial.height / rootBox.height).toBeLessThan(0.51);
		const assets = page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Assets", exact: true });
		await assets.click();
		await expect(root.locator('[data-vui-slot="inspector"]')).toBeVisible();
		await assertSpan();
		const splitter = page.getByRole("separator", { name: "Resize upper panels and timeline" });
		const box = (await splitter.boundingBox())!;
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2, box.y - 70, { steps: 5 });
		await page.mouse.up();
		expect((await timeline.boundingBox())!.height).toBeGreaterThan(initial.height + 50);
		await assertSpan();
		await assets.click();
		await expect(root.locator(".tl2-panel")).toHaveCount(0);
		await assertSpan();
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			width,
		);
		await page.screenshot({ path: testInfo.outputPath("editor-resized.png") });
	});
}

for (const width of [1440, 320]) {
	test(`Project Materials mutations survive relocated UI and reload at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: 740 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await replayApi(
				context,
				resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har"),
			);
			const detail = structuredClone(editorChatProjectDetail);
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) => route.fulfill({ json: detail }),
			);
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/storyboards(\\?|$)`),
				async (route) => {
					detail.storyboards[0]!.storyboard_json = route.request().postDataJSON().storyboard_json;
					await route.fulfill({ json: { storyboard: detail.storyboards[0] } });
				},
			);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			const trigger = page.getByTitle("Edit Project Materials", { exact: true });
			if (width === 320) await trigger.tap();
			else {
				await trigger.focus();
				await page.keyboard.press("Enter");
			}
			const dialog = page.getByRole("dialog", { name: "Project Materials", exact: true });
			const groups = [
				["story", "Story"],
				["visual", "Visual"],
				["voice", "Voice"],
				["rules", "Rules"],
			] as const;
			for (const [key, group] of groups) {
				const row = dialog
					.locator(".tl2-materials-row-btn")
					.filter({ has: page.locator(`.tl2-materials-row-name:text-is("${group}")`) });
				if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
				await dialog
					.getByRole("textbox", { name: `${group} material`, exact: true })
					.fill(`Preserved ${group} guidance`);
				await expect
					.poll(
						() =>
							readStoryboardDocument(detail.storyboards[0]!.storyboard_json).doc.materials[key]
								.body,
					)
					.toBe(`Preserved ${group} guidance`);
			}
			await dialog
				.locator(".tl2-materials-row-btn")
				.filter({ has: page.locator('.tl2-materials-row-name:text-is("Visual")') })
				.click();
			await dialog
				.getByRole("textbox", { name: "Style guide", exact: true })
				.fill("Preserved locked style");
			await expect
				.poll(
					() =>
						readStoryboardDocument(detail.storyboards[0]!.storyboard_json).doc.materials.styleBible,
				)
				.toEqual({ body: "Preserved locked style", locked: true });
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			await page.reload();
			await trigger.click();
			for (const [, group] of groups) {
				const row = dialog
					.locator(".tl2-materials-row-btn")
					.filter({ has: page.locator(`.tl2-materials-row-name:text-is("${group}")`) });
				if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
				await expect(
					dialog.getByRole("textbox", { name: `${group} material`, exact: true }),
				).toHaveValue(`Preserved ${group} guidance`);
			}
		} finally {
			await context.close();
		}
	});
}
