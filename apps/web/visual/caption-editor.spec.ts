import { readFile } from "node:fs/promises";
import { chooseOption } from "./options.ts";
import { expect, test, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";
import { captureCaptionResult, type Clip } from "@maleo/shared";
import type { EditorDoc } from "@maleo/shared/editor";
import type { CaptionJobInput } from "../src/api/caption-jobs.ts";
import { editorChatProjectDetail, EDITOR_CHAT_PROJECT_ID } from "./fixtures/editor-chat-data.ts";

async function captionAction(page: Page, item: RegExp | string): Promise<void> {
	await page.getByRole("button", { name: "Caption actions", exact: true }).click();
	await page.getByRole("menuitem", { name: item }).click();
}

const caret = (field: ReturnType<Page["locator"]>, at: number) =>
	field.evaluate((el, offset) => {
		const area = el as HTMLTextAreaElement;
		area.focus();
		area.setSelectionRange(offset, offset);
	}, at);

for (const width of [1440, 320]) {
	test.describe(`caption editor ${width}px`, () => {
		test.use({
			viewport: { width, height: 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
		});
		test("imports, corrects, selects, styles, deletes and undoes through production editor", async ({
			page,
			context,
		}) => {
			await replayApi(context, resolve(import.meta.dirname, "fixtures/api.har"));
			await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
			await expect(page.locator(".tl2-timeline")).toBeVisible({ timeout: 60_000 });
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(page.getByRole("tab", { name: "Transcript", exact: true })).toBeVisible();
			await page.locator('input[type="file"][accept=".srt"]').setInputFiles({
				name: "captions.srt",
				mimeType: "application/x-subrip",
				buffer: Buffer.from(
					"1\n00:00:00,000 --> 00:00:02,000\nHello world\n\n2\n00:00:02,000 --> 00:00:03,000\nNext phrase",
				),
			});
			const rows = page.locator("[data-caption-row]");
			await expect(rows).toHaveCount(2);
			// Results first: with cues, a row is on screen in the panel or phone sheet
			// without scrolling, and generation waits in the header menu.
			await expect(rows.first()).toBeInViewport();
			await expect(page.getByRole("combobox", { name: "Caption source" })).toHaveCount(0);
			const id = await rows.first().getAttribute("data-caption-row");
			expect(id).toMatch(/^caption:/);
			await rows
				.first()
				.getByRole("button", { name: "Select caption at 0:00.0", exact: true })
				.click();
			await expect(rows.nth(1).getByRole("spinbutton")).toHaveCount(0);
			const input = rows.first().getByRole("textbox", { name: "Caption text", exact: true });
			await input.fill("Corrected words\nretain authored break");
			await input.press("ArrowLeft");
			await expect(input).toBeFocused();
			await expect(rows).toHaveCount(2);
			await input.press("Tab");
			await expect(input).toHaveValue("Corrected words\nretain authored break");
			await expect(rows.first()).toHaveAttribute("data-caption-row", id!);
			const end = rows.first().getByRole("spinbutton", { name: "Caption end seconds" });
			await end.fill("1.8");
			await rows
				.first()
				.getByRole("button", { name: "Select caption at 0:00.0", exact: true })
				.click();
			await expect(end).toHaveValue("1.8");
			await page.keyboard.press("ControlOrMeta+z");
			await expect(end).toHaveValue("2");
			const second = rows.nth(1).getByRole("textbox", { name: "Caption text", exact: true });
			await caret(second, 0);
			await second.press("Backspace");
			await expect(rows).toHaveCount(1);
			const merged = rows.first().getByRole("textbox", { name: "Caption text", exact: true });
			await expect(merged).toHaveValue("Corrected words\nretain authored break\nNext phrase");
			await caret(merged, "Corrected words\nretain authored break\n".length);
			await merged.press("Shift+Enter");
			await expect(rows).toHaveCount(1);
			await caret(merged, "Corrected words\nretain authored break\n".length);
			await merged.press("Enter");
			await expect(rows).toHaveCount(2);
			await expect(
				rows.nth(1).getByRole("textbox", { name: "Caption text", exact: true }),
			).toHaveValue("Next phrase");
			// Cmd+Z in a clean caption field undoes the document: split, then the
			// committed line break, then the keyboard merge.
			await page.keyboard.press("ControlOrMeta+z");
			await expect(rows).toHaveCount(1);
			await expect(merged).toHaveValue("Corrected words\nretain authored break\n\nNext phrase");
			await page.keyboard.press("ControlOrMeta+z");
			await expect(merged).toHaveValue("Corrected words\nretain authored break\nNext phrase");
			await page.keyboard.press("ControlOrMeta+z");
			await expect(rows).toHaveCount(2);
			await rows
				.first()
				.getByRole("button", { name: "Select caption at 0:00.0", exact: true })
				.click();
			await page.getByRole("tab", { name: "Style", exact: true }).click();
			await expect(
				page.getByRole("switch", { name: "Enable captions", exact: true }),
			).toBeVisible();
			await page.getByRole("button", { name: "This caption", exact: true }).click();
			await expect(page.getByRole("button", { name: "This caption", exact: true })).toHaveAttribute(
				"aria-pressed",
				"true",
			);
			await chooseOption(
				page.getByRole("combobox", { name: "Caption style", exact: true }),
				"Word pop",
			);
			await expect(
				page.getByRole("combobox", { name: "Caption style", exact: true }),
			).toHaveAttribute("data-value", "Word pop");
			await page.getByRole("button", { name: "Reset cue style", exact: true }).click();
			await page.getByRole("tab", { name: "Transcript", exact: true }).click();
			await rows.first().getByRole("button", { name: "Delete", exact: true }).click();
			await expect(rows).toHaveCount(1);
			await page.keyboard.press("ControlOrMeta+z");
			await expect(rows).toHaveCount(2);
			await expect(
				rows.first().getByRole("textbox", { name: "Caption text", exact: true }),
			).toHaveValue("Corrected words\nretain authored break");
			await page.locator('input[type="file"][accept=".srt"]').setInputFiles({
				name: "invalid.srt",
				mimeType: "application/x-subrip",
				buffer: Buffer.from("invalid"),
			});
			await expect(page.getByRole("alert").filter({ hasText: "No valid captions" })).toBeVisible();
			await expect(rows).toHaveCount(2);
			await expect(page.locator('[data-vui-slot="row"][data-lane-group="caption"]')).toHaveCount(1);
			const clip = page.locator(".tl2-clip-caption").first();
			const fit = await clip.evaluate((el) => {
				const label = el.querySelector<HTMLElement>(".tl2-clip-label")!;
				return {
					wraps: label.scrollHeight > label.clientHeight + 1,
					inside: label.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1,
					nowrap: getComputedStyle(label).whiteSpace === "nowrap",
				};
			});
			expect(fit).toEqual({ wraps: false, inside: true, nowrap: true });
			if (width === 1440) {
				const icon = (group: string) =>
					page
						.locator(`.tl2-gutter-row[data-lane-group="${group}"] .tl2-track-ic`)
						.first()
						.evaluate((el) => ({ svg: el.innerHTML, color: getComputedStyle(el).color }));
				const caption = await icon("caption");
				const text = await page.locator('.tl2-gutter-row[data-lane-group="text"]').count();
				if (text) expect(caption).not.toEqual(await icon("text"));
				expect(caption.svg).toContain("svg");
			}
			const downloaded = page.waitForEvent("download");
			await captionAction(page, "Export SRT");
			const download = await downloaded;
			const path = await download.path();
			expect(await readFile(path!, "utf8")).toContain(
				"00:00:00,000 --> 00:00:02,000\nCorrected words\nretain authored break",
			);
			// Canvas: a click on the rendered caption selects its cue without moving the
			// playhead; a double click opens Captions with that cue's text focused.
			await page.screenshot({ path: `/tmp/maleo-caption-editor-${width}.png`, fullPage: true });
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			const rendered = page.locator(".tl2-canvas [data-caption-cue]").first();
			await expect(rendered).toBeVisible();
			const cueId = await rendered.getAttribute("data-caption-cue");
			const playheadLeft = () =>
				page
					.locator(".tl2-playhead")
					.first()
					.evaluate((el) => getComputedStyle(el).transform + el.style.left);
			const before = await playheadLeft();
			const cueClip = page.locator(`[data-clipid="${cueId}"]`);
			await cueClip.focus();
			await page.keyboard.press("Escape");
			await expect(cueClip).not.toHaveClass(/(^|\s)on(\s|$)/);
			if (width === 320) await rendered.tap({ force: true });
			else await rendered.click({ force: true });
			await expect(cueClip).toHaveClass(/(^|\s)on(\s|$)/);
			expect(await playheadLeft()).toBe(before);
			await rendered.dblclick({ force: true });
			await expect(
				page
					.locator(`[data-caption-row="${cueId}"]`)
					.getByRole("textbox", { name: "Caption text" }),
			).toBeFocused();
		});
		test("generation survives panel closure and reload, then applies once", async ({
			page,
			context,
		}) => {
			await replayApi(context, resolve(import.meta.dirname, "fixtures/api-editor-chat.har"));
			const mediaId = "00000000-0000-4000-8000-000000000090";
			const url = `/api/media/${mediaId}`;
			const source: Clip = {
				id: "audio:7",
				type: "audio",
				startSec: 0,
				durationSec: 2,
				track: 0,
				audio: {
					id: 7,
					kind: "voiceover",
					content: "",
					url,
					start: 0,
					dur: 2,
					track: 0,
					originalDur: 2,
				},
			};
			const fixtureDoc: EditorDoc = {
				schemaVersion: 2,
				clips: [source],
				markers: [],
				trackFlags: {
					0: { group: "audio" },
					...Object.fromEntries(
						Array.from({ length: 7 }, (_, row) => [row + 1, { group: "caption" as const }]),
					),
				},
			};
			let savedDoc = fixtureDoc;
			/* Captions apply through the command log, which the engine checks. */
			await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
				stored: () => savedDoc,
				onSave: (next) => {
					savedDoc = next as typeof savedDoc;
				},
				media: () => [{ id: "speech", label: "Speech", kind: "audio", url, dur: 2 }] as never,
			});
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							project: {
								...editorChatProjectDetail.project,
								editor_state_json: { chat: [] },
							},
							mediaAssets: [{ id: "speech", label: "Speech", kind: "audio", url, dur: 2 }],
							storyboards: [
								{ ...editorChatProjectDetail.storyboards[0], storyboard_json: savedDoc },
							],
						},
					}),
			);
			let submitted: CaptionJobInput | undefined;
			let submissions = 0;
			let done = false;
			await context.route(/\/captions\/jobs(\?|$)/, async (route) => {
				submitted = route.request().postDataJSON();
				submissions++;
				await route.fulfill({ status: 202, json: { id: `caption-job-${submissions}` } });
			});
			const binding = {
				clipId: source.id,
				mediaId,
				mediaRevision: mediaId,
				sourceStartSec: 0,
				sourceEndSec: 2,
			};
			await context.route(/\/captions\/jobs\/caption-job-\d+(\?|$)/, (route) =>
				route.fulfill({
					json: {
						id: `caption-job-${submissions}`,
						status: submissions === 3 ? "failed" : done ? "done" : "processing",
						stage: done ? "ready" : "recognizing-speech",
						error: submissions === 3 ? "Recognition failed. Retry generation." : null,
						language: "auto",
						sourceCount: 1,
						context: {
							...captureCaptionResult(submitted!.doc, {
								startSec: 0,
								endSec: 2,
								sources: [binding],
							}),
							replaceEdited: submitted!.replaceEdited,
						},
						result: done
							? {
									type: "captions",
									language: "auto",
									detectedLanguage: "en",
									engine: "whisper.cpp",
									model: "base",
									fromCache: false,
									cues:
										submissions > 1 && submissions < 5
											? []
											: [
													{
														id: "caption:worker-proof",
														type: "caption",
														startSec: 0,
														durationSec: 2,
														track: 1,
														caption: {
															text: "Recognized speech",
															words: [
																{ text: "Recognized", startSec: 0, endSec: 0.9 },
																{ text: "speech", startSec: 1, endSec: 2 },
															],
															sources: [binding],
															provenance: {
																origin: "recognized",
																wordTimingOrigin: "recognized",
																engine: "whisper.cpp",
																model: "base",
																runId: `caption-job-${submissions}`,
															},
															protection: {
																text: false,
																timing: false,
																segmentation: false,
																style: false,
															},
															revision: 0,
															groupId: `caption-job-${submissions}`,
															status: "current",
														},
													},
												],
								}
							: null,
					},
				}),
			);
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await expect(page.locator(".tl2-timeline")).toBeVisible({ timeout: 60_000 });
			const captionLanes = page.locator('[data-vui-slot="row"][data-lane-group="caption"]');
			await expect(captionLanes).toHaveCount(1);
			await page.locator('[data-clipid="audio:7"]').click();
			if (width === 320)
				await page.getByRole("button", { name: "Clip actions", exact: true }).click();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			const sourceControl = page.getByRole("combobox", { name: "Caption source", exact: true });
			await expect(sourceControl).toContainText("Speech · 0:00");
			await expect(sourceControl).not.toContainText("audio:7");
			await expect(page.getByText("Range 0:00 – 0:02", { exact: true })).toBeVisible();
			await expect(page.getByRole("switch", { name: "Preserve edited captions" })).toHaveCount(0);
			await page.getByRole("button", { name: "Generate captions", exact: true }).click();
			await expect(
				page.getByRole("status").filter({ hasText: "Recognizing speech" }),
			).toBeVisible();
			expect(submitted?.source).toEqual({ clipId: "audio:7" });
			expect(submitted?.replaceEdited).toBe(false);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			done = true;
			await expect(page.locator('[data-clipid="caption:worker-proof"]')).toHaveCount(1);
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(page.locator("[data-caption-row]")).toHaveCount(1);
			await expect(page.getByRole("textbox", { name: "Caption text", exact: true })).toHaveValue(
				"Recognized speech",
			);
			expect(submissions).toBe(1);
			const rows = page.locator("[data-caption-row]");
			const audio = page.locator('[data-clipid="audio:7"]');
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await audio.click();
			await audio.focus();
			await audio.press("ArrowRight");
			if (width === 320)
				await page.getByRole("button", { name: "Clip actions", exact: true }).click();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await rows
				.first()
				.getByRole("button", { name: /^Select caption at/ })
				.click();
			await expect(
				rows.first().getByRole("spinbutton", { name: "Caption start seconds" }),
			).not.toHaveValue("0");
			await page.keyboard.press("ControlOrMeta+z");
			await expect(
				rows.first().getByRole("spinbutton", { name: "Caption start seconds" }),
			).toHaveValue("0");
			await expect(
				page.getByRole("button", { name: "Generate captions", exact: true }),
			).toHaveCount(0);
			await captionAction(page, "Regenerate…");
			await expect(page.getByText("Range 0:00 – 0:02", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Cancel", exact: true }).click();
			await expect(rows).toHaveCount(1);
			expect(submissions).toBe(1);
			await captionAction(page, "Regenerate…");
			await page
				.getByRole("button", { name: "Replace edited captions in this range", exact: true })
				.click();
			await page.getByRole("button", { name: "Regenerate", exact: true }).click();
			await expect(page.getByRole("status").filter({ hasText: "No speech found" })).toBeVisible();
			expect(submitted?.replaceEdited).toBe(true);
			await expect(rows).toHaveCount(1);
			await captionAction(page, "Regenerate…");
			await page.getByRole("button", { name: "Regenerate", exact: true }).click();
			expect(submitted?.replaceEdited).toBe(false);
			await expect(
				page.getByText("Recognition failed. Retry generation.", { exact: true }),
			).toBeVisible();
			await expect(rows).toHaveCount(1);
			await captionAction(page, "Regenerate…");
			await page.getByRole("button", { name: "Regenerate", exact: true }).click();
			await expect(page.getByRole("status").filter({ hasText: "No speech found" })).toBeVisible();
			await expect(rows).toHaveCount(1);
			const transcript = rows.first().getByRole("textbox", { name: "Caption text", exact: true });
			await transcript.fill("Corrected saved speech");
			await rows
				.first()
				.getByRole("button", { name: "Select caption at 0:00.0", exact: true })
				.click();
			await page.getByRole("tab", { name: "Style", exact: true }).click();
			await chooseOption(
				page.getByRole("combobox", { name: "Caption style", exact: true }),
				"Word pop",
			);
			await expect.poll(() => savedDoc.captions?.style).toBe("Word pop");
			await expect
				.poll(() => savedDoc.clips.find((clip) => clip.type === "caption")?.caption?.text)
				.toBe("Corrected saved speech");
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(page.getByRole("textbox", { name: "Caption text", exact: true })).toHaveValue(
				"Corrected saved speech",
			);

			await page.getByRole("tab", { name: "Style", exact: true }).click();
			await expect(
				page.getByRole("combobox", { name: "Caption style", exact: true }),
			).toHaveAttribute("data-value", "Word pop");
			savedDoc = {
				...savedDoc,
				clips: savedDoc.clips.map((clip) =>
					clip.caption ? { ...clip, caption: { ...clip.caption, status: "needs-refresh" } } : clip,
				),
			};
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await page.getByRole("button", { name: "Captions", exact: true }).click();
			await expect(rows.first().getByText("Needs refresh", { exact: true })).toBeVisible();
			await page.getByRole("button", { name: "Caption actions", exact: true }).click();
			await expect(page.getByRole("menuitem", { name: /^Export SRT/ })).toHaveAttribute(
				"aria-disabled",
				"true",
			);
			await page.keyboard.press("Escape");
			await rows
				.first()
				.getByRole("button", { name: /^Select caption at/ })
				.click();
			await expect(
				rows.first().getByText("Regenerate this source or unlink the caption.", { exact: true }),
			).toBeVisible();
			await rows.first().getByRole("button", { name: "Unlink", exact: true }).click();
			await page.getByRole("button", { name: "Caption actions", exact: true }).click();
			await expect(page.getByRole("menuitem", { name: /^Export SRT/ })).not.toHaveAttribute(
				"aria-disabled",
				"true",
			);
			await page.keyboard.press("Escape");
			await expect(page.getByRole("textbox", { name: "Caption text", exact: true })).toHaveValue(
				"Corrected saved speech",
			);
			await rows
				.first()
				.getByRole("button", { name: /^Select caption at/ })
				.click();
			await rows.first().getByRole("button", { name: "Delete", exact: true }).click();
			await expect(rows).toHaveCount(0);
			const replace = page.getByRole("button", {
				name: "Replace edited captions in this range",
				exact: true,
			});
			await expect(replace).toBeVisible();
			await page.getByRole("button", { name: "Regenerate", exact: true }).click();
			await expect(page.getByRole("status").filter({ hasText: "No captions added" })).toBeVisible();
			await expect(rows).toHaveCount(0);
			await replace.focus();
			await page.keyboard.press("Enter");
			await expect(replace).toHaveAttribute("aria-pressed", "true");
			await page.getByRole("button", { name: "Regenerate", exact: true }).click();
			await expect(rows).toHaveCount(1);
			await expect(page.locator('[data-clipid="caption:worker-proof"]')).toHaveCount(1);
			await expect.poll(() => savedDoc.captionSet?.deletedRanges.length).toBe(0);
			await expect(captionLanes).toHaveCount(1);
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await expect(captionLanes).toHaveCount(1);
			await expect(page.locator('[data-clipid="caption:worker-proof"]')).toHaveCount(1);
			const savedCue = savedDoc.clips.find((clip) => clip.type === "caption")!;
			savedDoc = {
				...savedDoc,
				trackFlags: fixtureDoc.trackFlags,
				clips: savedDoc.clips.map((clip) =>
					clip.type === "caption" ? { ...clip, track: 7 } : clip,
				),
			};
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await expect(captionLanes).toHaveCount(1);
			await expect
				.poll(() => savedDoc.clips.find((clip) => clip.type === "caption"))
				.toEqual({ ...savedCue, track: 1 });
			// Legacy gaps migrate before persistence mounts. Duplication must fence
			// against the stored caption state, not the migrated editing projection.
			savedDoc = {
				...savedDoc,
				trackFlags: { 0: { group: "audio" }, 7: { group: "caption" } },
				clips: savedDoc.clips.map((clip) =>
					clip.type === "caption"
						? { ...clip, track: 7, caption: { ...clip.caption!, status: "current" } }
						: clip,
				),
			};
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await page.locator('[data-clipid="audio:7"]').click();
			await page.keyboard.press("ControlOrMeta+d");
			await expect(page.locator('[data-clipid^="audio:"]')).toHaveCount(2);
			await expect
				.poll(() => savedDoc.clips.filter((clip) => clip.type === "audio").length)
				.toBe(2);
			await expect
				.poll(() => savedDoc.clips.filter((clip) => clip.type === "caption").length)
				.toBe(2);
			await page.reload();
			await expect(page.locator(".tl2-timeline")).toBeVisible();
			await expect(page.locator('[data-clipid^="audio:"]')).toHaveCount(2);
			await expect(page.locator(".tl2-clip-caption")).toHaveCount(2);
		});
	});
}
