import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320])
	test(`generated video poster and source bounds at ${width}px`, async ({ browser }, testInfo) => {
		test.setTimeout(60_000);
		const phone = width === 320;
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: 900 },
			hasTouch: phone,
			isMobile: phone,
		});
		try {
			await replayApi(context, HAR);
			const source = "/api/media/22222222-2222-4222-8222-222222222222";
			const posterUrl = "/api/media/33333333-3333-4333-8333-333333333333";
			const bytes = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-f",
				"lavfi",
				"-i",
				"color=c=blue:s=32x32:r=30:d=4",
				"-c:v",
				"libx264",
				"-threads",
				"1",
				"-pix_fmt",
				"yuv420p",
				"-movflags",
				"frag_keyframe+empty_moov",
				"-f",
				"mp4",
				"pipe:1",
			]);
			const jpeg = execFileSync(
				"ffmpeg",
				[
					"-v",
					"error",
					"-i",
					"pipe:0",
					"-frames:v",
					"1",
					"-f",
					"image2pipe",
					"-c:v",
					"mjpeg",
					"pipe:1",
				],
				{ input: bytes },
			);
			await context.route("**/api/media/*", (route) =>
				route.fulfill(
					new URL(route.request().url()).pathname === source
						? {
								body: '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="orange"/></svg>',
								contentType: "image/svg+xml",
							}
						: new URL(route.request().url()).pathname === posterUrl
							? { body: jpeg, contentType: "image/jpeg" }
							: { body: bytes, contentType: "video/mp4" },
				),
			);
			const first = editorChatProjectDetail.storyboards[0]!;
			let saved = {
				...first.storyboard_json,
				...toTimelineDoc(
					[2, 7].map((dur, i) => ({
						id: i + 1,
						name: i ? "Long" : "Short",
						shot: "Wide",
						move: "Static",
						vis: "Animate",
						vo: "",
						img: true,
						dur,
						src: source,
					})),
				),
			};
			/* What the editor saves back: the chat it was given, plus the media it admits. */
			let editorState: {
				chat: unknown[];
				media_assets?: Array<{ url: string; thumb?: string; poster?: string }>;
			} = editorChatProjectDetail.project.editor_state_json;
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/storyboards(\\?|$)`),
				async (route) => {
					if (route.request().method() === "POST")
						saved = route.request().postDataJSON().storyboard_json;
					await route.fallback();
				},
			);
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/editor-state(\\?|$)`),
				async (route) => {
					if (route.request().method() === "PUT")
						editorState = route.request().postDataJSON().editor_state;
					await route.fallback();
				},
			);
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							project: { ...editorChatProjectDetail.project, editor_state_json: editorState },
							storyboards: [{ ...first, storyboard_json: saved }],
						},
					}),
			);
			let requests = 0;
			await context.route("**/api/video/animate", (route) => {
				const input = route.request().postDataJSON();
				expect(input.durationSec).toBe(requests ? 7 : 2);
				expect(input.project_id).toBe(EDITOR_CHAT_PROJECT_ID);
				requests++;
				return route.fulfill({
					json: {
						url: `/api/media/11111111-1111-4111-8111-${String(requests).padStart(12, "0")}`,
						...(requests === 1 ? { posterUrl } : {}),
						durationSec: 4,
						providerId: "sandbox",
						model: "sandbox-mp4",
					},
				});
			});
			const page = await context.newPage();
			const close = async () => {
				const back = page.locator('.tl2-clipbar [aria-label="Back"]');
				if (phone && (await back.count())) await back.click();
			};
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			for (const id of [1, 2]) {
				await close();
				await page.locator(`[data-clipid="scene:${id}"]`).click();
				if (
					phone &&
					!(await page.getByRole("button", { name: "Animate", exact: true }).isVisible())
				)
					await page.locator('.tl2-clipbar-groups [aria-label="Source"]').tap();
				await page.getByRole("button", { name: "Animate", exact: true }).click();
				await expect
					.poll(() => saved.clips.filter((c) => c.video?.kind === "video").length)
					.toBe(id);
			}
			const generated = saved.clips.filter((c) => c.video?.kind === "video");
			expect(generated.map((c) => c.durationSec)).toEqual([2, 4]);
			for (const clip of generated) {
				expect(clip.video?.sourceDurationSec).toBe(4);
				expect(clip.video?.thumb).toBeUndefined();
			}
			await close();
			const long = generated[1]!;
			const clip = page.locator(`[data-clipid="${long.id}"]`);
			const expectVideoFrame = async (id: string) => {
				const poster = page.locator(`[data-clipid="${id}"] video.tl2-clip-strip`);
				await expect(poster).toHaveAttribute("src", new RegExp("11111111"));
				await expect
					.poll(() =>
						poster.evaluate((video: HTMLVideoElement) => {
							if (video.readyState < 2) return null;
							const canvas = document.createElement("canvas");
							canvas.width = canvas.height = 1;
							const ctx = canvas.getContext("2d")!;
							ctx.drawImage(video, 0, 0, 1, 1);
							const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
							return r! < 10 && g! < 10 && b! > 240;
						}),
					)
					.toBe(true);
			};
			const strip = page.locator(`[data-clipid="${generated[0]!.id}"] .tl2-clip-strip`);
			await expect(strip).toHaveCSS("background-image", new RegExp(posterUrl));
			await expect(strip.locator("video")).toHaveCount(0);
			await expect(page.locator(`[data-clipid="${generated[0]!.id}"] video`)).toHaveCount(0);
			await expectVideoFrame(generated[1]!.id);
			await page.screenshot({ path: testInfo.outputPath("server-poster.png") });
			await expect(clip.locator(".tl2-clip-badge")).toHaveCount(0);
			await clip.click();
			if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Timing"]').tap();
			else
				await page
					.locator(".tl2-clippanel")
					.getByRole("button", { name: "Timing", exact: true })
					.click();
			const duration = () => saved.clips.find((c) => c.id === long.id)?.durationSec;
			await page.getByRole("button", { name: "Out back one frame", exact: true }).click();
			await expect.poll(duration).toBeCloseTo(4 - 1 / 30, 5);
			await page.getByRole("button", { name: "Out forward one frame", exact: true }).click();
			await expect.poll(duration).toBe(4);
			await page.getByRole("button", { name: "Out forward one frame", exact: true }).focus();
			await page.keyboard.press("Enter");
			expect(duration()).toBe(4);
			await close();
			await expect
				.poll(
					() =>
						Array.isArray(editorState?.media_assets) &&
						editorState.media_assets.some(
							(asset: { url: string }) => asset.url === long.video!.url,
						),
				)
				.toBe(true);
			// Reload preserves the server poster through the Rust engine and editor state.
			await expect
				.poll(
					() =>
						editorState.media_assets?.find((asset) => asset.url === generated[0]!.video!.url)
							?.poster,
				)
				.toBe(posterUrl);
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await expect(strip).toHaveCSS("background-image", new RegExp(posterUrl));
			// Stop autosave before replacing persisted data with the legacy fixture.
			await page.goto("about:blank");
			// Older saved clips used the orange scene image; reload must show blue video.
			delete editorState.media_assets!.find((asset) => asset.url === generated[0]!.video!.url)!
				.poster;
			saved.clips.find((c) => c.id === long.id)!.video!.thumb = source;
			const admitted = editorState!.media_assets!.find(
				(asset: { url: string }) => asset.url === long.video!.url,
			)!;
			admitted.thumb = source;
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			for (const generatedClip of generated) await expectVideoFrame(generatedClip.id);
			await expect(page.locator(`[data-clipid="${long.id}"] .tl2-clip-badge`)).toHaveCount(0);
			expect(duration()).toBe(4);
			await page.screenshot({ path: testInfo.outputPath("generated-video-bounded.png") });
		} finally {
			await context.close();
		}
	});
