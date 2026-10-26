import { chooseOption } from "./options.ts";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { toTimelineDoc, type TrackFlags } from "@maleo/shared";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
for (const width of [1440, 320, 844])
	for (const theme of ["light", "dark"] as const)
		test(`ordinary key controls undo, copy and reload at ${width}px ${theme}`, async ({
			browser,
		}, testInfo) => {
			test.setTimeout(90_000);
			const phone = width !== 1440,
				context = await browser.newContext({
					baseURL: "http://127.0.0.1:3031",
					viewport: { width, height: width === 844 ? 390 : phone ? 740 : 900 },
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
				const url = "/api/media/11111111-1111-4111-8111-111111111111";
				await context.route("**/api/media/*", (route) =>
					route.fulfill({ body: bytes, contentType: "video/mp4" }),
				);
				const first = editorChatProjectDetail.storyboards[0]!;
				/* Read back after a save; the fixture starts with no flags set. */
				const noTrackFlags: TrackFlags = {};
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
						[98, 97].map((id) => ({
							id,
							kind: "video" as const,
							url,
							mediaAssetId: "original",
							label: "Camera",
							start: 0,
							dur: 4,
							track: id === 98 ? 0 : 1,
						})),
					),
					trackFlags: noTrackFlags,
				};
				const assets = [
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
							hasAudio: false,
						},
					},
				];
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
								mediaAssets: assets,
								storyboards: [{ ...first, storyboard_json: saved }],
							},
						}),
				);
				const page = await context.newPage(),
					errors: string[] = [];
				page.on("pageerror", (error) => errors.push(error.message));
				const open = async (id: number) => {
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await page.locator(`[data-clipid="video:${id}"]`).click();
					if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
					else
						await page
							.locator(".tl2-clippanel")
							.getByRole("button", { name: "Transform", exact: true })
							.click();
				};
				const keys = (id = 98) =>
					saved.clips.find((c) => c.id === `video:${id}`)?.video?.layout?.animation?.tracks.xPct;
				// Back closes the phone property sheet; with no sheet open there is nothing to close.
				const close = async () => {
					const back = page.locator('.tl2-clipbar [aria-label="Back"]');
					if (phone && (await back.count())) await back.click();
				};
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				expect(errors).toEqual([]);
				await open(98);
				// OpenCut-style rows: one keyframe toggle before each row label, no ‹ › buttons.
				const property = page.getByRole("group", { name: "Position", exact: true });
				const metrics = await property.evaluate((el) => {
					const label = el.querySelector(".ui-insp-label")!.getBoundingClientRect();
					const value = el.querySelector(".ui-insp-control")!.getBoundingClientRect();
					const toggle = el.querySelector(".tl2-key-toggle")!.getBoundingClientRect();
					return {
						labelBottom: label.bottom,
						valueTop: value.top,
						toggleRight: toggle.right,
						labelLeft: label.left,
					};
				});
				expect(metrics.valueTop).toBeGreaterThanOrEqual(metrics.labelBottom);
				expect(metrics.toggleRight).toBeLessThanOrEqual(metrics.labelLeft);
				const field = property.getByRole("spinbutton", { name: "X offset", exact: true });
				const toggle = () =>
					page
						.getByRole("group", { name: "Position", exact: true })
						.getByRole("button", { name: "Position keyframe", exact: true });
				await expect(field).toBeVisible();
				await expect(toggle()).toHaveAttribute("aria-pressed", "false");
				if (phone) {
					const box = (await toggle().boundingBox())!;
					expect(box.height).toBeGreaterThanOrEqual(44);
					expect(box.width).toBeGreaterThanOrEqual(44);
					expect(box.x).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width).toBeLessThanOrEqual(width);
				}
				await toggle().click();
				await expect(toggle()).toHaveAttribute("aria-pressed", "true");
				await field.fill("20");
				await page.keyboard.press("Tab");
				await expect.poll(() => keys()?.[0]?.v).toBe(20);
				await close();
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.[0]?.v).toBe(0);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => keys()?.[0]?.v).toBe(20);
				// A ◆ on the selected clip selects a moment; timing, easing and removal happen on the timeline.
				const moment = (seconds: string) =>
					page.getByRole("button", {
						name: new RegExp(`^Keyframe at ${seconds.replace(".", "\\.")} seconds`),
					});
				const pick = async (seconds: string) => {
					// Keyboard selection: a phone-landscape tap here also reaches the canvas box beneath (noted in tasks.md).
					await moment(seconds).scrollIntoViewIfNeeded();
					await moment(seconds).focus();
					await page.keyboard.press("Enter");
				};
				// Nudge without selecting: on a phone, selecting opens the property sheet, which takes focus.
				await moment("0.000").scrollIntoViewIfNeeded();
				await moment("0.000").focus();
				for (let i = 0; i < 30; i++) await page.keyboard.press("ArrowRight");
				await expect.poll(() => keys()?.[0]?.t).toBeCloseTo(1, 6);
				await open(98);
				await toggle().click();
				await expect.poll(() => keys()?.length).toBe(2);
				// Navigate keys: activating a marker seeks there and the property toggle reads keyed.
				await close();
				await pick("1.000");
				if (!phone) await open(98);
				else await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
				await expect(toggle()).toHaveAttribute("aria-pressed", "true");
				await close();
				// Easing sits beside the selected moment's property in the inspector.
				const easing = async (label: string) => {
					if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
					await chooseOption(page.getByRole("combobox", { name: "Keyframe easing", exact: true }), {
						label,
					});
					await close();
				};
				await easing("Ease in/out");
				await expect.poll(() => keys()?.[1]?.easing).toBe("in-out");

				// The clip context menu copies, pastes and expands keyframes (long-press on a phone).
				const menu = async (id: number) => {
					const clip = page.locator(`[data-clipid="video:${id}"]`);
					await clip.scrollIntoViewIfNeeded();
					if (phone)
						await clip.dispatchEvent("contextmenu", {
							bubbles: true,
							cancelable: true,
							clientX: 10,
							clientY: 10,
						});
					else await clip.click({ button: "right" });
				};
				await menu(98);
				await page.getByRole("menuitem", { name: /Expand keyframes/ }).click();
				await expect(page.locator('[aria-label="Position X keyframes"]')).toBeVisible();
				await menu(98);
				await page.getByRole("menuitem", { name: /Copy keyframes/ }).click();
				await menu(98);
				await page.getByRole("menuitem", { name: /Collapse keyframes/ }).click();
				await expect(page.locator('[aria-label="Position X keyframes"]')).toHaveCount(0);
				await menu(97);
				await page.getByRole("menuitem", { name: /Paste keyframes/ }).click();
				await expect.poll(() => keys(97)).toEqual(keys());
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				await page.locator('[data-clipid="video:98"]').click();
				await expect.poll(() => keys()?.length).toBe(2);
				// Markers are checked before any phone sheet covers the timeline.
				await expect(moment("1.000")).toHaveCount(1);
				await pick("1.000");
				await close();
				const points = page.locator(".tl2-keypoint");
				const marker = page.getByRole("button", { name: /^Keyframe at 1\.000 seconds/ });
				await marker.scrollIntoViewIfNeeded();
				await marker.focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => keys()?.[1]?.t).toBeCloseTo(31 / 30, 6);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.[1]?.t).toBe(1);
				await marker.scrollIntoViewIfNeeded();
				const box = (await marker.boundingBox())!,
					zero = (await points.first().boundingBox())!;
				const x = box.x + box.width / 2,
					y = box.y + box.height / 2,
					delta = box.x - zero.x;
				expect(
					await page.evaluate(
						({ x, y }) =>
							document.elementFromPoint(x, y)?.closest(".tl2-keypoint")?.getAttribute("aria-label"),
						{ x, y },
					),
				).toBe("Keyframe at 1.000 seconds: Position X, Position Y");
				const cdp = phone ? await context.newCDPSession(page) : null;
				const start = async () => {
					if (cdp)
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchStart",
							touchPoints: [{ x, y }],
						});
					else {
						await page.mouse.move(x, y);
						await page.mouse.down();
					}
					await page.waitForTimeout(120);
					if (cdp)
						await cdp.send("Input.dispatchTouchEvent", {
							type: "touchMove",
							touchPoints: [{ x: x + delta, y }],
						});
					else await page.mouse.move(x + delta, y, { steps: 5 });
				};
				const end = async (cancel = false) => {
					if (cdp)
						await cdp.send("Input.dispatchTouchEvent", {
							type: cancel ? "touchCancel" : "touchEnd",
							touchPoints: [],
						});
					else {
						if (cancel) await page.keyboard.press("Escape");
						await page.mouse.up();
					}
				};
				await start();
				await end(true);
				await expect.poll(() => keys()?.[1]?.t).toBe(1);
				await start();
				await end();
				await expect.poll(() => keys()?.[1]?.t).toBeCloseTo(2, 6);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.[1]?.t).toBe(1);
				await marker.scrollIntoViewIfNeeded();
				await marker.focus();
				await page.keyboard.press("Delete");
				await expect.poll(() => keys()?.length).toBe(1);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.length).toBe(2);
				// Preview handles sample the selected ordinary clip and key direct edits.
				const clipBox = page.locator(".tl2-clipbox");
				await expect.poll(() => clipBox.evaluate((el) => el.style.left)).toBe("20%");
				await page.getByRole("button", { name: "Move selected clip", exact: true }).focus();
				await page.keyboard.press("ArrowRight");
				await expect.poll(() => keys()?.find((k) => k.t === 1)?.v).toBe(21);
				await expect.poll(() => clipBox.evaluate((el) => el.style.left)).toBe("21%");
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => keys()?.find((k) => k.t === 1)?.v).toBe(20);
				await expect.poll(() => clipBox.evaluate((el) => el.style.left)).toBe("20%");
				await marker.scrollIntoViewIfNeeded();
				await page.screenshot({ path: testInfo.outputPath("ordinary-key-lanes.png") });
				// On a phone, selecting opens the property sheet over the timeline, so the key is removed from focus.
				if (!phone) {
					await marker.click();
					await expect(marker).toHaveAttribute("aria-pressed", "true");
				}
				await marker.focus();
				await page.keyboard.press("Delete");
				await expect.poll(() => keys()?.length).toBe(1);
				await page.screenshot({ path: testInfo.outputPath("ordinary-key-controls.png") });
				await close();
				const beforeSplit = structuredClone(saved.clips);
				// Split the selected keyed source through the actual main-editor action.
				if (phone) await page.getByRole("button", { name: "Clip actions", exact: true }).click();
				await page.getByRole("button", { name: "Split at playhead", exact: true }).click();
				await expect.poll(() => saved.clips.filter((c) => c.video).length).toBe(3);
				await expect.poll(() => saved.clips.find((c) => c.id === "video:98")?.durationSec).toBe(1);
				const half = saved.clips.find(
					(c) => c.video && c.id !== "video:98" && c.id !== "video:97",
				)!;
				expect(half.startSec).toBe(1);
				expect(half.durationSec).toBe(3);
				expect(half.video?.mediaStartSec).toBe(1);
				expect(keys()?.map((k) => [k.t, k.v])).toEqual([
					[0, 20],
					[1, 20],
				]);
				expect(half.video?.layout?.animation?.tracks.xPct?.map((k) => [k.t, k.v])).toEqual([
					[0, 20],
					[3, 20],
				]);
				await page.getByRole("button", { name: "Undo", exact: true }).click();
				await expect.poll(() => saved.clips).toEqual(beforeSplit);
				await page.getByRole("button", { name: "Redo", exact: true }).click();
				await expect.poll(() => saved.clips.filter((c) => c.video).length).toBe(3);
				await test.step("Reload retains both split halves", async () => {
					await page.reload();
					await page.getByRole("tab", { name: "Timeline", exact: true }).click();
					await expect(page.locator(`[data-clipid="${half.id}"]`)).toBeVisible();
				});
				// Reload clears command history; keep testing the original left half.
				await test.step("Select original split half", async () => {
					const originalHalf = page.locator('[data-clipid="video:98"]');
					await originalHalf.scrollIntoViewIfNeeded();
					expect(
						await originalHalf.evaluate((el) => {
							const r = el.getBoundingClientRect();
							return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
						}),
					).toBe(true);
					if (phone) await originalHalf.tap();
					else await originalHalf.click();
				});
				if (phone) {
					const beforeDuplicate = structuredClone(saved.clips);
					await page.getByRole("button", { name: "Clip actions", exact: true }).click();
					await page.getByRole("button", { name: "Duplicate", exact: true }).click();
					await expect.poll(() => saved.clips.filter((c) => c.video).length).toBe(4);
					const duplicate = saved.clips.find(
						(c) => c.video && !beforeDuplicate.some((b) => b.id === c.id),
					)!;
					expect(duplicate.video?.layout?.animation).toEqual(
						saved.clips.find((c) => c.id === "video:98")?.video?.layout?.animation,
					);
					await page.getByRole("button", { name: "Undo", exact: true }).click();
					await expect.poll(() => saved.clips).toEqual(beforeDuplicate);
					await page.locator('[data-clipid="video:98"]').tap();
					await page.getByRole("button", { name: "Clip actions", exact: true }).tap();
					await page.getByRole("button", { name: "Transition to next clip", exact: true }).tap();
					const transitionPicker = page.getByRole("region", {
						name: "Transition settings",
						exact: true,
					});
					await expect(transitionPicker).toBeVisible();
					expect(saved.clips.some((c) => c.transition)).toBe(false);
					await transitionPicker.locator(".ui-insp-toggle").tap();
					await transitionPicker.getByRole("button", { name: "Dissolve", exact: true }).tap();
					await page.locator('.tl2-clipbar [aria-label="Back"]').tap();
					await expect
						.poll(() => saved.clips.find((c) => c.transition)?.transition?.fromClipId)
						.toBe("video:98");
					await page.getByRole("button", { name: "Undo", exact: true }).click();
					await expect.poll(() => saved.clips).toEqual(beforeDuplicate);
					await expect(page.locator('[data-clipid="video:98"]')).toHaveAttribute(
						"aria-selected",
						"true",
					);
				}
				if (!(await page.locator(".tl2-gutter").count())) {
					if (phone) await page.getByRole("button", { name: "More tools", exact: true }).click();
					await page.getByRole("button", { name: "Track headers", exact: true }).click();
					if (phone)
						await page
							.getByRole("dialog", { name: "Timeline tools", exact: true })
							.getByRole("button", { name: "Close", exact: true })
							.click();
				}
				const track = saved.clips.find((c) => c.id === "video:98")!.track;
				await page.locator(`[data-gutter-row="${track}"] [title="Lock track"]`).click();
				await expect.poll(() => saved.trackFlags?.[track]?.locked).toBe(true);
				await page.reload();
				await page.getByRole("tab", { name: "Timeline", exact: true }).click();
				const lockedClip = page.locator('[data-clipid="video:98"]');
				await lockedClip.focus();
				await page.keyboard.press("Enter");
				if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Transform"]').tap();
				else
					await page
						.locator(".tl2-clippanel")
						.getByRole("button", { name: "Transform", exact: true })
						.click();
				await expect(
					page.getByText("Track locked. Unlock the track to edit this clip.", { exact: true }),
				).toBeVisible();
				await close();
				const locked = page.locator(".tl2-keypoint").first();
				await locked.scrollIntoViewIfNeeded();
				await expect(locked).toHaveAttribute("aria-disabled", "true");
				const before = structuredClone(keys());
				await locked.focus();
				await page.keyboard.press("ArrowRight");
				await page.keyboard.press("Delete");
				await expect.poll(() => keys()).toEqual(before);
				await locked.press("Enter");
				await expect(
					page.getByRole("combobox", { name: "Keyframe easing", exact: true }),
				).toBeDisabled();
				expect(errors).toEqual([]);
			} finally {
				await context.close().catch(() => {});
			}
		});

test("a keyed text overlay shows its lanes and keys a canvas nudge at a non-key time", async ({
	browser,
}) => {
	test.setTimeout(60_000);
	const context = await browser.newContext({
		baseURL: "http://127.0.0.1:3031",
		viewport: { width: 1440, height: 900 },
		reducedMotion: "reduce",
	});
	try {
		await replayApi(context, HAR);
		const first = editorChatProjectDetail.storyboards[0]!;
		const animation = {
			tracks: {
				xPct: [
					{ t: 0.5, v: 10, easing: "in" as const },
					{ t: 2, v: 30 },
				],
				opacity: [
					{ t: 0, v: 0 },
					{ t: 2, v: 1 },
				],
			},
		};
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
				[],
				[
					{
						id: 5,
						content: "Keyed title",
						start: 0,
						dur: 4,
						preset: "plain",
						track: 0,
						layout: { xPct: 10, yPct: 60, widthPct: 60, heightPct: 20, fit: "contain", animation },
					},
				],
			),
		};
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
					json: { ...editorChatProjectDetail, storyboards: [{ ...first, storyboard_json: saved }] },
				}),
		);
		const page = await context.newPage(),
			errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		const keys = () =>
			saved.clips.find((c) => c.id === "text:5")?.text?.layout?.animation?.tracks.xPct;
		await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
		await page.getByRole("tab", { name: "Timeline", exact: true }).click();
		await page.locator('[data-clipid="text:5"]').click();
		// One ◆ per moment on the clip bar; lanes stay collapsed until asked for.
		await expect(page.locator(".tl2-keypoint.moment")).toHaveCount(3);
		await expect(page.locator(`[aria-label="Position X keyframes"]`)).toHaveCount(0);
		const opacity = () =>
			saved.clips.find((c) => c.id === "text:5")?.text?.layout?.animation?.tracks.opacity;
		const moment = page.getByRole("button", {
			name: "Keyframe at 2.000 seconds: Position X, Opacity",
			exact: true,
		});
		const half = page.getByRole("button", { name: /^Keyframe at 0\.500 seconds/ });
		const box = (await moment.boundingBox())!,
			zero = (await page
				.getByRole("button", { name: /^Keyframe at 0\.000 seconds/ })
				.boundingBox())!;
		const perSec = (box.x - zero.x) / 2;
		// Shift-select two moments, then drag one: both move by the same offset, one undo.
		const selectBoth = async () => {
			await half.click();
			await page.keyboard.down("Shift");
			await moment.click();
			await page.keyboard.up("Shift");
		};
		await selectBoth();
		await expect(half).toHaveAttribute("aria-pressed", "true");
		await expect(moment).toHaveAttribute("aria-pressed", "true");
		await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width / 2 + perSec, box.y + box.height / 2, { steps: 6 });
		await page.mouse.up();
		await expect
			.poll(() => [keys()?.[0]?.t, keys()?.[1]?.t, opacity()?.[1]?.t])
			.toEqual([1.5, 3, 3]);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect
			.poll(() => [keys()?.[0]?.t, keys()?.[1]?.t, opacity()?.[1]?.t])
			.toEqual([0.5, 2, 2]);
		// Inspector easing sets every selected key at once; one undo restores them.
		await selectBoth();
		await expect(
			page.getByRole("combobox", { name: "Keyframe easing", exact: true }),
		).toHaveAttribute("data-value", "mixed");
		await expect(
			page.locator(".tl2-toolbar").getByRole("button", { name: /easing|curve/i }),
		).toHaveCount(0);

		await chooseOption(page.getByRole("combobox", { name: "Keyframe easing", exact: true }), {
			label: "Hold",
		});
		await expect
			.poll(() => [keys()?.[0]?.easing, keys()?.[1]?.easing, opacity()?.[1]?.easing])
			.toEqual(["hold", "hold", "hold"]);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect.poll(() => [keys()?.[0]?.easing, keys()?.[1]?.easing]).toEqual(["in", undefined]);
		// Lanes expand from the clip's context menu.
		// Dispatched on the bar itself: its ◆ markers and trim handles cover most of a short text lane.
		await page.locator('[data-clipid="text:5"]').dispatchEvent("contextmenu", {
			bubbles: true,
			cancelable: true,
			clientX: 400,
			clientY: 400,
		});
		await page.getByRole("menuitem", { name: /Expand keyframes/ }).click();
		await expect(page.locator(`[aria-label="Position X keyframes"]`)).toBeVisible();
		await expect(page.locator(`[aria-label="Opacity keyframes"]`)).toBeVisible();
		await page.getByRole("button", { name: "Move selected clip", exact: true }).focus();
		await page.keyboard.press("ArrowRight");
		// Selecting the 2 s moment parked the playhead there, so the nudge updates that key rather than adding one.
		await expect
			.poll(() => keys())
			.toEqual([
				{ t: 0.5, v: 10, easing: "in" },
				{ t: 2, v: 31 },
			]);
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect.poll(() => keys()).toEqual(animation.tracks.xPct);
		expect(errors).toEqual([]);
	} finally {
		await context.close().catch(() => {});
	}
});
