import { chooseOption } from "./options.ts";
import { test, expect, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
const rootSelector = ".tl2-content-vui-shell";
async function openProject(page: Page) {
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await expect(page.locator(".tl2-canvas")).toBeVisible();
}
async function drag(page: Page, name: string, dx: number, dy: number) {
	const box = (await page.getByRole("separator", { name, exact: true }).boundingBox())!;
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
	await page.mouse.up();
}

for (const theme of ["light", "dark"] as const)
	test(`panel defaults, reload and tool parity ${theme}`, async ({ page, context }) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.emulateMedia({ colorScheme: theme });
		await replayApi(context, HAR);
		await openProject(page);
		const metrics = () =>
			page.locator(rootSelector).evaluate((root) => {
				const main = root.querySelector<HTMLElement>(':scope > [data-vui-slot="main"]')!;
				const box = (slot: string) =>
					main.querySelector(`[data-vui-slot="${slot}"]`)!.getBoundingClientRect();
				return {
					width: main.clientWidth - 32,
					height: main.clientHeight - 24,
					tools: box("tools").width,
					preview: box("preview").width,
					inspector: box("inspector").width,
					upper: box("tools").height,
					timeline: box("timeline").height,
				};
			});
		await expect
			.poll(async () => {
				const m = await metrics();
				return Math.abs(m.tools / m.width - 0.35);
			})
			.toBeLessThan(0.005);
		const initial = await metrics();
		expect(initial.preview / initial.width).toBeCloseTo(0.3, 2);
		expect(initial.inspector / initial.width).toBeCloseTo(0.35, 2);
		expect(initial.upper / initial.height).toBeCloseTo(0.5, 2);
		expect(initial.timeline / initial.height).toBeCloseTo(0.5, 2);
		await drag(page, "Resize tools and preview", -40, 0);
		await drag(page, "Resize preview and inspector", 30, 0);
		await drag(page, "Resize upper panels and timeline", 0, 30);
		const saved = await metrics();
		await page.reload();
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		await expect
			.poll(async () => Math.round((await metrics()).tools))
			.toBe(Math.round(saved.tools));
		const restored = await metrics();
		expect(restored.inspector).toBeCloseTo(saved.inspector, 0);
		expect(restored.timeline).toBeCloseTo(saved.timeline, 0);
		for (const code of ["Digit1", "Digit2", "Digit6", "Digit8"]) {
			await page.keyboard.press(`Alt+${code}`);
			const changed = await metrics();
			expect(changed.tools).toBeCloseTo(saved.tools, 0);
			expect(changed.upper).toBeCloseTo(saved.upper, 0);
		}
		await page.keyboard.press("Alt+Digit2");
		await drag(page, "Resize upper panels and timeline", 0, -1000);
		await expect(page.locator("[data-prompt='input']")).toBeInViewport();
		await expect(page.locator(".fc-chat-log")).toHaveCSS("min-height", "0px");
	});

for (const width of [1440, 900])
	test(`desktop pane boundaries and rail parity at ${width}px`, async ({ page, context }, info) => {
		await page.setViewportSize({ width, height: 900 });
		await replayApi(context, HAR);
		await openProject(page);
		const root = page.locator(rootSelector);
		const tools = root.locator(':scope > [data-vui-slot="main"] > [data-vui-slot="tools"]');
		const inspector = root.locator(':scope > [data-vui-slot="main"] > [data-vui-slot="inspector"]');
		const timeline = root.locator('[data-vui-slot="timeline"]');
		// Chat and Assets use the same workspace boundary.
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Assets", exact: true })
			.click();
		await expect(page.locator(".tl2-pane-separator")).toHaveCount(3);
		await expect(page.getByRole("separator", { name: "Resize tools and preview" })).toHaveCSS(
			"cursor",
			"col-resize",
		);
		await expect(
			page.getByRole("separator", { name: "Resize upper panels and timeline" }),
		).toHaveCSS("cursor", "row-resize");
		const oldTools = (await tools.boundingBox())!.width;
		expect(oldTools).toBeCloseTo((width - 32) * 0.35, 0);
		await drag(page, "Resize tools and preview", -70, 0);
		await expect.poll(async () => (await tools.boundingBox())!.width).toBeLessThan(oldTools - 40);
		const oldInspector = (await inspector.boundingBox())!.width;
		await drag(page, "Resize preview and inspector", -40, 0);
		await expect
			.poll(async () => (await inspector.boundingBox())!.width)
			.toBeGreaterThan(oldInspector + 20);
		const oldTimeline = (await timeline.boundingBox())!.height;
		await drag(page, "Resize upper panels and timeline", 0, -50);
		await expect
			.poll(async () => (await timeline.boundingBox())!.height)
			.toBeGreaterThan(oldTimeline + 30);
		for (const name of [
			"Resize tools and preview",
			"Resize preview and inspector",
			"Resize upper panels and timeline",
		]) {
			const handle = page.getByRole("separator", { name, exact: true });
			await handle.focus();
			const before = Number(await handle.getAttribute("aria-valuenow"));
			await handle.press(name.includes("timeline") ? "ArrowDown" : "ArrowRight");
			await expect(handle).toBeFocused();
			expect(Number(await handle.getAttribute("aria-valuenow"))).not.toBe(before);
		}
		const cancelled = page.getByRole("separator", { name: "Resize tools and preview" });
		const box = (await cancelled.boundingBox())!;
		await page.mouse.move(box.x + 3, box.y + 3);
		await page.mouse.down();
		await cancelled.dispatchEvent("pointercancel", {
			pointerId: 1,
			pointerType: "mouse",
			isPrimary: true,
		});
		expect(
			await page.evaluate(() => ({
				cursor: document.body.style.cursor,
				selection: document.body.style.userSelect,
			})),
		).toEqual({ cursor: "", selection: "" });
		await page.mouse.up();
		await page.mouse.down();
		await page.mouse.move(box.x + 4, box.y + 3);
		await cancelled.evaluate((element) => element.releasePointerCapture(1));
		await page.mouse.move(box.x + 5, box.y + 3);
		await expect.poll(() => page.evaluate(() => document.body.style.cursor)).toBe("");
		await page.mouse.up();
		await drag(page, "Resize tools and preview", 2000, 0);
		await page.setViewportSize({ width: 900, height: 560 });
		await expect
			.poll(async () => (await page.locator(".tl2-canvas").boundingBox())!.width)
			.toBeGreaterThan(30);
		const tl = (await timeline.boundingBox())!,
			left = (await tools.boundingBox())!,
			right = (await inspector.boundingBox())!;
		expect(Math.abs(tl.x - left.x)).toBeLessThan(2);
		expect(Math.abs(tl.x + tl.width - right.x - right.width)).toBeLessThan(2);
		expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
			900,
		);
		await expect(page.locator(".tl2-panel")).toBeVisible();
		await page.locator("[data-clipid]").first().click();
		await expect(page.locator(".tl2-clip-railbtn").first()).toBeVisible();
		const metrics = await page.evaluate(() => {
			const values = (selector: string) => {
				const node = document.querySelector(selector)!;
				const s = getComputedStyle(node);
				return [s.width, s.height, s.padding, s.gap, s.borderRightWidth, s.borderRadius];
			};
			return {
				rail: values(".tl2-rail"),
				clip: values(".tl2-clip-rail"),
				button: values(".tl2-railbtn"),
				clipButton: values(".tl2-clip-railbtn"),
			};
		});
		expect(metrics.rail.slice(0, 1).concat(metrics.rail.slice(2))).toEqual(
			metrics.clip.slice(0, 1).concat(metrics.clip.slice(2)),
		);
		expect(metrics.button).toEqual(metrics.clipButton);
		await inspector.getByRole("button", { name: "Transform", exact: true }).click();
		const inspectorBody = inspector.locator(".tl2-clip-panel-body");
		await expect(inspectorBody).toHaveCSS("scrollbar-width", "none");
		await inspectorBody.hover();
		await page.mouse.wheel(0, 1000);
		await expect
			.poll(() => inspectorBody.evaluate((element) => element.scrollTop))
			.toBeGreaterThan(0);
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Style", exact: true })
			.hover();
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Style", exact: true })
			.focus();
		await page.keyboard.press("Tab");
		await page.keyboard.press("Shift+Tab");
		await expect(page.locator('[data-slot="tooltip"]').filter({ hasText: "Style" })).toBeVisible();
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeVisible();
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await page.setViewportSize({ width: 320, height: 740 });
		await expect(page.locator(".tl2-pane-separator")).toHaveCount(0);
		await expect(root).not.toHaveAttribute("style", /--tl2-tools-w/);
		await expect(page.locator(".tl2-canvas")).toBeVisible();
		await page.setViewportSize({ width, height: 900 });
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Assets", exact: true })
			.click();
		await expect(page.locator(".tl2-pane-separator")).toHaveCount(3);
		await expect(page.locator(".tl2-canvas")).toBeVisible();
		await page.screenshot({ path: info.outputPath("resized.png") });
		const finalHandle = page.getByRole("separator", { name: "Resize tools and preview" });
		const finalBox = (await finalHandle.boundingBox())!;
		await page.mouse.move(finalBox.x + 3, finalBox.y + 3);
		await page.mouse.down();
		await page.getByRole("tab", { name: "Script", exact: true }).focus();
		await page.keyboard.press("Enter");
		await expect(page.locator(".tl2-pane-separator")).toHaveCount(0);
		expect(
			await page.evaluate(() => ({
				cursor: document.body.style.cursor,
				selection: document.body.style.userSelect,
			})),
		).toEqual({ cursor: "", selection: "" });
		await page.mouse.up();
	});

for (const width of [1440, 320])
	for (const theme of ["light", "dark"] as const)
		test(`inline project settings save, defaults and voice at ${width}px ${theme}`, async ({
			browser,
		}, info) => {
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
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
					(route) =>
						route.fulfill({
							json: {
								...editorChatProjectDetail,
								project: { ...editorChatProjectDetail.project, editor_state_json: state },
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
				await context.route(/\/storyboards(\?|$)/, (route) =>
					route.request().method() === "POST"
						? route.fulfill({ json: { storyboard: { id: "saved", version: 2 } } })
						: route.fallback(),
				);
				const sample = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=440:duration=10",
					"-f",
					"wav",
					"pipe:1",
				]);
				await context.route("**/fixture-voice.wav", (route) =>
					route.fulfill({ body: sample, contentType: "audio/wav" }),
				);
				await context.route(/\/tts\/status(\?|$)/, (route) =>
					route.fulfill({
						json: {
							ready: true,
							effective_provider: "kokoro",
							providers: [
								{
									id: "kokoro",
									label: "Fixture Kokoro",
									health: "ready",
									voices: Array.from({ length: 20 }, (_, i) => ({
										id: `voice${i}`,
										name: `Voice ${i}`,
										lang: "en",
										sampleUrl: "/fixture-voice.wav",
									})),
								},
								{ id: "pocket-tts", label: "Unavailable", health: "unconfigured", voices: [] },
							],
						},
					}),
				);
				let imageFails = true;
				await context.route(/\/settings\/image-provider(\?|$)/, (route) =>
					imageFails
						? route.fulfill({ status: 503, json: { error: "Provider offline" } })
						: route.fulfill({
								json: {
									selected_provider: "fixture-image",
									effective_provider: "fixture-image",
									worker_configured: false,
									providers: [],
								},
							}),
				);
				const page = await context.newPage();
				await openProject(page);
				const project = page
					.getByRole("navigation", { name: "Editor tools" })
					.getByRole("button", { name: "Project", exact: true });
				await project.focus();
				await project.press("Enter");
				const settings = page.locator(".fc-project-settings");
				await expect(settings.getByRole("region", { name: "Output", exact: true })).toBeVisible();
				await expect(settings).toHaveCSS("scrollbar-width", "none");
				await expect(
					settings.getByText("Image provider unavailable", { exact: true }),
				).toBeVisible();
				imageFails = false;
				await settings
					.getByRole("alert")
					.filter({ hasText: "Image provider unavailable" })
					.getByRole("button", { name: "Try again", exact: true })
					.click();
				await expect(
					settings.getByText(
						"Media worker is not configured. Choice is saved but cannot run yet.",
						{ exact: true },
					),
				).toBeVisible();
				await chooseOption(
					settings.getByRole("combobox", { name: "Aspect ratio", exact: true }),
					"1:1",
				);
				await chooseOption(
					settings.getByRole("combobox", { name: "Render backend", exact: true }),
					"local",
				);
				await chooseOption(
					settings.getByRole("combobox", { name: "Voice provider", exact: true }),
					"kokoro",
				);
				await chooseOption(
					settings.getByRole("combobox", { name: "Narration language", exact: true }),
					"id",
				);
				const voices = settings.getByRole("listbox", { name: "Voice", exact: true });
				await voices.getByRole("button", { name: "Voice 19", exact: true }).focus();
				await voices.getByRole("button", { name: "Voice 19", exact: true }).press("Enter");
				await expect(voices.getByRole("option").filter({ hasText: "Voice 19" })).toHaveAttribute(
					"aria-selected",
					"true",
				);
				if (width === 320) {
					for (const name of ["Voice 19", "Play Voice 19 sample"])
						expect(
							(await voices.getByRole("button", { name, exact: true }).boundingBox())!.height,
						).toBeGreaterThanOrEqual(44);
					expect(
						(await voices
							.getByRole("button", { name: "Play Voice 19 sample", exact: true })
							.boundingBox())!.width,
					).toBeGreaterThanOrEqual(44);
				}
				await voices.getByRole("button", { name: "Play Voice 19 sample", exact: true }).click();
				await expect(
					voices.getByRole("button", { name: "Stop Voice 19 sample", exact: true }),
				).toBeVisible();
				await voices.getByRole("button", { name: "Stop Voice 19 sample", exact: true }).click();
				await expect
					.poll(() => state.settings)
					.toMatchObject({
						aspectRatio: "1:1",
						renderBackend: "local",
						voiceProvider: "kokoro",
						voice: "voice19",
						language: "id",
					});
				expect(JSON.stringify(state.element_sources)).toContain("operator");
				await settings
					.getByRole("button", { name: "Aspect ratio default actions", exact: true })
					.click();
				await expect(
					page.getByText("Returns to the value that ships in code.", { exact: true }),
				).toBeVisible();
				await page.getByRole("button", { name: "Reset to shipped default", exact: true }).click();
				await expect(
					settings.getByRole("combobox", { name: "Aspect ratio", exact: true }),
				).toHaveAttribute("data-value", "9:16");
				const audio = settings.getByRole("button", { name: "Audio", exact: true });
				await audio.click();
				await expect(audio).toHaveAttribute("aria-expanded", "false");
				await expect(audio).toBeFocused();
				await audio.press("Enter");
				await expect(audio).toHaveAttribute("aria-expanded", "true");
				await expect
					.poll(() => state.settings)
					.toMatchObject({ aspectRatio: "9:16", voice: "voice19" });
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await project.click();
				await expect(
					settings.getByRole("combobox", { name: "Render backend", exact: true }),
				).toHaveAttribute("data-value", "local");
				await expect(
					settings.getByRole("combobox", { name: "Narration language", exact: true }),
				).toHaveAttribute("data-value", "id");
				await expect(settings.getByRole("option").filter({ hasText: "Voice 19" })).toHaveAttribute(
					"aria-selected",
					"true",
				);
				await settings.hover();
				await page.mouse.wheel(0, 1000);
				await expect.poll(() => settings.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
				await page.screenshot({ path: info.outputPath("inline-settings.png") });
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();
				await expect(
					page.getByRole("heading", { name: "Project Settings", exact: true }),
				).not.toBeVisible();
				if (width === 320) {
					await project.click();
					await expect(page.getByRole("button", { name: "Hide panel", exact: true })).toBeVisible();
					await expect(page.locator(".tl2-pane-separator")).toHaveCount(0);
				}
			} finally {
				await context.close();
			}
		});

test("rail tooltip escapes scrolling container", async ({ page, context }) => {
	await page.setViewportSize({ width: 1440, height: 900 });
	await replayApi(context, HAR);
	await openProject(page);
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Style", exact: true })
		.hover();
	await expect(page.locator('[data-slot="tooltip"]')).toHaveText("Style (Alt+3)");
	await expect(page.locator('[data-slot="tooltip"]')).toBeVisible();
});

for (const builtin of [false, true])
	test(`inline default actions retain ${builtin ? "built-in copying" : "shared confirmation"}`, async ({
		page,
		context,
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await replayApi(context, HAR);
		const preset = {
			id: "fixture-active-preset",
			name: "Active default",
			source: builtin ? "fixture" : "user",
			slug: builtin ? "fixture-default" : null,
			retired: false,
			bundle: { settings: { aspectRatio: "16:9" } },
		};
		let state: Record<string, unknown> = {
			...editorChatProjectDetail.project.editor_state_json,
			active_preset_id: preset.id,
		};
		const updates: Array<{ bundle: { settings: Record<string, unknown> } }> = [];
		const creates: Array<{ bundle: { settings: Record<string, unknown> } }> = [];
		await context.route(
			new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
			(route) =>
				route.fulfill({
					json: {
						...editorChatProjectDetail,
						project: { ...editorChatProjectDetail.project, editor_state_json: state },
					},
				}),
		);
		await context.route(
			new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/editor-state(\\?|$)`),
			(route) => {
				if (route.request().method() === "PUT") state = route.request().postDataJSON().editor_state;
				return route.fulfill({ json: { ok: true } });
			},
		);
		await context.route(/\/storyboards(\?|$)/, (route) =>
			route.request().method() === "POST"
				? route.fulfill({ json: { storyboard: { id: "saved", version: 2 } } })
				: route.fallback(),
		);
		await context.route(/\/content-presets(?:\/[^?]+)?(\?|$)/, async (route) => {
			const request = route.request(),
				path = new URL(request.url()).pathname;
			if (path.endsWith("/usage"))
				return route.fulfill({ json: { using: 2, diverged: 0, projects: [] } });
			if (request.method() === "PATCH") {
				const body = request.postDataJSON();
				updates.push(body);
				return route.fulfill({ json: { item: { ...preset, ...body } } });
			}
			if (request.method() === "POST") {
				const body = request.postDataJSON();
				creates.push(body);
				return route.fulfill({
					json: { item: { ...preset, ...body, id: "custom-copy", source: "user" } },
				});
			}
			return route.fulfill({ json: { items: [preset], defaultId: null } });
		});
		await openProject(page);
		await page
			.getByRole("navigation", { name: "Editor tools" })
			.getByRole("button", { name: "Project", exact: true })
			.click();
		const settings = page.locator(".fc-project-settings");
		await chooseOption(
			settings.getByRole("combobox", { name: "Aspect ratio", exact: true }),
			"1:1",
		);
		await settings
			.getByRole("button", { name: "Aspect ratio default actions", exact: true })
			.click();
		await expect(
			page.getByText("Returns to the value Active default supplies.", { exact: true }),
		).toBeVisible();
		await page.getByRole("button", { name: "Use default", exact: true }).click();
		await expect(
			settings.getByRole("combobox", { name: "Aspect ratio", exact: true }),
		).toHaveAttribute("data-value", "16:9");
		await chooseOption(
			settings.getByRole("combobox", { name: "Render backend", exact: true }),
			"local",
		);
		await settings
			.getByRole("button", { name: "Render backend default actions", exact: true })
			.click();
		await expect(
			page.getByText("Returns to the value that ships in code.", { exact: true }),
		).toBeVisible();
		if (builtin) {
			await expect(
				page.getByText(
					"Creates a custom default from Active default. The built-in default stays unchanged.",
					{ exact: true },
				),
			).toBeVisible();
			await page.getByRole("button", { name: "Save as custom default", exact: true }).click();
			await expect.poll(() => creates.length).toBe(1);
			expect(creates[0]!.bundle.settings.renderBackend).toBe("local");
			expect(updates).toHaveLength(0);
			await expect.poll(() => state.active_preset_id).toBe("custom-copy");
		} else {
			await expect(
				page.getByText("Writes this value into Active default.", { exact: true }),
			).toBeVisible();
			await expect(page.getByText("Used by 2 projects", { exact: true })).toBeVisible();
			page.once("dialog", async (dialog) => {
				expect(dialog.message()).toContain("affects 2 projects");
				await dialog.dismiss();
			});
			await page.getByRole("button", { name: "Update default", exact: true }).click();
			await settings
				.getByRole("button", { name: "Render backend default actions", exact: true })
				.click();
			expect(updates).toHaveLength(0);
			page.once("dialog", (dialog) => dialog.accept());
			await page.getByRole("button", { name: "Update default", exact: true }).click();
			await expect.poll(() => updates.length).toBe(1);
			expect(updates[0]!.bundle.settings.renderBackend).toBe("local");
		}
		expect(preset.bundle.settings).toEqual({ aspectRatio: "16:9" });
	});
