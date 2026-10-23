/* Connected proof of use-media-while-uploading (task 6.1), run by
 * prove-editor-integration.ts against the real API, worker and renderer:
 * drop a video, trim and key it while it uploads, reload mid-upload so it resumes
 * under the same identity, see it become ready without an undo step, undo and redo
 * across completion, render it in production; then interrupt an upload whose file
 * the browser no longer holds and recover it by choosing the file again. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { expect, type Page } from "@playwright/test";

type Detail = () => Promise<{
	storyboards: Array<{
		storyboard_json: {
			clips: Array<{
				id: string;
				type: string;
				video?: {
					url: string;
					mediaAssetId?: string;
					mediaStartSec?: number;
					layout?: { animation?: { tracks: Record<string, Array<{ v: number }>> } };
				};
			}>;
		};
	}>;
	project: { editor_state_json: { media_assets: Array<{ id: string; url: string }> } };
}>;

const video = (seconds: number, colour: string) =>
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-f",
			"lavfi",
			"-i",
			`testsrc2=s=640x360:r=30:d=${seconds}`,
			"-f",
			"lavfi",
			"-i",
			`sine=frequency=660:sample_rate=48000:duration=${seconds}`,
			"-vf",
			`drawbox=c=${colour}:t=fill:w=iw/4:h=ih/4`,
			"-c:v",
			"libx264",
			"-preset",
			"ultrafast",
			"-crf",
			"12",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			"-movflags",
			"frag_keyframe+empty_moov",
			"-f",
			"mp4",
			"pipe:1",
		],
		{ maxBuffer: 64 * 1024 * 1024 },
	);

async function drop(page: Page, name: string, bytes: Buffer): Promise<string> {
	const before = await page
		.locator('[data-clipid^="video:"]')
		.evaluateAll((clips) => clips.map((clip) => clip.getAttribute("data-clipid")));
	const transfer = await page.evaluateHandle(
		([file, data]) => {
			const items = new DataTransfer();
			items.items.add(new File([new Uint8Array(data)], file, { type: "video/mp4" }));
			return items;
		},
		[name, [...bytes]] as const,
	);
	const lane = page.locator('[data-vui-row="lane-1"]').first(),
		box = (await lane.boundingBox())!;
	await lane.dispatchEvent("drop", {
		dataTransfer: transfer,
		clientX: box.x + 30,
		clientY: box.y + box.height / 2,
	});
	let id = "";
	await expect
		.poll(async () => {
			const now = await page
				.locator('[data-clipid^="video:"]')
				.evaluateAll((clips) => clips.map((clip) => clip.getAttribute("data-clipid")));
			id = now.find((clip) => !before.includes(clip)) ?? "";
			return id;
		})
		.not.toBe("");
	return id;
}

export async function pendingMediaFlow({
	page,
	width,
	api,
	cookie,
	plate,
	rendered,
}: {
	page: Page;
	width: number;
	api: string;
	cookie: string;
	plate: string;
	rendered: (job: string) => Promise<{ status: string }>;
}): Promise<void> {
	// Its own project, so nothing the connected flow left behind decides its export.
	const created = await fetch(`${api}/api/operations/projects`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify({
			title: `Synthetic pending media ${width}`,
			type: "video",
			target_format: "16:9",
			target_duration_sec: 6,
			seed_storyboard: {
				storyboard_json: {
					schemaVersion: 2,
					markers: [],
					clips: [
						{
							id: "scene:1",
							type: "image",
							startSec: 0,
							durationSec: 6,
							track: -1,
							scene: {
								id: 1,
								name: "Pending media plate",
								shot: "Wide",
								move: "Static",
								vis: "",
								vo: "",
								dur: 6,
								src: plate,
							},
						},
					],
				},
			},
		}),
	});
	assert.equal(created.status, 201, await created.clone().text());
	const project: string = (await created.json()).project.project.id;
	const detail: Detail = async () =>
		(await fetch(`${api}/api/operations/projects/${project}`, { headers: { cookie } })).json();
	await page.goto(`/content/${project}`);
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	const phone = width === 320;
	const tools = page.getByRole("navigation", { name: "Editor tools" });
	const deselect = async () => {
		if (phone) {
			const bar = page.locator(".tl2-clipbar");
			if (await bar.count()) {
				if (await bar.getByRole("button", { name: "Back", exact: true }).count())
					await bar.getByRole("button", { name: "Back", exact: true }).click();
				await bar.getByRole("button", { name: "Close", exact: true }).click();
			}
		}
	};
	const open = async (clip: string, group: "Timing" | "Transform") => {
		await page.locator(`[data-clipid="${clip}"]`).click();
		if (phone) await page.locator(`.tl2-clipbar-groups [aria-label="${group}"]`).tap();
		else
			await page
				.locator(".tl2-clippanel")
				.getByRole("button", { name: group, exact: true })
				.click();
	};
	const saved = async (clip: string) =>
		(await detail()).storyboards[0]!.storyboard_json.clips.find((item) => item.id === clip)?.video;
	const cdp = await page.context().newCDPSession(page);
	await cdp.send("Network.enable");
	const throttle = (bytesPerSecond: number) =>
		cdp.send("Network.emulateNetworkConditions", {
			offline: false,
			latency: 0,
			downloadThroughput: -1,
			uploadThroughput: bytesPerSecond,
		});

	// 1. Drop while the upload is held to a trickle: placed at once, uploading.
	for (let attempt = 0; attempt < 3 && (await page.getByRole("dialog").count()); attempt++)
		await page.keyboard.press("Escape");
	await expect(page.getByRole("dialog")).toHaveCount(0);
	await deselect();
	if (await page.getByRole("button", { name: "Hide panel", exact: true }).count())
		await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	const camera = video(6, "red");
	await throttle(Math.round(camera.length / 40));
	const clip = await drop(page, "pending-camera.mp4", camera);
	const badge = page.locator(`[data-clipid="${clip}"] .tl2-clip-upload`);
	await expect(badge).toHaveAttribute("aria-label", /^Uploading \d+%$/);

	// 2. Trim and key it while it uploads; both save with the pending reference.
	await deselect();
	await open(clip, "Timing");
	await page.getByRole("button", { name: "In forward one frame", exact: true }).click();
	await expect.poll(async () => (await saved(clip))?.mediaStartSec ?? 0).toBeCloseTo(1 / 30, 6);
	await deselect();
	await open(clip, "Transform");
	await page.getByRole("button", { name: "Position keyframe", exact: true }).click();
	const x = page.getByRole("spinbutton", { name: "X offset", exact: true });
	await x.fill("7");
	await x.press("Tab");
	await expect
		.poll(async () => (await saved(clip))?.layout?.animation?.tracks.xPct?.[0]?.v)
		.toBe(7);
	const pending = (await saved(clip))!;
	assert.match(
		pending.url,
		/^\/api\/media\/[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f-]{21}$/,
		"An unfinished upload saves as its final minted media URL",
	);
	const key = pending.url.slice("/api/media/".length);
	assert.equal(pending.mediaAssetId, key);
	await expect(badge).toHaveAttribute("aria-label", /^Uploading \d+%$/);

	// 3. Reload mid-upload: the clip stays, and the upload resumes for the same asset.
	await page.reload();
	await throttle(Math.round(camera.length / 12));
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await expect(page.locator(`[data-clipid="${clip}"]`)).toBeVisible();
	await expect(badge).toHaveAttribute("aria-label", /^(Uploading \d+%|Processing)$/, {
		timeout: 20000,
	});
	// An edit in this session, made while it re-uploads, is what undo must still reach.
	await open(clip, "Transform");
	await x.fill("9");
	await x.press("Tab");
	await expect
		.poll(async () => (await saved(clip))?.layout?.animation?.tracks.xPct?.[0]?.v)
		.toBe(9);
	await deselect();
	await throttle(-1);
	await expect(badge).toHaveCount(0, { timeout: 90000 });

	// 4. Ready without an undo step: undo takes back the edit, redo restores it, and the
	//    saved document converges on the managed URL under the same asset.
	assert.equal(
		(await detail()).project.editor_state_json.media_assets.filter((asset) => asset.id === key)
			.length,
		1,
		"No second asset",
	);
	await page.getByRole("button", { name: "Undo", exact: true }).click();
	await expect
		.poll(async () => (await saved(clip))?.layout?.animation?.tracks.xPct?.[0]?.v)
		.toBe(7);
	assert.ok(
		((await saved(clip))?.mediaStartSec ?? 0) > 0,
		"Undo reversed the edit, not the completion or the trim",
	);
	await page.getByRole("button", { name: "Redo", exact: true }).click();
	await expect
		.poll(async () => (await saved(clip))?.layout?.animation?.tracks.xPct?.[0]?.v)
		.toBe(9);
	await expect.poll(async () => (await saved(clip))?.url).toMatch(/^\/api\/media\//);
	assert.equal((await saved(clip))?.mediaAssetId, key);

	// 5. Production export of the timeline that holds it.
	await page.getByRole("button", { name: "Export Video", exact: true }).click();
	await expect(page.getByRole("menu")).not.toContainText("still uploading");
	const submitted = page.waitForResponse(
		(response) =>
			response.url().includes("/api/video/render") && response.request().method() === "POST",
	);
	await page.getByRole("menuitem", { name: /Server render/ }).click();
	const response = await submitted;
	assert.equal(response.status(), 202, await response.text());
	const job: string = (await response.json()).id;
	await expect
		.poll(async () => (await rendered(job)).status, { timeout: 180000 })
		.toMatch(/^(done|done_with_fallback|failed|error)$/);
	const finished = await rendered(job);
	assert.equal(finished.status, "done", JSON.stringify(finished));

	// 6. Interrupted: the upload never arrives and the browser no longer holds the file.
	const importRoute = /\/media\/import(\?|$)/;
	await page.route(importRoute, (route) =>
		route.request().method() === "POST" ? route.abort() : route.fallback(),
	);
	const lost = await drop(page, "pending-lost.mp4", video(3, "green"));
	await expect(page.locator(`[data-clipid="${lost}"] .tl2-clip-upload`)).toHaveAttribute(
		"aria-label",
		/^Upload failed/,
		{ timeout: 30000 },
	);
	await page.evaluate(async () => {
		await (
			await navigator.storage.getDirectory()
		)
			.removeEntry("pending-uploads", { recursive: true })
			.catch(() => {});
	});
	await page.unroute(importRoute);
	await expect.poll(async () => (await saved(lost))?.url).toMatch(/^\/api\/media\//);
	await page.reload();
	await page.getByRole("tab", { name: "Timeline", exact: true }).click();
	await expect(page.locator(`[data-clipid="${lost}"] .tl2-clip-upload`)).toHaveAttribute(
		"aria-label",
		"Upload interrupted",
		{ timeout: 30000 },
	);
	await tools.getByRole("button", { name: "Assets", exact: true }).click();
	// A file of the wrong kind is refused against its use; the right one completes the same asset.
	const choose = async (name: string, buffer: Buffer, type: string) => {
		const chooser = page.waitForEvent("filechooser");
		await page.getByRole("button", { name: "Choose pending-lost.mp4 again", exact: true }).click();
		await (await chooser).setFiles({ name, mimeType: type, buffer });
	};
	await choose(
		"not-video.png",
		execFileSync("ffmpeg", [
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
		]),
		"image/png",
	);
	await expect(
		page.locator("[data-upload-state]").filter({ hasText: "pending-lost.mp4" }),
	).toContainText("Choose a video file");
	await choose("pending-lost.mp4", video(3, "green"), "video/mp4");
	await expect(
		page.locator("[data-upload-state]").filter({ hasText: "pending-lost.mp4" }),
	).toHaveCount(0, { timeout: 90000 });
	await page.getByRole("button", { name: "Hide panel", exact: true }).click();
	await expect(page.locator(`[data-clipid="${lost}"] .tl2-clip-upload`)).toHaveCount(0);
	// Converges on save; a nudge of the playhead is no edit, so trim one frame to write it.
	await page.locator(`[data-clipid="${lost}"]`).click();
	if (phone) await page.locator('.tl2-clipbar-groups [aria-label="Timing"]').tap();
	else
		await page
			.locator(".tl2-clippanel")
			.getByRole("button", { name: "Timing", exact: true })
			.click();
	await page.getByRole("button", { name: "In forward one frame", exact: true }).click();
	await expect.poll(async () => (await saved(lost))?.url).toMatch(/^\/api\/media\//);
	await deselect();
	await cdp.detach();
}
