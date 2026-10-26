/* Compare mode (`?renderer=compare`, OpenSpec p2-render-foundation D8).
 *
 * Without the parameter the editor never requests the renderer module. With it
 * in a browser without WebGPU, the panel says the Rust renderer is not
 * available, nothing else loads, and the Remotion preview seeks as usual. */
import { expect, test, type Page } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { replayApi } from "./har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api.har");

function rendererRequests(page: Page): string[] {
	const seen: string[] = [];
	page.on("request", (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith("/renderer/")) seen.push(path);
	});
	return seen;
}

async function openEditor(page: Page, search = ""): Promise<void> {
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}${search}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
}

test("the editor without the parameter never requests the renderer", async ({ page, context }) => {
	await replayApi(context, HAR);
	const requests = rendererRequests(page);
	await openEditor(page);
	await expect(page.locator(".tl2-remotion-stage")).toBeVisible();
	await expect(page.getByRole("region", { name: "Rust renderer" })).toHaveCount(0);
	expect(requests).toEqual([]);
});

test("compare mode without WebGPU says so, loads nothing, and the preview still seeks", async ({
	page,
	context,
}) => {
	await replayApi(context, HAR);
	await page.addInitScript(() =>
		Object.defineProperty(Navigator.prototype, "gpu", { get: () => undefined }),
	);
	const requests = rendererRequests(page);
	await openEditor(page, "?renderer=compare");
	const panel = page.getByRole("region", { name: "Rust renderer" });
	await expect(panel.getByRole("status")).toHaveText(
		"The Rust renderer is not available in this browser: it needs WebGPU.",
	);
	expect(requests).toEqual([]);

	const timecode = page.locator("[data-transport='timecode']").first();
	const before = await timecode.textContent();
	const ruler = (await page.locator(".tl2-ruler").boundingBox())!;
	await page.mouse.click(ruler.x + ruler.width * 0.6, ruler.y + ruler.height / 2);
	await expect(timecode).not.toHaveText(before ?? "", { timeout: 3000 });
	await expect(page.locator(".tl2-remotion-stage")).toBeVisible();
});

/** The worker must interpret saved primitive data, not merely load WASM. */
test("saved text and shape composition draws and seeks in the compare worker", async ({
	playwright,
}, testInfo) => {
	test.setTimeout(300_000);
	const { toTimelineDoc, compositionParams, PLAIN_TEXT_AUTHOR_STYLE } =
		await import("@maleo/shared");
	const { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } =
		await import("./fixtures/editor-chat-data.ts");
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	try {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width: 1440, height: 900 },
			reducedMotion: "reduce",
		});
		await replayApi(context, resolve(import.meta.dirname, "fixtures/api-editor-chat.har"));
		const config = {
			schemaVersion: 1 as const,
			spanSec: 4,
			overlays: [
				{
					preset: "plain" as const,
					content: "Saved motion",
					relStart: 0,
					dur: 4,
					track: 1,
					style: { ...PLAIN_TEXT_AUTHOR_STYLE },
					layout: { xPct: 10, yPct: 10, widthPct: 80, heightPct: 25, fit: "contain" as const },
				},
				{
					preset: "shape-star" as const,
					content: "",
					relStart: 0,
					dur: 4,
					track: 0,
					params: { fill: "transparent", stroke: "#00ffb3", strokeWidth: 8 },
					layout: { xPct: 30, yPct: 40, widthPct: 40, heightPct: 35, fit: "contain" as const },
					anim: {
						tracks: {
							rotate: [
								{ t: 0, v: 0 },
								{ t: 1, v: 90 },
							],
						},
					},
				},
			],
		};
		const first = editorChatProjectDetail.storyboards[0]!;
		const saved = {
			...first.storyboard_json,
			...toTimelineDoc(
				[
					{
						id: 1,
						name: "Base",
						shot: "Wide",
						move: "Static",
						transition: "cut",
						vis: "",
						vo: "",
						img: false,
						dur: 4,
					},
				],
				[],
				[
					{
						id: 90,
						preset: "motion-comp",
						content: "Saved motion",
						start: 0,
						dur: 4,
						track: 0,
						layout: { xPct: 0, yPct: 0, widthPct: 100, heightPct: 100, fit: "contain" },
						params: compositionParams(config),
					},
				],
			),
		};
		await context.route(
			new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
			(route) =>
				route.fulfill({
					json: { ...editorChatProjectDetail, storyboards: [{ ...first, storyboard_json: saved }] },
				}),
		);
		const page = await context.newPage(),
			requests = rendererRequests(page);
		await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}?renderer=compare`);
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		const panel = page.getByRole("region", { name: "Rust renderer", exact: true });
		await expect(
			panel.getByText("Every element at this frame is drawn.", { exact: true }),
		).toBeVisible({ timeout: 90_000 });
		expect(requests).toContain("/renderer/preview-worker.js");
		await expect(panel.getByRole("alert")).toHaveCount(0);
		const canvas = panel.locator("canvas");
		await expect(panel.locator("[data-slot=panel-header-sub]")).toContainText(/Frame [0-9]/, {
			timeout: 60_000,
		});
		const frameCount = async () =>
			Number((await panel.textContent())?.match(/\((\d+)\)/)?.[1] ?? 0);

		const seek = async (offset: number) => {
			const before = await frameCount();
			const slider = page.getByRole("slider", { name: "Playhead", exact: true });
			await slider.focus();
			const current = Math.round(Number(await slider.getAttribute("aria-valuenow")) * 30);
			for (let i = 0; i < Math.abs(offset - current); i++)
				await slider.press(offset > current ? "ArrowRight" : "ArrowLeft");
			await expect.poll(frameCount, { timeout: 90_000 }).toBeGreaterThan(before);
			await expect(
				panel.getByText("Every element at this frame is drawn.", { exact: true }),
			).toBeVisible();
		};
		await seek(30);
		const direct = await canvas.screenshot();
		await seek(75);
		await seek(30);
		expect((await canvas.screenshot()).equals(direct)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath("saved-motion-rust-compare.png") });
		await expect(page.locator(".tl2-remotion-stage")).toBeVisible();
	} finally {
		await browser.close();
	}
});
