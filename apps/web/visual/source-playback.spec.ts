import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`source rate/pitch cancel, reverse, undo and reload at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(60_000);
			const phone = width !== 1440;
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: width === 320 ? 740 : width === 844 ? 390 : 900 },
				hasTouch: phone,
				isMobile: phone,
				colorScheme: theme,
				reducedMotion: "reduce",
			});
			try {
				await replayApi(context, HAR);
				const bytes = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=32x32:r=30:d=8",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=880:sample_rate=48000:duration=8",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-c:a",
					"aac",
					"-movflags",
					"frag_keyframe+empty_moov",
					"-f",
					"mp4",
					"pipe:1",
				]);
				const sound = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"sine=frequency=880:sample_rate=48000:duration=16",
					"-c:a",
					"aac",
					"-movflags",
					"frag_keyframe+empty_moov",
					"-f",
					"mp4",
					"pipe:1",
				]);
				const silent = execFileSync("ffmpeg", [
					"-v",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=blue:s=32x32:r=30:d=8",
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
				const silentUrl = "/api/media/66666666-6666-4666-8666-666666666666";
				const sourceId = "11111111-1111-4111-8111-111111111111",
					audioId = "55555555-5555-4555-8555-555555555555";
				const url = `/api/media/${sourceId}`,
					audioUrl = `/api/media/${audioId}`;
				await context.route("**/api/media/*", (route) =>
					route.fulfill({
						body:
							new URL(route.request().url()).pathname === silentUrl
								? silent
								: new URL(route.request().url()).pathname === url ||
									  jobs.get(new URL(route.request().url()).pathname.split("/").at(-1)!)?.operation
											.type === "reverse"
									? bytes
									: sound,
						contentType: "video/mp4",
					}),
				);
				const first = editorChatProjectDetail.storyboards[0]!;
				let saved = {
					...first.storyboard_json,
					...toTimelineDoc(
						[
							{
								id: 1,
								name: "Base",
								shot: "Wide",
								move: "Static",
								vis: "",
								vo: "",
								img: true,
								dur: 8,
								src: "",
							},
						],
						[
							{
								id: 98,
								kind: "video",
								url,
								mediaAssetId: "original",
								label: "Camera",
								start: 0,
								dur: 4,
								mediaStartSec: 1,
								track: 0,
								volume: 0.5,
							},
							{
								id: 97,
								kind: "video",
								url: silentUrl,
								mediaAssetId: "silent",
								start: 6,
								dur: 1,
								track: 1,
							},
							{
								id: 96,
								kind: "video",
								url: "/api/media/01a00000-0000-7000-8000-000000000096",
								mediaAssetId: "01a00000-0000-7000-8000-000000000096",
								label: "Uploading",
								start: 20,
								dur: 2,
								track: 1,
							},
						],
						[],
						[
							{
								id: 99,
								kind: "music",
								url: audioUrl,
								mediaAssetId: "sound",
								content: "",
								start: 10,
								dur: 4,
								mediaStartSec: 1,
								volume: 0.7,
							},
						],
					),
				};
				let assets = [
					{
						id: "original",
						kind: "video",
						url,
						source: "upload",
						label: "Camera",
						metadata: {
							originalFilename: "Camera.mp4",
							kind: "video",
							byteSize: bytes.length,
							duration: 8,
							hasAudio: true,
						},
					},
					{
						id: "sound",
						kind: "audio",
						url: audioUrl,
						source: "upload",
						label: "Sound",
						metadata: {
							originalFilename: "Sound.m4a",
							kind: "audio",
							byteSize: sound.length,
							duration: 8,
							hasAudio: true,
						},
					},
				];
				assets.push({
					id: "01a00000-0000-7000-8000-000000000096",
					kind: "video",
					url: "/api/media/01a00000-0000-7000-8000-000000000096",
					source: "upload",
					label: "Uploading",
					metadata: {
						originalFilename: "Uploading.mp4",
						kind: "video",
						byteSize: bytes.length,
						duration: 2,
						hasAudio: true,
					},
				});
				assets.push({
					id: "silent",
					kind: "video",
					url: silentUrl,
					source: "upload",
					label: "Silent",
					metadata: {
						originalFilename: "Silent.mp4",
						kind: "video",
						byteSize: silent.length,
						duration: 8,
						hasAudio: false,
					},
				});
				await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
					stored: () => saved,
					onSave: (next) => {
						saved = next as typeof saved;
					},
					media: () => assets as never,
					onMedia: (next) => {
						assets = next as typeof assets;
					},
				});
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
					(route) =>
						route.fulfill({
							json: {
								...editorChatProjectDetail,
								mediaAssets: assets,
								storyboards: [{ ...first, storyboard_json: saved }],
							},
						}),
				);
				let ready = false,
					cancelled = 0;
				const jobs = new Map<
					string,
					{
						sourceMediaId: string;
						sourceRevision: string;
						operation: {
							type: string;
							startSec: number;
							durationSec: number;
							playbackRate?: number;
						};
					}
				>();
				await context.route(
					new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/media/processing`),
					async (route) => {
						if (route.request().method() === "POST") {
							const request = route.request().postDataJSON(),
								id = crypto.randomUUID();
							expect(request.operation).toMatchObject({ startSec: 1, durationSec: 4 });
							jobs.set(id, request);
							await route.fulfill({ status: 202, json: { id } });
							return;
						}
						if (route.request().method() === "DELETE") {
							cancelled++;
							await route.fulfill({ json: { ok: true } });
							return;
						}
						const id = new URL(route.request().url()).pathname.split("/").at(-1)!,
							request = jobs.get(id)!;
						await route.fulfill({
							json: {
								id,
								status: ready ? "ready" : "processing",
								...request,
								error: null,
								...(ready
									? {
											url: `/api/media/${id}`,
											metadata: {
												originalFilename: "Processed",
												byteSize: sound.length,
												kind: request.operation.type === "audio" ? "audio" : "video",
												duration:
													request.operation.durationSec / (request.operation.playbackRate ?? 1),
												hasAudio: true,
											},
										}
									: {}),
							},
						});
					},
				);
				const page = await context.newPage();
				const open = async (type: "video" | "audio", id = type === "video" ? 98 : 99) => {
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await page.locator(`[data-clipid="${type}:${id}"]`).click();
					if (phone) await page.locator(`.tl2-clipbar-groups [aria-label="Timing"]`).tap();
					else
						await page
							.locator(".tl2-clippanel")
							.getByRole("button", { name: "Timing", exact: true })
							.click();
					const playback = page.getByRole("button", { name: /^Playback/ });
					if ((await playback.getAttribute("aria-expanded")) !== "true") await playback.click();
				};
				const video = () => saved.clips.find((clip) => clip.id === "video:98")?.video;
				const audio = () => saved.clips.find((clip) => clip.id === "audio:99")?.audio;
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await open("video");
				const rate = page.getByRole("spinbutton", { name: "Rate (%)", exact: true });
				await rate.fill("50");
				await expect(
					page.getByRole("button", { name: "Cancel processing", exact: true }),
				).toBeVisible();
				await expect(rate).toBeDisabled();
				expect(video()?.dur).toBe(4);
				await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
				await expect.poll(() => cancelled).toBe(1);
				await expect(rate).toBeEnabled();
				ready = true;
				await page.getByRole("switch", { name: "Preserve pitch", exact: true }).click();
				await rate.fill("50");
				await expect.poll(() => video()?.dur).toBe(8);
				expect(video()?.mediaStartSec).toBe(1);
				expect(video()?.layout?.preservePitch).toBe(true);
				expect(video()?.volume).toBe(0.5);
				expect(saved.clips.find((clip) => clip.id === "video:97")?.startSec).toBe(6);
				if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => video()?.dur).toBe(4);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => video()?.dur).toBe(8);
				await page.reload();
				await open("video");
				await expect(rate).toHaveValue("50");
				await page.getByRole("button", { name: "Reverse", exact: true }).click();
				await expect.poll(() => video()?.layout?.reverse).toBe(true);
				expect(video()?.layout?.audioMedia?.reverse).toBe(true);
				expect(video()?.dur).toBe(8);
				expect(video()?.url).toBe(url);
				await page.screenshot({ path: testInfo.outputPath("source-playback-ready.png") });
				if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				await open("audio");
				await page.getByRole("switch", { name: "Preserve pitch", exact: true }).click();
				await rate.fill("200");
				await expect.poll(() => audio()?.dur).toBe(2);
				expect(audio()?.mediaStartSec).toBe(1);
				expect(audio()?.start).toBe(10);
				expect(audio()?.volume).toBe(0.7);
				expect(audio()?.audioMedia?.playbackRate).toBe(2);
				expect(audio()?.preservePitch).toBe(true);
				const back = async () => {
					if (phone) await page.locator('.tl2-clipbar [aria-label="Back"]').click();
				};
				const link = () => video()?.layout?.sourceAudioExtraction;
				const extract = async () => {
					const count = jobs.size;
					await page
						.getByRole("button", { name: "Extract audio", exact: true })
						.click({ clickCount: 2 });
					await expect.poll(() => link()?.audioClipId).toBeTruthy();
					expect(jobs.size - count).toBe(1);
					return link()!.audioClipId;
				};
				await back();
				await open("video");
				ready = false;
				await page.getByRole("button", { name: "Extract audio", exact: true }).click();
				await expect(
					page.getByRole("button", { name: "Extract audio", exact: true }),
				).toBeDisabled();
				await page.getByRole("button", { name: "Cancel processing", exact: true }).click();
				await expect.poll(() => cancelled).toBe(2);
				expect(link()).toBeUndefined();
				expect(video()?.volume).toBe(0.5);
				ready = true;
				const firstExtracted = await extract();
				expect(video()?.volume).toBe(0);
				expect(saved.clips.find((c) => c.id === firstExtracted)?.audio).toMatchObject({
					start: 0,
					dur: 8,
					volume: 0.5,
					mediaStartSec: 0,
				});
				expect(link()?.source).toMatchObject({
					startSec: 1,
					durationSec: 4,
					playbackRate: 0.5,
					reverse: true,
				});
				await expect
					.poll(() => assets.some((a) => a.kind === "audio" && a.label === "Camera audio"))
					.toBe(true);
				await back();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => link()).toBeUndefined();
				expect(saved.clips.some((c) => c.id === firstExtracted)).toBe(false);
				expect(video()?.volume).toBe(0.5);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => link()?.audioClipId).toBe(firstExtracted);
				await page.reload();
				await open("video");
				await page.getByRole("switch", { name: "Preserve pitch", exact: true }).click();
				await expect.poll(() => video()?.layout?.preservePitch).toBe(false);
				await page.getByRole("button", { name: "Recover source audio", exact: true }).click();
				await expect.poll(() => link()).toBeUndefined();
				expect(video()?.volume).toBe(0.5);
				expect(saved.clips.some((c) => c.id === firstExtracted)).toBe(false);
				expect(video()?.layout?.preservePitch).toBe(true);
				expect(video()?.layout?.audioMedia?.preservePitch).toBe(true);
				for (const choice of ["Keep", "Discard"] as const) {
					const extracted = await extract();
					await back();
					await open("audio", Number(extracted.split(":")[1]));
					await page.getByRole("button", { name: /^Timeline timing/ }).click();
					await page.getByRole("spinbutton", { name: "Start (s)", exact: true }).fill("15");
					await expect.poll(() => saved.clips.find((c) => c.id === extracted)?.startSec).toBe(15);
					await back();
					await open("video");
					await page.getByRole("button", { name: "Recover source audio", exact: true }).click();
					await expect(
						page.getByText("Extracted audio changed. Choose whether to keep or discard it.", {
							exact: true,
						}),
					).toBeVisible();
					await page
						.getByRole("button", { name: `${choice} extracted audio`, exact: true })
						.click();
					await expect.poll(() => link()).toBeUndefined();
					expect(video()?.volume).toBe(0.5);
					expect(saved.clips.some((c) => c.id === extracted)).toBe(choice === "Keep");
				}
				expect(audio()?.dur).toBe(2);
				expect(audio()?.volume).toBe(0.7);
				await back();
				await open("video", 97);
				await expect(
					page.getByRole("button", { name: "Extract audio", exact: true }),
				).toBeDisabled();
				await expect(
					page.getByText("This source has no audio to extract.", { exact: true }),
				).toBeVisible();
				const jobCount = jobs.size;
				await rate.fill("50");
				await expect.poll(() => saved.clips.find((c) => c.id === "video:97")?.durationSec).toBe(2);
				expect(jobs.size).toBe(jobCount);
				expect(saved.clips.find((c) => c.id === "video:97")?.startSec).toBe(6);
				// A clip whose file is still uploading has no server source to process yet.
				await back();
				await open("video", 96);
				await expect(
					page.getByText("Available once the upload finishes.", { exact: true }),
				).toBeVisible();
				await expect(rate).toBeDisabled();
				await expect(page.getByRole("button", { name: "Reverse", exact: true })).toBeDisabled();
				await expect(
					page.getByRole("button", { name: "Extract audio", exact: true }),
				).toBeDisabled();
			} finally {
				await context.close();
			}
		});
