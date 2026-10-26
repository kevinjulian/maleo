import { chooseOption } from "./options.ts";
import { expect, test, type BrowserContext } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { DEFAULT_MEDIA_IMPORT_LIMITS, type ImportedMediaKind } from "@maleo/shared";
import type { EditScope, EditorCommand } from "@maleo/shared/editor";
import { itemGeometry, EDITOR_TIMELINE } from "./vui-timeline.ts";
import { replayApi } from "./har.ts";
import { mockCommandLog } from "./command-log.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/api-editor-chat.har");
let png: Buffer, video: Buffer, audio: Buffer;
test.beforeAll(() => {
	png = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=green:s=32x32",
		"-frames:v",
		"1",
		"-c:v",
		"png",
		"-f",
		"image2pipe",
		"pipe:1",
	]);
	video = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"color=c=blue:s=32x32:r=30:d=0.5",
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
	audio = execFileSync("ffmpeg", [
		"-v",
		"error",
		"-f",
		"lavfi",
		"-i",
		"sine=frequency=440:duration=0.5",
		"-c:a",
		"aac",
		"-movflags",
		"frag_keyframe+empty_moov",
		"-f",
		"mp4",
		"pipe:1",
	]);
});

async function fixture(
	context: BrowserContext,
	options: { fail?: (commands: readonly EditorCommand[]) => boolean } = {},
) {
	await replayApi(context, HAR);
	const jobs = new Map<
		string,
		{
			filename: string;
			kind: ImportedMediaKind;
			status: string;
			polls: number;
			mediaId: string;
			revision: string;
		}
	>();
	const attempts = new Map<string, number>();
	const writes: EditScope["mediaAssets"][] = [];
	let cancelled = 0;
	const result = (id: string) => {
		const job = jobs.get(id)!;
		return {
			id,
			filename: job.filename,
			status: job.status,
			error: null,
			asset:
				job.status === "ready"
					? {
							id,
							label: job.filename,
							url: `/api/media/${job.mediaId}`,
							kind: job.kind,
							source: "upload",
							...(job.kind !== "image" ? { dur: 0.5 } : {}),
							metadata: {
								originalFilename: job.filename,
								byteSize:
									job.kind === "video"
										? video.length
										: job.kind === "audio"
											? audio.length
											: png.length,
								kind: job.kind,
								...(job.kind !== "audio"
									? {
											width: 32,
											height: 32,
										}
									: {}),
								...(job.kind !== "image" ? { duration: 0.5 } : {}),
							},
							compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
							importedSource: {
								revision: job.revision,
								fingerprint: "a".repeat(64),
								originalMediaId: job.mediaId,
								playbackMediaId: job.mediaId,
							},
						}
					: null,
		};
	};
	await context.route("**/api/media/*", (route) => {
		const job = [...jobs.values()].find((job) =>
			new URL(route.request().url()).pathname.endsWith(job.mediaId),
		);
		return route.fulfill({
			body: job?.kind === "video" ? video : job?.kind === "audio" ? audio : png,
			contentType:
				job?.kind === "video" ? "video/mp4" : job?.kind === "audio" ? "audio/mp4" : "image/png",
		});
	});
	/* The project's media library as the server holds it; each admitted write is recorded. */
	let storyboard = editorChatProjectDetail.storyboards[0]!.storyboard_json;
	let library: EditScope["mediaAssets"] = [];
	await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
		stored: () => storyboard,
		onSave: (next) => {
			storyboard = next;
		},
		media: () => library,
		onMedia: (next) => {
			library = next;
			writes.push(next);
		},
		fail: options.fail,
	});
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
		(route) =>
			route.fulfill({
				json: {
					...editorChatProjectDetail,
					mediaAssets: library,
					storyboards: [
						{ ...editorChatProjectDetail.storyboards[0]!, storyboard_json: storyboard },
					],
				},
			}),
	);
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}/media/import`),
		async (route) => {
			const req = route.request(),
				path = new URL(req.url()).pathname;
			if (path.endsWith("/readiness")) {
				await route.fulfill({ json: { available: true, limits: DEFAULT_MEDIA_IMPORT_LIMITS } });
				return;
			}
			if (req.method() === "GET" && path.endsWith("/media/import")) {
				await route.fulfill({ json: { items: [], nextCursor: null } });
				return;
			}
			if (req.method() === "POST") {
				const filename = decodeURIComponent(req.headers()["x-file-name"]!);
				attempts.set(filename, (attempts.get(filename) ?? 0) + 1);
				if (filename === "retry.png" && attempts.get(filename) === 1) {
					await route.fulfill({
						status: 503,
						json: { error: "media_import_failed", message: "Storage temporarily unavailable" },
					});
					return;
				}
				const kind =
					req.headers()["x-media-kind"] === "video"
						? "video"
						: req.headers()["x-media-kind"] === "audio"
							? "audio"
							: "image";
				const id = randomUUID();
				jobs.set(id, {
					filename,
					kind,
					status: "processing",
					polls: 0,
					mediaId: randomUUID(),
					revision: randomUUID(),
				});
				await route.fulfill({ status: 202, json: result(id) });
				return;
			}
			const id = path.split("/").at(-1)!;
			const job = jobs.get(id);
			if (!job) {
				await route.fulfill({ status: 404, json: { error: "not_found" } });
				return;
			}
			if (req.method() === "DELETE") {
				job.status = "cancelled";
				cancelled++;
			} else if (job.filename !== "cancel.png" && job.status !== "cancelled" && ++job.polls >= 2)
				job.status = "ready";
			await route.fulfill({ json: result(id) });
		},
	);
	return {
		attempts,
		jobs,
		writes,
		get library() {
			return library;
		},
		get storyboard() {
			return storyboard;
		},
		get cancelled() {
			return cancelled;
		},
	};
}

for (const width of [1440, 320])
	test(`picker stages partial batch, retries failure and cancels processing at ${width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			const proof = await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true })
				.click();
			const importButton = page.getByRole("button", { name: "Import files", exact: true });
			await expect(importButton).toBeEnabled();
			if (width === 320)
				expect((await importButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
			const clips = await page.locator("[data-clipid]").count();
			const chooser = page.waitForEvent("filechooser");
			if (width === 320) await importButton.tap();
			else {
				await importButton.focus();
				await page.keyboard.press("Enter");
			}
			await (
				await chooser
			).setFiles(
				["good.png", "retry.png", "cancel.png"].map((name) => ({
					name,
					mimeType: "image/png",
					buffer: png,
				})),
			);
			await expect(uploadCard(page, "retry.png")).toContainText("Storage temporarily unavailable");
			await expect(uploadCard(page, "retry.png")).toHaveAttribute("data-upload-state", "failed");
			await expect(
				page.getByRole("button", { name: "Add good.png to timeline", exact: true }),
			).toBeVisible();
			await expect(uploadCard(page, "cancel.png")).toContainText("Processing");
			expect(await page.locator("[data-clipid]").count()).toBe(clips);
			await page.getByRole("button", { name: "Retry retry.png", exact: true }).click();
			await expect(
				page.getByRole("button", { name: "Add retry.png to timeline", exact: true }),
			).toBeVisible();
			expect(proof.attempts.get("good.png")).toBe(1);
			expect(proof.attempts.get("retry.png")).toBe(2);
			await page.getByRole("button", { name: "Cancel cancel.png", exact: true }).click();
			await expect(uploadCard(page, "cancel.png")).toHaveCount(0);
			await expect.poll(() => proof.cancelled).toBe(1);
			await expect(
				page.getByRole("button", { name: "Add cancel.png to timeline", exact: true }),
			).toHaveCount(0);
			await expect
				.poll(() => JSON.stringify(proof.writes.at(-1)))
				.toContain('"originalFilename":"good.png"');
			await page.screenshot({ path: testInfo.outputPath("import-rows.png") });
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true })
				.click();
			await expect(uploadCard(page, "cancel.png")).toHaveCount(0);
			expect(await page.locator("[data-clipid]").count()).toBe(clips);
		} finally {
			await context.close();
		}
	});

/** An in-flight or failed import's card in All Media's Uploading section. */
const uploadCard = (page: import("@playwright/test").Page, filename: string) =>
	page.locator("[data-upload-state]").filter({ hasText: filename });

test("OS batch drop stages files and oversized batches do not upload", async ({
	page,
	context,
}) => {
	const proof = await fixture(context);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
	const transfer = await page.evaluateHandle(
		(bytes) => {
			const dt = new DataTransfer();
			dt.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
			return dt;
		},
		[...png],
	);
	await page
		.locator(".tl2-panel-body")
		.filter({ has: page.getByLabel("Choose media files", { exact: true }) })
		.dispatchEvent("drop", { dataTransfer: transfer });
	await expect(
		page.getByRole("button", { name: "Add dropped.png to timeline", exact: true }),
	).toBeVisible();
	await page.getByLabel("Choose media files", { exact: true }).setInputFiles(
		Array.from({ length: 51 }, (_, i) => ({
			name: `${i}.png`,
			mimeType: "image/png",
			buffer: png,
		})),
	);
	await expect(page.getByRole("alert")).toContainText("at most 50 files");
	expect(proof.attempts.size).toBe(1);
});

test("timeline file drop places video/audio with one media-aware undo and stable redo", async ({
	page,
	context,
}) => {
	const proof = await fixture(context);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const assetsButton = page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true });
	await assetsButton.click();
	await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	for (const [name, bytes, family, mime] of [
		["footage.mp4", video, "video", "video/mp4"],
		["sound.m4a", audio, "audio", "audio/mp4"],
	] as const) {
		const lane = page.locator('[data-vui-row="lane-1"]').first();
		const box = (await lane.boundingBox())!;
		const clips = page.locator(`[data-clipid^="${family}:"]`),
			before = await clips.count();
		const transfer = await page.evaluateHandle(
			({ name, bytes, mime }) => {
				const dt = new DataTransfer();
				dt.items.add(new File([new Uint8Array(bytes)], name, { type: mime }));
				return dt;
			},
			{ name, bytes: [...bytes], mime },
		);
		await lane.dispatchEvent("drop", {
			dataTransfer: transfer,
			clientX: box.x + 80,
			clientY: box.y + box.height / 2,
		});
		await expect(clips).toHaveCount(before + 1);
		const id = await clips.last().getAttribute("data-clipid");
		await page.getByRole("button", { name: "Undo", exact: true }).click();
		await expect(clips).toHaveCount(before);
		await assetsButton.click();
		await expect(
			page.getByRole("button", { name: `Add ${name} to timeline`, exact: true }),
		).toHaveCount(0);
		await page.getByRole("button", { name: "Hide panel", exact: true }).click();
		await page.getByRole("button", { name: "Redo", exact: true }).click();
		await expect(clips).toHaveCount(before + 1);
		await expect(clips.last()).toHaveAttribute("data-clipid", id!);
		await expect
			.poll(() => JSON.stringify(proof.writes.at(-1)))
			.toContain(`"originalFilename":"${name}"`);
	}
	expect(proof.attempts.size).toBe(2);
	const audioClips = page.locator('[data-clipid^="audio:"]');
	const audioCount = await audioClips.count();
	await audioClips.last().click();
	const clipboard = await page.evaluateHandle(() => new DataTransfer());
	await page
		.locator(".tl2")
		.evaluate(
			(element, data) =>
				element.dispatchEvent(
					new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }),
				),
			clipboard,
		);
	await page
		.locator(".tl2")
		.evaluate(
			(element, data) =>
				element.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
				),
			clipboard,
		);
	await expect(audioClips).toHaveCount(audioCount + 1);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(audioClips).toHaveCount(audioCount);
});

test("locked file target refuses import; clipboard files leave typing inputs alone", async ({
	page,
	context,
}) => {
	const proof = await fixture(context);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
	const transfer = await page.evaluateHandle(
		(bytes) => {
			const dt = new DataTransfer();
			dt.items.add(new File([new Uint8Array(bytes)], "clipboard.png", { type: "image/png" }));
			return dt;
		},
		[...png],
	);
	await page
		.getByRole("searchbox", { name: "Search media", exact: true })
		.evaluate(
			(element, data) =>
				element.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
				),
			transfer,
		);
	expect(proof.attempts.size).toBe(0);
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	await page
		.locator('[data-gutter-row="1"]')
		.getByRole("button", { name: "Lock track", exact: true })
		.click();
	const lane = page.locator('[data-vui-row="lane-1"]').first(),
		box = (await lane.boundingBox())!;
	await lane.dispatchEvent("dragover", {
		dataTransfer: transfer,
		clientX: box.x + 80,
		clientY: box.y + box.height / 2,
	});
	await expect(page.locator(".tl2-dropghost")).toContainText("Track locked");
	await lane.dispatchEvent("drop", {
		dataTransfer: transfer,
		clientX: box.x + 80,
		clientY: box.y + box.height / 2,
	});
	expect(proof.attempts.size).toBe(0);
	const before = await page.locator("[data-clipid]").count();
	await page
		.locator(".tl2")
		.evaluate(
			(element, data) =>
				element.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
				),
			transfer,
		);
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Add clipboard.png to timeline", exact: true }),
	).toBeVisible();
	expect(await page.locator("[data-clipid]").count()).toBe(before);
});

test("a dropped file is placed while it uploads, survives a later lock and undoes in one step; studio paste leaves main editor alone", async ({
	page,
	context,
}) => {
	const proof = await fixture(context);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const assets = page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true });
	await assets.click();
	await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	const transfer = await page.evaluateHandle(
		(bytes) => {
			const data = new DataTransfer();
			data.items.add(new File([new Uint8Array(bytes)], "late.png", { type: "image/png" }));
			return data;
		},
		[...png],
	);
	const lane = page.locator('[data-vui-row="lane-1"]').first(),
		box = (await lane.boundingBox())!;
	const before = await page.locator("[data-clipid]").count();
	await lane.dispatchEvent("drop", {
		dataTransfer: transfer,
		clientX: box.x + 80,
		clientY: box.y + box.height / 2,
	});
	// Placed at once, while the import is still processing.
	await expect(page.locator("[data-clipid]")).toHaveCount(before + 1);
	await expect.poll(() => proof.attempts.get("late.png")).toBe(1);
	expect([...proof.jobs.values()].find((job) => job.filename === "late.png")?.status).not.toBe(
		"ready",
	);
	await page
		.locator('[data-gutter-row="1"]')
		.getByRole("button", { name: "Lock track", exact: true })
		.click();
	await expect
		.poll(() => [...proof.jobs.values()].find((job) => job.filename === "late.png")?.status, {
			timeout: 10_000,
		})
		.toBe("ready");
	await expect(page.locator("[data-clipid]")).toHaveCount(before + 1);
	// Undo the lock, then the drop: completing the upload added no step between them.
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(page.locator("[data-clipid]")).toHaveCount(before);
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Elements", exact: true })
		.click();
	await page.getByRole("tab", { name: "Motion", exact: true }).click();
	await page
		.getByRole("region", { name: "Motion elements", exact: true })
		.locator(".tl2-elgroup-h")
		.getByRole("button", { name: /New motion/ })
		.click();
	await expect(page.locator(".tl2-studio")).toBeVisible();
	await page
		.locator(".tl2-studio")
		.evaluate(
			(element, data) =>
				element.dispatchEvent(
					new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }),
				),
			transfer,
		);
	expect(proof.attempts.get("late.png")).toBe(1);
});

for (const width of [1440, 320])
	test(`media details play and seek video/audio with keyboard/touch recovery at ${width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true })
				.click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			await page.getByLabel("Choose media files", { exact: true }).setInputFiles([
				{ name: "preview.mp4", mimeType: "video/mp4", buffer: video },
				{ name: "preview.m4a", mimeType: "audio/mp4", buffer: audio },
			]);
			for (const [name, kind] of [
				["preview.mp4", "video"],
				["preview.m4a", "audio"],
			]) {
				const open = page.getByRole("button", { name: `Media details: ${name}`, exact: true });
				await expect(open).toBeVisible();
				if (width === 320) {
					expect((await open.boundingBox())!.height).toBeGreaterThanOrEqual(44);
					await open.tap();
				} else {
					await open.focus();
					await page.keyboard.press("Enter");
				}
				const dialog = page.getByRole("dialog", { name: `Media details: ${name}`, exact: true });
				await expect(dialog).toContainText("Original filename");
				await expect(dialog).toContainText("0.500 seconds");
				const player = dialog.locator(kind!);
				await expect
					.poll(() => player.evaluate((element) => (element as HTMLMediaElement).readyState))
					.toBeGreaterThanOrEqual(2);
				await player.evaluate(async (element) => {
					const media = element as HTMLMediaElement;
					media.currentTime = 0.2;
					await media.play();
				});
				await expect
					.poll(() => player.evaluate((element) => (element as HTMLMediaElement).currentTime))
					.toBeGreaterThan(0.2);
				await page.screenshot({ path: testInfo.outputPath(`${kind}-details.png`) });
				await dialog.getByRole("button", { name: "Close", exact: true }).click();
				await expect(dialog).toHaveCount(0);
				await expect(open).toBeFocused();
			}
		} finally {
			await context.close();
		}
	});

test("unsupported source stays visible, blocks placement and exposes details; broken playback retries", async ({
	page,
	context,
}) => {
	await fixture(context);
	const id = randomUUID(),
		brokenId = randomUUID();
	const assets = [
		{
			id,
			label: "Needs conversion.mov",
			url: `/api/media/${id}`,
			kind: "video",
			source: "upload",
			compatibility: {
				preview: { status: "unsupported", reason: "Codec needs conversion" },
				render: { status: "failed", reason: "Conversion failed" },
			},
		},
		{
			id: brokenId,
			label: "Missing footage.mp4",
			url: `/api/media/${brokenId}`,
			kind: "video",
			source: "upload",
		},
	];
	await context.route(
		new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
		(route) =>
			route.fulfill({
				json: {
					...editorChatProjectDetail,
					mediaAssets: assets,
				},
			}),
	);
	let reads = 0;
	await context.route(`**/api/media/${brokenId}`, (route) => {
		reads++;
		return reads < 3
			? route.fulfill({ status: 404 })
			: route.fulfill({ body: video, contentType: "video/mp4" });
	});
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true })
		.click();
	await expect(
		page.getByRole("button", { name: "Add Needs conversion.mov to timeline", exact: true }),
	).toBeDisabled();
	await page
		.getByRole("button", { name: "Media details: Needs conversion.mov", exact: true })
		.click();
	const details = page.getByRole("dialog", {
		name: "Media details: Needs conversion.mov",
		exact: true,
	});
	await expect(details).toContainText("Codec needs conversion");
	await expect(details).toContainText("Conversion failed");
	await details.getByRole("button", { name: "Close", exact: true }).click();
	await page
		.getByRole("button", { name: "Media details: Missing footage.mp4", exact: true })
		.click();
	const missing = page.getByRole("dialog", {
		name: "Media details: Missing footage.mp4",
		exact: true,
	});
	await expect(missing.getByRole("alert")).toContainText("Could not read source");
	await missing.getByRole("button", { name: "Try again", exact: true }).click();
	await expect
		.poll(() =>
			missing.locator("video").evaluate((element: HTMLVideoElement) => element.readyState),
		)
		.toBeGreaterThanOrEqual(2);
});

for (const width of [1440, 320])
	test(`failed media save retries without losing source identity and plays after reload at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			let failures = 0;
			const proof = await fixture(context, {
				/* The first save that admits durable.mp4 fails once. */
				fail: (commands) => {
					if (failures || !JSON.stringify(commands).includes('"label":"durable.mp4"')) return false;
					failures++;
					return true;
				},
			});
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const assets = page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true });
			await assets.click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			await page
				.getByLabel("Choose media files", { exact: true })
				.setInputFiles({ name: "durable.mp4", mimeType: "video/mp4", buffer: video });
			await expect(
				page.getByRole("button", { name: "Add durable.mp4 to timeline", exact: true }),
			).toBeVisible();
			await expect(page.getByRole("alert")).toContainText("Auto-save failed");
			expect(proof.attempts.get("durable.mp4")).toBe(1);
			await page.getByRole("button", { name: "Retry save", exact: true }).click();
			await expect(page.getByRole("button", { name: "Retry save", exact: true })).toHaveCount(0);
			const identity = JSON.stringify(proof.library);
			expect(identity).toContain('"originalFilename":"durable.mp4"');
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await page.getByRole("button", { name: "Media details: durable.mp4", exact: true }).click();
			const dialog = page.getByRole("dialog", { name: "Media details: durable.mp4", exact: true });
			await expect
				.poll(() =>
					dialog.locator("video").evaluate((element: HTMLVideoElement) => element.readyState),
				)
				.toBeGreaterThanOrEqual(2);
			expect(JSON.stringify(proof.library)).toBe(identity);
			expect(proof.attempts.get("durable.mp4")).toBe(1);
		} finally {
			await context.close();
		}
	});

for (const width of [1440, 320])
	test(`media list/grid sort and selection stay independent of preview and clips at ${width}px`, async ({
		browser,
	}, testInfo) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true })
				.click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			const clips = await page.locator("[data-clipid]").count();
			await page.getByLabel("Choose media files", { exact: true }).setInputFiles([
				{ name: "Alpha.mp4", mimeType: "video/mp4", buffer: video },
				{ name: "Zed.m4a", mimeType: "audio/mp4", buffer: audio },
			]);
			const selected = page.getByRole("checkbox", { name: "Select Zed.m4a", exact: true });
			await expect(selected).toBeVisible();
			if (width === 320) {
				expect((await selected.boundingBox())!.height).toBeGreaterThanOrEqual(44);
				await selected.tap();
			} else {
				await selected.focus();
				await page.keyboard.press("Enter");
			}
			await expect(selected).toBeChecked();
			await page.getByRole("button", { name: "List view", exact: true }).click();
			await expect(selected).toBeChecked();
			await chooseOption(page.getByRole("combobox", { name: "Sort media", exact: true }), "name");
			const ready = page.getByRole("list", { name: "Project media: Ready to place", exact: true });
			await expect(ready.locator(".ui-media-title")).toHaveText(["Alpha.mp4", "Zed.m4a"]);
			await expect(ready).toContainText("bytes");
			await page.getByRole("button", { name: "Media details: Zed.m4a", exact: true }).click();
			await page
				.getByRole("dialog", { name: "Media details: Zed.m4a", exact: true })
				.getByRole("button", { name: "Close", exact: true })
				.click();
			await expect(selected).toBeChecked();
			expect(await page.locator("[data-clipid]").count()).toBe(clips);
			await page.screenshot({ path: testInfo.outputPath("media-list-selection.png") });
			await page.getByRole("button", { name: "Grid view", exact: true }).click();
			await expect(selected).toBeChecked();
			await page.getByRole("button", { name: "Clear selection (1)", exact: true }).click();
			await expect(
				page.getByRole("searchbox", { name: "Search media", exact: true }),
			).toBeFocused();
			await selected.check();
			await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("Alpha");
			await expect(
				page.getByRole("group", { name: "Selected media actions", exact: true }),
			).toHaveCount(0);
			await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("");
			await expect(selected).not.toBeChecked();
		} finally {
			await context.close();
		}
	});

for (const width of [1440, 320])
	test(`media rename, bulk placement/removal and usage navigation persist at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			const proof = await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			const assets = page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true });
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			await page.getByLabel("Choose media files", { exact: true }).setInputFiles([
				{ name: "Zed.mp4", mimeType: "video/mp4", buffer: video },
				{ name: "Alpha.m4a", mimeType: "audio/mp4", buffer: audio },
			]);
			await page.getByRole("button", { name: "Media details: Zed.mp4", exact: true }).click();
			const dialog = page.getByRole("dialog", { name: "Media details: Zed.mp4", exact: true });
			await dialog
				.getByRole("textbox", { name: "Media name", exact: true })
				.fill("Renamed footage");
			await dialog.getByRole("button", { name: "Rename", exact: true }).click();
			await expect
				.poll(
					() =>
						proof.library.find((asset) => asset.label === "Renamed footage")?.metadata
							?.originalFilename,
				)
				.toBe("Zed.mp4");
			const identity = proof.library.find((asset) => asset.label === "Renamed footage")!;
			await dialog.getByRole("button", { name: "Close", exact: true }).click();
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await expect(
				page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }),
			).toBeVisible();
			expect(proof.library.find((asset) => asset.label === "Renamed footage")!.id).toBe(
				identity.id,
			);
			expect(proof.attempts.get("Zed.mp4")).toBe(1);
			await chooseOption(page.getByRole("combobox", { name: "Sort media", exact: true }), "name");
			await page.getByRole("checkbox", { name: "Select Alpha.m4a", exact: true }).check();
			await page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }).check();
			const before = await page.locator("[data-clipid]").count();
			await page.getByRole("button", { name: "Place selected (2)", exact: true }).click();
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await expect(page.locator("[data-clipid]")).toHaveCount(before + 2);
			const placed = page.locator('[data-clipid^="video:"]').last();
			await expect(placed).toHaveAttribute("aria-label", /Renamed footage/);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect(page.locator("[data-clipid]")).toHaveCount(before);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect(page.locator("[data-clipid]")).toHaveCount(before + 2);
			await assets.click();
			await page.getByRole("checkbox", { name: "Select Alpha.m4a", exact: true }).check();
			await page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }).check();
			await expect(
				page.getByRole("button", { name: "Remove unused (0)", exact: true }),
			).toBeDisabled();
			await expect(
				page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }),
			).toBeVisible();
			await page
				.getByRole("button", { name: "Media details: Renamed footage", exact: true })
				.click();
			const details = page.getByRole("dialog", {
				name: "Media details: Renamed footage",
				exact: true,
			});
			await expect(details).toContainText("Used in 1 locations");
			await details.getByRole("button", { name: "Renamed footage", exact: true }).click();
			await expect(placed).toHaveAttribute("aria-selected", "true");
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect(page.locator("[data-clipid]")).toHaveCount(before);
			await assets.click();
			await page.getByRole("checkbox", { name: "Select Alpha.m4a", exact: true }).check();
			await page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }).check();
			await page.getByRole("button", { name: "Remove unused (2)", exact: true }).click();
			await expect(
				page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }),
			).toHaveCount(0);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await assets.click();
			await expect(
				page.getByRole("checkbox", { name: "Select Renamed footage", exact: true }),
			).toBeVisible();
		} finally {
			await context.close().catch(() => {});
		}
	});

for (const width of [1440, 320])
	test(`media usages select and seek every scene/video/audio location at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await fixture(context);
			await context.route("**/api/media/00000000-0000-0000-0000-000000000091*", (route) => {
				const query = new URL(route.request().url()).search;
				return route.fulfill({
					body: query === "?video" ? video : query === "?audio" ? audio : png,
					contentType:
						query === "?video" ? "video/mp4" : query === "?audio" ? "audio/mp4" : "image/png",
				});
			});
			const url = "/api/media/00000000-0000-0000-0000-000000000091";
			const first = editorChatProjectDetail.storyboards[0]!;
			const doc = {
				...first.storyboard_json,
				clips: [
					{
						id: "scene:1",
						type: "image",
						startSec: 0,
						durationSec: 4,
						track: 0,
						markerId: 1,
						scene: {
							id: 1,
							dur: 4,
							name: "Fixture opening",
							shot: "Wide",
							move: "Static",
							vis: "",
							vo: "",
							img: true,
							src: url,
							mediaAssetId: "image",
							endSrc: url,
							endMediaAssetId: "image",
							visualClips: [
								{
									id: "primary",
									kind: "image",
									label: "Primary",
									url,
									mediaAssetId: "image",
									primary: true,
									startSec: 0,
									durationSec: 4,
								},
								{
									id: "extra",
									kind: "image",
									label: "Extra visual",
									url,
									mediaAssetId: "image",
									primary: false,
									startSec: 1.5,
									durationSec: 1,
								},
							],
						},
					},
					...first.storyboard_json.clips.slice(1),
					{
						id: "video:91",
						type: "video",
						startSec: 2,
						durationSec: 1,
						track: 0,
						video: {
							id: 91,
							kind: "video",
							url: url + "?video",
							label: "First overlay",
							mediaAssetId: "video",
							start: 2,
							dur: 1,
							track: 0,
						},
					},
					{
						id: "video:92",
						type: "video",
						startSec: 6,
						durationSec: 1,
						track: 0,
						video: {
							id: 92,
							kind: "video",
							url: url + "?video",
							label: "Second overlay",
							mediaAssetId: "video",
							start: 6,
							dur: 1,
							track: 0,
						},
					},
					{
						id: "audio:91",
						type: "audio",
						startSec: 3,
						durationSec: 1,
						track: 2,
						audio: {
							id: 91,
							kind: "music",
							url: url + "?audio",
							content: "First audio",
							mediaAssetId: "audio",
							start: 3,
							dur: 1,
							track: 2,
						},
					},
					{
						id: "audio:92",
						type: "audio",
						startSec: 8,
						durationSec: 1,
						track: 2,
						audio: {
							id: 92,
							kind: "music",
							url: url + "?audio",
							content: "Second audio",
							mediaAssetId: "audio",
							start: 8,
							dur: 1,
							track: 2,
						},
					},
				],
			};
			const mediaAssets = [
				{ id: "image", kind: "image", label: "Scene source", url, source: "upload" },
				{
					id: "video",
					kind: "video",
					label: "Video source",
					url: url + "?video",
					source: "upload",
				},
				{
					id: "audio",
					kind: "audio",
					label: "Audio source",
					url: url + "?audio",
					source: "upload",
				},
			];
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							mediaAssets,
							storyboards: [{ ...first, storyboard_json: doc }],
						},
					}),
			);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			const assets = page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true });
			for (const [label, usage, clip, time] of [
				["Scene source", "Fixture opening · frame", "scene:1", "00:00:00"],
				["Scene source", "Fixture opening · Extra visual", "scene:1", "00:01:50"],
				["Scene source", "Fixture opening · end frame", "scene:1", "00:03:96"],
				["Video source", "First overlay", "video:91", "00:02:00"],
				["Video source", "Second overlay", "video:92", "00:06:00"],
				["Audio source", "First audio", "audio:91", "00:03:00"],
				["Audio source", "Second audio", "audio:92", "00:08:00"],
			]) {
				await assets.click();
				await page.getByRole("button", { name: `Media details: ${label}`, exact: true }).click();
				const dialog = page.getByRole("dialog", { name: `Media details: ${label}`, exact: true });
				await dialog.getByRole("button", { name: usage, exact: true }).click();
				await expect(page.locator(`[data-clipid="${clip}"]`)).toHaveAttribute(
					"aria-selected",
					"true",
				);
				await expect(page.locator('[data-transport="timecode"]').first()).toContainText(time!);
				await page.keyboard.press("Escape");
			}
		} finally {
			await context.close().catch(() => {});
		}
	});

for (const width of [1440, 320])
	test(`source replacement keeps project identity, undo and playback after reload at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			const proof = await fixture(context);
			const page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			const assets = page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true });
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
			await page
				.getByLabel("Choose media files", { exact: true })
				.setInputFiles({ name: "original.mp4", mimeType: "video/mp4", buffer: video });
			const admitted = () => proof.library.find((asset) => asset.label === "original.mp4");
			await expect.poll(() => admitted()?.url).toContain("/api/media/");
			const original = structuredClone(admitted()!);
			await page.getByRole("button", { name: "Media details: original.mp4", exact: true }).click();
			const dialog = page.getByRole("dialog", { name: "Media details: original.mp4", exact: true });
			const choose = page.waitForEvent("filechooser");
			if (width === 320)
				await dialog.getByRole("button", { name: "Replace source", exact: true }).tap();
			else {
				await dialog.getByRole("button", { name: "Replace source", exact: true }).focus();
				await page.keyboard.press("Enter");
			}
			await (
				await choose
			).setFiles({ name: "replacement.mp4", mimeType: "video/mp4", buffer: video });
			await expect(dialog).toHaveCount(0);
			await expect(
				page.getByRole("button", { name: "Media details: original.mp4", exact: true }),
			).toBeFocused();
			await expect.poll(() => admitted()?.metadata?.originalFilename).toBe("replacement.mp4");
			expect(admitted()!.id).toBe(original.id);
			expect(admitted()!.url).not.toBe(original.url);
			expect(admitted()!.importedSource?.history).toEqual([
				{ url: original.url, metadata: original.metadata, source: original.importedSource },
			]);
			const repaired = structuredClone(admitted()!);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect.poll(() => admitted()?.url).toBe(original.url);
			await page.getByRole("button", { name: "Redo", exact: true }).click();
			await expect.poll(() => admitted()?.url).toBe(repaired.url);
			await page.reload();
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			await assets.click();
			await page.getByRole("button", { name: "Media details: original.mp4", exact: true }).click();
			await expect
				.poll(() =>
					dialog.locator("video").evaluate((element: HTMLVideoElement) => element.readyState),
				)
				.toBeGreaterThanOrEqual(2);
			expect(admitted()).toEqual(repaired);
		} finally {
			await context.close().catch(() => {});
		}
	});

test("audio replacement discards old waveform while new source cannot decode", async ({
	page,
	context,
}) => {
	const proof = await fixture(context);
	await context.route("**/api/media/*", (route) => {
		const job = [...proof.jobs.values()].find((job) =>
			new URL(route.request().url()).pathname.endsWith(job.mediaId),
		);
		return job?.filename === "unreadable.m4a"
			? route.fulfill({ status: 503, body: "Storage unavailable" })
			: route.fallback();
	});
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const assets = page
		.getByRole("navigation", { name: "Editor tools" })
		.getByRole("button", { name: "Assets", exact: true });
	await assets.click();
	await expect(page.getByRole("button", { name: "Import files", exact: true })).toBeEnabled();
	await page
		.getByLabel("Choose media files", { exact: true })
		.setInputFiles({ name: "waveform.m4a", mimeType: "audio/mp4", buffer: audio });
	// Placed once ready, so the clip takes the server-measured length the replacement is checked against.
	await expect
		.poll(() => [...proof.jobs.values()].find((job) => job.filename === "waveform.m4a")?.status)
		.toBe("ready");
	await expect(uploadCard(page, "waveform.m4a")).toHaveCount(0);
	await page.getByRole("button", { name: "Add waveform.m4a to timeline", exact: true }).click();
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	const clip = page.locator('[data-clipid^="audio:"]').last();
	await expect(clip.locator("canvas.tl2-wave")).toBeVisible();
	await assets.click();
	await page.getByRole("button", { name: "Media details: waveform.m4a", exact: true }).click();
	const choose = page.waitForEvent("filechooser");
	await page.getByRole("button", { name: "Replace source", exact: true }).click();
	await (await choose).setFiles({ name: "unreadable.m4a", mimeType: "audio/mp4", buffer: audio });
	await expect(uploadCard(page, "unreadable.m4a")).toHaveCount(0); // A finished replacement leaves the uploading section.
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	await expect(clip.locator("canvas.tl2-wave")).toHaveCount(0);
	await expect(clip.locator(".tl2-wave-fallback")).toContainText("waveform.m4a");
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect(clip.locator("canvas.tl2-wave")).toBeVisible();
});

for (const width of [1440, 320])
	test(`playhead trims keep neighbors fixed, undo once and preserve shortcut ownership at ${width}px`, async ({
		browser,
	}) => {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width, height: width === 320 ? 740 : 900 },
			hasTouch: width === 320,
			isMobile: width === 320,
			reducedMotion: "reduce",
		});
		try {
			await fixture(context);
			const first = editorChatProjectDetail.storyboards[0]!,
				url = "/api/media/00000000-0000-0000-0000-000000000098";
			const source = execFileSync("ffmpeg", [
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
			await context.route("**/api/media/00000000-0000-0000-0000-000000000098", (route) =>
				route.fulfill({ body: source, contentType: "video/mp4" }),
			);
			const doc = {
				...first.storyboard_json,
				clips: [
					{
						id: "scene:1",
						type: "image",
						track: -1,
						startSec: 0,
						durationSec: 8,
						scene: {
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
					},
					{
						id: "video:98",
						type: "video",
						track: 0,
						startSec: 2,
						durationSec: 4,
						video: {
							id: 98,
							kind: "video",
							url,
							label: "Trim source",
							mediaAssetId: "trim-source",
							start: 2,
							dur: 4,
							mediaStartSec: 1,
							track: 0,
						},
					},
					{
						id: "video:99",
						type: "video",
						track: 0,
						startSec: 7,
						durationSec: 1,
						video: {
							id: 99,
							kind: "video",
							url,
							label: "Neighbor",
							mediaAssetId: "trim-source",
							start: 7,
							dur: 1,
							track: 0,
						},
					},
				],
			};
			const writes: Array<{
				clips: Array<{
					id: string;
					startSec: number;
					durationSec: number;
					video?: { mediaStartSec?: number };
				}>;
			}> = [];
			const trimSource = {
				id: "trim-source",
				label: "Trim source",
				kind: "video",
				source: "upload",
				url,
				dur: 8,
				metadata: {
					kind: "video",
					byteSize: source.length,
					originalFilename: "source.mp4",
					duration: 8,
				},
			};
			await mockCommandLog(context, EDITOR_CHAT_PROJECT_ID, {
				stored: () => writes.at(-1) ?? doc,
				onSave: (next) => {
					writes.push(next);
				},
				media: () => [trimSource] as EditScope["mediaAssets"],
			});
			let locked = false;
			await context.route(
				new RegExp(`/api/operations/projects/${EDITOR_CHAT_PROJECT_ID}(\\?|$)`),
				(route) =>
					route.fulfill({
						json: {
							...editorChatProjectDetail,
							mediaAssets: [trimSource],
							storyboards: [
								{
									...first,
									storyboard_json: {
										...doc,
										...(locked ? { trackFlags: { 0: { locked: true } } } : {}),
									},
								},
							],
						},
					}),
			);
			let page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			let clip = page.locator('[data-clipid="video:98"]');
			await clip.click();
			const geometry = await itemGeometry(page, EDITOR_TIMELINE, "video:98");
			let ruler = page.locator('[data-vui-slot="ruler"]').first();
			await ruler.click({
				position: {
					x: geometry.timeBox.leftPx + (geometry.timeBox.rightPx - geometry.timeBox.leftPx) / 4,
					y: 10,
				},
			});
			await expect(page.locator('[data-transport="timecode"]').first()).toContainText("00:03:00");
			if (width === 1440) {
				await page.getByRole("button", { name: "Trim clip", exact: true }).click();
				await page.getByRole("menuitem", { name: "Trim before playhead Q", exact: true }).click();
			} else {
				await page.locator('.tl2-clipbar button[aria-label="Clip actions"]').click();
				await page.getByRole("button", { name: "Trim before playhead", exact: true }).click();
			}
			await expect
				.poll(() => writes.at(-1)?.clips.find((clip) => clip.id === "video:98")?.startSec)
				.toBe(3);
			expect(
				writes.at(-1)!.clips.find((clip) => clip.id === "video:98")?.video?.mediaStartSec,
			).toBe(2);
			expect(writes.at(-1)!.clips.find((clip) => clip.id === "video:99")?.startSec).toBe(7);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect
				.poll(() => writes.at(-1)?.clips.find((clip) => clip.id === "video:98")?.durationSec)
				.toBe(4);
			await page.keyboard.press("w");
			await expect
				.poll(() => writes.at(-1)?.clips.find((clip) => clip.id === "video:98")?.durationSec)
				.toBe(1);
			await page.getByRole("button", { name: "Undo", exact: true }).click();
			await expect
				.poll(() => writes.at(-1)?.clips.find((clip) => clip.id === "video:98")?.durationSec)
				.toBe(4);
			await page.keyboard.press("Escape");
			await page
				.getByRole("navigation", { name: "Editor tools" })
				.getByRole("button", { name: "Assets", exact: true })
				.click();
			await page.getByRole("searchbox", { name: "Search media", exact: true }).fill("q");
			await page.keyboard.press("w");
			expect(writes.at(-1)!.clips.find((clip) => clip.id === "video:98")?.durationSec).toBe(4);
			await page.getByRole("button", { name: "Hide panel", exact: true }).click();
			await page.keyboard.press("Alt+Digit5");
			await page.getByRole("tab", { name: "Motion", exact: true }).click();
			const section = page
				.getByRole("region", { name: "Motion elements", exact: true })
				.locator(".tl2-elgroup-h");
			await section.getByRole("button", { name: /New motion/ }).click();
			await expect(page.locator(".tl2-studio")).toBeVisible();
			const beforeStudio = JSON.stringify(writes.at(-1)?.clips);
			await page.keyboard.press("q");
			await page.keyboard.press("w");
			await page.waitForTimeout(1500); // Outlast the 1200ms submit debounce so a leaked shortcut would save.
			expect(JSON.stringify(writes.at(-1)?.clips)).toBe(beforeStudio);
			if (width === 320) await page.locator(".tl2-studio .tl2-editor-heading-back").click();
			else
				await page
					.locator(".tl2-studio")
					.getByRole("button", { name: "Cancel", exact: true })
					.click();
			await expect(page.locator(".tl2-studio")).toHaveCount(0);
			locked = true;
			await page.close();
			page = await context.newPage();
			await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
			await page.getByRole("tab", { name: "Timeline", exact: true }).click();
			clip = page.locator('[data-clipid="video:98"]');
			ruler = page.locator('[data-vui-slot="ruler"]').first();
			await expect(clip).not.toHaveAttribute("aria-disabled", "true");
			await expect(clip).toHaveAccessibleName(/locked/);
			const lockedBox = (await clip.boundingBox())!;
			if (width === 320)
				await page.touchscreen.tap(
					lockedBox.x + lockedBox.width / 2,
					lockedBox.y + lockedBox.height / 2,
				);
			else
				await page.mouse.click(
					lockedBox.x + lockedBox.width / 2,
					lockedBox.y + lockedBox.height / 2,
				);
			const lockedGeometry = await itemGeometry(page, EDITOR_TIMELINE, "video:98");
			await ruler.click({
				position: {
					x:
						lockedGeometry.timeBox.leftPx +
						(lockedGeometry.timeBox.rightPx - lockedGeometry.timeBox.leftPx) / 4,
					y: 10,
				},
			});
			await expect(page.locator('[data-transport="timecode"]').first()).toContainText("00:03:00");
			/* With nothing selected, Q and W trim the scene under the playhead; only the
			 * locked clip itself must not change. */
			const lockedClip = () =>
				JSON.stringify(writes.at(-1)?.clips.find((clip) => clip.id === "video:98"));
			const beforeLocked = lockedClip();
			await page.keyboard.press("q");
			await page.keyboard.press("w");
			await page.waitForTimeout(1500); // Outlast the submit debounce: locked cuts must not reach persistence.
			expect(lockedClip()).toBe(beforeLocked);
		} finally {
			await context.close().catch(() => {});
		}
	});
