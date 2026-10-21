import { chooseOption } from "./options.ts";
import { expect, test, type BrowserContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { replayApi } from "./har.ts";
import {
	editorChatProjectDetail,
	EDITOR_CHAT_PROJECT_ID,
	SCENES,
} from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
const imageSrc = SCENES[0]!.src;
const assets = [
	{
		id: "ready-image",
		label: "Ready image",
		kind: "image",
		source: "upload",
		url: imageSrc.replace("FIXTURE%201", "READY%20IMAGE"),
	},
	{
		id: "ready-video",
		label: "Ready footage",
		kind: "video",
		source: "upload",
		url: "/fixture-footage.mp4",
		thumb: imageSrc,
		dur: 12.5,
	},
	{
		id: "ready-audio",
		label: "Ready sound",
		kind: "audio",
		source: "upload",
		audioKind: "sfx",
		url: "/fixture-sound.wav",
		dur: 2.5,
	},
	{ id: "unready", label: "Unavailable footage", kind: "video", source: "upload", url: "" },
];
let videoBytes: Buffer, audioBytes: Buffer;
test.beforeAll(() => {
	videoBytes = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=64x64:r=30:d=12.5",
		"-c:v",
		"libx264",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
	audioBytes = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=2.5",
		"-f",
		"wav",
		"pipe:1",
	]);
});

async function fixture(context: BrowserContext): Promise<void> {
	await replayApi(context, HAR);
	await context.route("**/fixture-footage.mp4", (route) =>
		route.fulfill({ body: videoBytes, contentType: "video/mp4" }),
	);
	await context.route("**/fixture-sound.wav", (route) =>
		route.fulfill({ body: audioBytes, contentType: "audio/wav" }),
	);
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
		(route) =>
			route.fulfill({
				json: {
					...editorChatProjectDetail,
					project: {
						...editorChatProjectDetail.project,
						editor_state_json: {
							...editorChatProjectDetail.project.editor_state_json,
							media_assets: assets,
						},
					},
				},
			}),
	);
}

for (const viewport of [
	{ width: 1440, height: 900, touch: false },
	{ width: 320, height: 740, touch: true },
	{ width: 844, height: 390, touch: true },
]) {
	test(`ready media has explicit placement and one undo at ${viewport.width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport,
			hasTouch: viewport.touch,
			isMobile: viewport.touch,
			reducedMotion: "reduce",
		});
		try {
			await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const open = async () => {
				await page
					.getByRole("navigation", { name: "Editor tools" })
					.getByRole("button", { name: "Assets", exact: true })
					.click();
				await expect(
					page.getByRole("button", { name: "Add Ready footage to timeline", exact: true }),
				).toBeVisible();
			};
			const close = async () => {
				await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			};
			await open();
			await expect(
				page.getByRole("button", { name: "Add Unavailable footage to timeline", exact: true }),
			).toBeDisabled();
			await page.screenshot({ path: testInfo.outputPath("ready-media.png") });
			for (const [label, family, duration] of [
				["Ready footage", "video", 12.5],
				["Ready sound", "audio", 2.5],
			] as const) {
				const clips = page.locator(`[data-clipid^="${family}:"]`);
				const before = await clips.count();
				const add = page.getByRole("button", { name: `Add ${label} to timeline`, exact: true });
				if (viewport.touch) await add.tap();
				else {
					await add.focus();
					await page.keyboard.press("Enter");
				}
				await close();
				await expect(clips).toHaveCount(before + 1);
				const added = clips.last();
				await expect(added).toHaveAttribute("aria-label", new RegExp(label));
				await expect(added).toHaveAttribute("aria-selected", "true");
				const width = await added.evaluate((el) => parseFloat(el.style.width));
				expect(width).toBeGreaterThan(duration);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect(clips).toHaveCount(before);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect(clips).toHaveCount(before + 1);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await open();
			}
			const scenes = page.locator('[data-clipid^="scene:"]');
			const before = await scenes.count();
			await page.getByRole("button", { name: "Add Ready image to timeline", exact: true }).click();
			await close();
			await expect(scenes).toHaveCount(before + 1);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect(scenes).toHaveCount(before);
		} finally {
			await context.close();
		}
	});
}

test("native media drag previews destination, cancels, and refuses locked lanes", async ({
	page,
	context,
}, testInfo) => {
	await fixture(context);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	const source = page
		.getByRole("button", { name: "Add Ready footage to timeline", exact: true })
		.locator("xpath=ancestor::*[@draggable='true'][1]");
	await source.scrollIntoViewIfNeeded();
	const lane = page.locator('.tl2-lanes [data-vui-row="lane-1"]');
	const start = (await source.boundingBox())!,
		end = (await lane.boundingBox())!;
	const before = await page.locator('[data-clipid^="video:"]').count();
	const drag = async () => {
		await page.mouse.move(start.x + start.width * 0.7, start.y + start.height * 0.7);
		await page.mouse.down();
		await page.mouse.move(start.x + start.width + 10, start.y + 20, { steps: 6 });
		await page.mouse.move(end.x + 80, end.y + end.height / 2, { steps: 10 });
		await expect(page.locator(".tl2-media-drag-ghost")).toHaveCount(1);
		await page.mouse.move(end.x + 82, end.y + end.height / 2);
	};
	await drag();
	await page.mouse.move(end.x + 82, end.y + end.height / 2);
	await page.screenshot({ path: testInfo.outputPath("drag-debug.png") });
	await expect(page.locator(".tl2-media-drag-ghost")).toContainText("Ready footage");
	await expect(page.locator(".tl2-media-drag-ghost img")).toHaveAttribute("src", imageSrc);
	await expect(page.locator(".tl2-dropghost")).toContainText("12.5s");
	await expect(page.locator('[data-media-drop="valid"]')).toHaveCount(1);
	await page.screenshot({ path: testInfo.outputPath("drag-preview.png") });
	await page.keyboard.press("Escape");
	await page.mouse.up();
	await expect(page.locator(".tl2-media-drag-ghost")).toHaveCount(0);
	await expect(page.locator('[data-clipid^="video:"]')).toHaveCount(before);
	await page
		.locator('[data-gutter-row="1"]')
		.getByRole("button", { name: "Lock track", exact: true })
		.click();
	await drag();
	await expect(page.locator(".tl2-dropghost")).toContainText("Track locked");
	await expect(page.locator('[data-media-drop="invalid"]')).toHaveCount(1);
	await page.mouse.up();
	await expect(page.locator('[data-clipid^="video:"]')).toHaveCount(before);
	await page
		.locator('[data-gutter-row="1"]')
		.getByRole("button", { name: "Unlock track", exact: true })
		.click();
	await page.getByRole("slider", { name: "Timeline zoom", exact: true }).focus();
	await page.keyboard.press("End");
	await page.locator(".tl2-tlscroll").evaluate((el) => {
		el.scrollLeft = 120;
	});
	await drag();
	await expect(page.locator(".tl2-dropghost")).toContainText("12.5s");
	const preview = await page
		.locator(".tl2-dropghost")
		.evaluate((el) => ({ left: el.style.left, width: el.style.width }));
	await page.mouse.up();
	const clips = page.locator('[data-clipid^="video:"]');
	await expect(clips).toHaveCount(before + 1);
	await expect
		.poll(() => clips.last().evaluate((el) => ({ left: el.style.left, width: el.style.width })))
		.toEqual(preview);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clips).toHaveCount(before);
});

test("canvas basics update preview and persist operator provenance", async ({ page, context }) => {
	await fixture(context);
	await page.setViewportSize({ width: 1440, height: 900 });
	const writes: Array<{
		settings?: { aspectRatio?: string; backgroundFill?: string };
		element_sources?: unknown;
	}> = [];
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/editor-state(\\?|$)`),
		async (route) => {
			if (route.request().method() === "PUT")
				writes.push(route.request().postDataJSON().editor_state);
			await route.fulfill({ json: { ok: true } });
		},
	);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const canvas = page
		.locator(".tl2-clippanel")
		.getByRole("region", { name: "Canvas", exact: true });
	await chooseOption(canvas.getByRole("combobox", { name: "Aspect ratio", exact: true }), "1:1");
	await expect(canvas.getByRole("group", { name: "Output size", exact: true })).toContainText(
		"1080 × 1080",
	);
	await canvas.getByRole("textbox", { name: "Background", exact: true }).fill("#112233");
	await expect
		.poll(async () => {
			const r = (await page.locator(".tl2-canvas").boundingBox())!;
			return r.width / r.height;
		})
		.toBeCloseTo(1, 2);
	await expect
		.poll(() => writes.at(-1)?.settings)
		.toMatchObject({ aspectRatio: "1:1", backgroundFill: "#112233" });
	expect(JSON.stringify(writes.at(-1)?.element_sources)).toContain("operator");
	await canvas.getByRole("button", { name: "Project settings", exact: true }).click();
	await expect(page.getByRole("heading", { name: "Project Settings", exact: true })).toBeVisible();
});
