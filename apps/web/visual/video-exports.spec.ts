import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { resolve, join } from "node:path";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { replayApi } from "./har.ts";
import { EDITOR_CHAT_PROJECT_ID, editorChatProjectDetail } from "./fixtures/editor-chat-data.ts";

const HAR = resolve(import.meta.dirname, "fixtures/api-editor-chat.har");
const media = (() => {
	const dir = mkdtempSync(join(tmpdir(), "maleo-player-fixture-"));
	try {
		const file = join(dir, "export.mp4");
		execFileSync("ffmpeg", [
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			"color=c=blue:s=96x64:d=12",
			"-c:v",
			"libx264",
			"-threads",
			"1",
			"-pix_fmt",
			"yuv420p",
			"-movflags",
			"+faststart",
			file,
		]);
		return readFileSync(file);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
})();
const poster = execFileSync(
	"ffmpeg",
	["-v", "error", "-i", "pipe:0", "-frames:v", "1", "-f", "image2pipe", "-c:v", "mjpeg", "pipe:1"],
	{ input: media },
);
const base = {
	id: "export-recovered",
	preset: "storyboard-wide",
	status: "running",
	phase: "rendering",
	progress: 0.42,
	project_id: EDITOR_CHAT_PROJECT_ID,
	project_title: "An unusually long project title ".repeat(8),
	created_at: 1,
	finished_at: null,
	output_path: null,
	output_url: null,
	thumbnail_url: null,
	error: null,
};
for (const width of [1440, 320])
	for (const theme of ["light", "dark"]) {
		test(`export collection actions ${width} ${theme}`, async ({ browser }, info) => {
			test.setTimeout(60_000);
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
			});
			try {
				await replayApi(context, HAR);
				await context.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
				const statuses = ["done", "done_with_fallback", "running", "queued", "error", "cancelled"];
				let submitted = 0;
				await context.route("**/api/video/render", (route) => {
					submitted++;
					return route.fulfill({ json: base });
				});
				await context.route("**/api/video/jobs**", (route) =>
					route.fulfill({
						json: {
							items: statuses.map((status, i) => ({
								...base,
								id: `export-${i}`,
								status,
								output_url: status.startsWith("done") ? "/api/media/export" : null,
								thumbnail_url: i === 0 ? "/api/media/poster" : null,
							})),
							total: 66,
							has_more: true,
							next_offset: 60,
							projects: [{ id: EDITOR_CHAT_PROJECT_ID, title: "Project" }],
						},
					}),
				);
				await context.route("**/api/media/export", (route) => {
					const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
					const start = range ? Number(range[1]) : 0;
					const end = range?.[2] ? Number(range[2]) : media.length - 1;
					return route.fulfill({
						status: range ? 206 : 200,
						body: media.subarray(start, end + 1),
						contentType: "video/mp4",
						headers: {
							"accept-ranges": "bytes",
							...(range ? { "content-range": `bytes ${start}-${end}/${media.length}` } : {}),
						},
					});
				});
				await context.route("**/api/media/poster", (route) =>
					route.fulfill({ body: poster, contentType: "image/jpeg" }),
				);
				await context.route("**/api/video/render/*/retry**", (route) =>
					route.fulfill({ status: 503, json: { error: "retry unavailable" } }),
				);
				const page = await context.newPage();
				await page.goto("/video?workspace=default");
				await expect(page.getByRole("list", { name: "Project export attempts" })).toBeVisible();
				await expect(page.getByText("66 export attempts", { exact: true })).toBeVisible();
				expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
					true,
				);
				const open = page.getByRole("button", { name: /View export:/ }).first();
				await open.click();
				const dialog = page.getByRole("dialog");
				await expect(dialog).toBeVisible();
				const video = dialog.locator("video");
				expect(await video.evaluate((node: HTMLVideoElement) => node.controls)).toBe(false);
				await dialog.getByRole("button", { name: "Play", exact: true }).first().click();
				await expect
					.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
					.toBeGreaterThan(0);
				await dialog.getByRole("button", { name: "Pause", exact: true }).first().click();
				await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.paused)).toBe(true);
				await dialog.getByRole("button", { name: "Mute", exact: true }).click();
				await expect.poll(() => video.evaluate((node: HTMLVideoElement) => node.muted)).toBe(true);
				await dialog.getByRole("button", { name: "Unmute", exact: true }).click();
				await dialog.getByRole("button", { name: "Settings", exact: true }).click();
				await dialog.getByRole("menuitem", { name: /Speed/ }).click();
				await dialog.getByRole("menuitemradio", { name: "2×", exact: true }).click();
				await expect
					.poll(() => video.evaluate((node: HTMLVideoElement) => node.playbackRate))
					.toBe(2);
				await page.keyboard.press("Escape");
				await expect(dialog).toBeVisible();
				await expect(dialog.getByRole("menu")).toHaveCount(0);
				const seek = dialog.getByRole("slider", { name: "Seek", exact: true });
				await seek.focus();
				await page.keyboard.press("ArrowRight");
				await expect
					.poll(() => video.evaluate((node: HTMLVideoElement) => node.currentTime))
					.toBeCloseTo(1, 1);
				await dialog.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
				await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
				const fullscreen = await dialog.locator(".ui-video-player").boundingBox();
				expect(fullscreen?.height).toBeGreaterThan(800);
				await dialog.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
				await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
				if (width === 320) {
					for (const button of await dialog.locator(".ui-video-player .media-button").all()) {
						if (await button.isVisible()) {
							const box = await button.boundingBox();
							expect(box!.height).toBeGreaterThanOrEqual(44);
							expect(box!.width).toBeGreaterThanOrEqual(44);
						}
					}
				}
				expect(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
				await page.screenshot({
					path: info.outputPath(`player-${width}-${theme}.png`),
					animations: "disabled",
					timeout: 10_000,
				});
				const download = page.waitForEvent("download");
				await dialog.getByRole("link", { name: "Download MP4" }).click();
				expect((await download).suggestedFilename()).toContain("export-0");
				await page.keyboard.press("Escape");
				await expect(dialog).toHaveCount(0);
				await expect(open).toBeFocused();
				await open.click();
				await expect
					.poll(() =>
						dialog.locator("video").evaluate((node: HTMLVideoElement) => node.currentTime),
					)
					.toBe(0);
				await expect
					.poll(() => dialog.locator("video").evaluate((node: HTMLVideoElement) => node.paused))
					.toBe(true);
				await page.evaluate(() => history.back());
				await expect(dialog).toHaveCount(0);
				await page.getByRole("button", { name: "Details", exact: true }).nth(2).click();
				await page.getByRole("button", { name: "Retry export" }).click();
				await expect(page.getByRole("dialog").getByText(/Could not retry export/)).toBeVisible();
				await page.keyboard.press("Escape");
				await page.getByRole("button", { name: "Next", exact: true }).click();
				await expect(page).toHaveURL(/offset=60/);
				expect(submitted).toBe(0);
				await page.screenshot({
					path: info.outputPath(`video-${width}-${theme}.png`),
					fullPage: true,
					animations: "disabled",
					timeout: 10_000,
				});
			} finally {
				await context.close();
			}
		});
		test(`server export reload recovery ${width} ${theme}`, async ({ browser }) => {
			const context = await browser.newContext({
				baseURL: "http://127.0.0.1:3031",
				viewport: { width, height: 900 },
				hasTouch: width === 320,
				isMobile: width === 320,
			});
			try {
				await replayApi(context, HAR);
				await context.addInitScript((theme) => localStorage.setItem("theme", theme), theme);
				let state = "idle",
					submissions = 0;
				await context.route("**/api/video/projects/*/exports**", (route) =>
					route.fulfill(
						state === "offline"
							? { status: 502, json: { error: "offline" } }
							: {
									json: {
										active: state === "running" ? base : null,
										latest:
											state === "done"
												? {
														...base,
														status: "done",
														phase: "done",
														progress: 1,
														output_url: "/api/media/export",
													}
												: null,
									},
								},
					),
				);
				await context.route("**/api/video/render", (route) => {
					submissions++;
					state = "running";
					return route.fulfill({ status: 202, json: base });
				});
				await context.route("**/api/operations/projects/*/outputs**", (route) =>
					route.fulfill({ json: { output: { id: "o" } } }),
				);
				await context.route("**/api/operations/projects/*/renders**", (route) =>
					route.fulfill({ json: { render: { id: "r" } } }),
				);
				await context.route("**/api/video/render/*/file", (route) =>
					route.fulfill({ body: media, contentType: "video/mp4" }),
				);
				const page = await context.newPage();
				await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
				await page.getByRole("button", { name: "Export Video", exact: true }).click();
				await page.getByRole("menuitem", { name: /Server render/ }).click();
				await expect.poll(() => submissions).toBe(1);
				await page.reload();
				await page.getByRole("button", { name: /42%/ }).click();
				await expect(
					page.getByRole("dialog").getByText("job export-r", { exact: true }),
				).toBeVisible();
				state = "offline";
				await page.evaluate(() => window.dispatchEvent(new Event("focus")));
				await expect(page.getByRole("dialog").getByText(/Last known progress/)).toBeVisible();
				state = "done";
				await page.getByRole("button", { name: "Reconnect" }).click();
				await expect(page.getByRole("link", { name: "Open MP4" })).toBeVisible();
				const next = page.waitForEvent("popup");
				await page.getByRole("link", { name: "Open MP4" }).click();
				await (await next).close();
				expect(submissions).toBe(1);
			} finally {
				await context.close();
			}
		});
	}

test("rapid project navigation recovers failed result and rejects stale status", async ({
	context,
	page,
}) => {
	await replayApi(context, HAR);
	const second = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
	let release!: () => void;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	await context.route("**/api/video/projects/*/exports**", async (route) => {
		if (route.request().url().includes(second))
			return route.fulfill({
				json: {
					active: null,
					latest: {
						...base,
						id: "second-failed",
						project_id: second,
						status: "error",
						error: "Render failed",
					},
				},
			});
		await gate;
		await route
			.fulfill({ json: { active: { ...base, id: "stale-first" }, latest: null } })
			.catch(() => {});
	});
	await context.route(new RegExp(`/api/operations/projects/${second}(\\?|$)`), (route) =>
		route.fulfill({
			json: {
				...editorChatProjectDetail,
				project: { ...editorChatProjectDetail.project, id: second, title: "Second project" },
			},
		}),
	);
	await page.goto(`/content/${EDITOR_CHAT_PROJECT_ID}`);
	await expect(page.getByRole("button", { name: "Checking export…" })).toBeVisible();
	await page.goto(`/content/${second}`);
	release();
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await page.getByRole("menuitem", { name: "View last export" }).click();
	await expect(page.getByRole("dialog").getByText("job second-f", { exact: true })).toBeVisible();
	await expect(
		page.getByRole("dialog").getByText("Render failed", { exact: true }).first(),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Open MP4" })).toHaveCount(0);
});

test("missing or unauthorized output stays visible without playback or download", async ({
	context,
	page,
}) => {
	await replayApi(context, HAR);
	await context.route("**/api/video/jobs**", (route) =>
		route.fulfill({
			json: {
				items: [{ ...base, status: "done", output_url: "/api/media/denied" }],
				total: 1,
				projects: [],
				has_more: false,
				next_offset: null,
			},
		}),
	);
	await context.route("**/api/media/denied", (route) =>
		route.fulfill({ status: 404, json: { error: "not_found" } }),
	);
	await page.goto("/video");
	await page.getByRole("button", { name: /View export:/ }).click();
	await expect(
		page.getByText("Export media is unavailable. Open the project or try again later."),
	).toBeVisible();
	await expect(page.getByRole("link", { name: "Download MP4" })).toHaveCount(0);
});

test("filtered empty exports offer reset without creating a project", async ({ context, page }) => {
	await replayApi(context, HAR);
	await context.route("**/api/video/jobs**", (route) =>
		route.fulfill({
			json: { items: [], total: 0, projects: [], has_more: false, next_offset: null },
		}),
	);
	await page.goto("/video?search=missing&status=error");
	await expect(page.getByText("No matching exports")).toBeVisible();
	await page.getByRole("button", { name: "Reset filters" }).click();
	await expect(page.getByText("No project exports yet")).toBeVisible();
	expect(new URL(page.url()).searchParams.has("search")).toBe(false);
});

test("player license link serves complete plain-text notices", async ({ request }) => {
	const shell = await request.get("/");
	expect(await shell.text()).toContain(
		'rel="license" type="text/plain" href="/player-licenses.txt"',
	);
	const notices = await request.get("/player-licenses.txt");
	expect(notices.status()).toBe(200);
	expect(notices.headers()["content-type"]).toContain("text/plain");
	expect(await notices.text()).toContain(
		"TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION",
	);
	expect(await notices.text()).toContain("Permission is hereby granted, free of charge");
});
