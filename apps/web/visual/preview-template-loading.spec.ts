import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

test("Template Studio waits for cue lookup and complete audio, then requires fresh Play", async ({
	page,
	context,
}, info) => {
	test.setTimeout(90_000);
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
	let lookupRequests = 0,
		sourceRequests = 0;
	let finishLookup!: () => void, finishBytes!: () => void;
	const lookup = new Promise<void>((resolve) => {
		finishLookup = resolve;
	});
	const bytes = new Promise<void>((resolve) => {
		finishBytes = resolve;
	});
	await context.route("**/timeline-templates/preview-*", async (route) => {
		lookupRequests++;
		await lookup;
		await route.fulfill({
			json: {
				audio: {
					url: "http://127.0.0.1:3031/template-gate.wav",
					durationSec: 2,
					title: "Synthetic impulses",
				},
			},
		});
	});
	await context.route("**/template-gate.wav", async (route) => {
		sourceRequests++;
		await bytes;
		if (sourceRequests === 1) {
			await route.fulfill({ status: 503, body: "Synthetic first download failure" });
			return;
		}
		await route.fulfill({ path: join(fixtures, "impulses-48000.wav"), contentType: "audio/wav" });
	});
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));
	try {
		await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		await page.keyboard.press("Alt+Digit4");
		await page.locator(".tl2-template-create").click();
		const modal = page.locator(".tl2-template-editor-modal");
		await expect(modal).toBeVisible();
		const play = modal.getByRole("button", { name: "Play", exact: true });
		const timecode = modal.locator('[data-transport="timecode"]');
		await expect.poll(() => lookupRequests).toBeGreaterThan(0);
		await expect(play).toBeDisabled();
		await expect(play).toHaveAccessibleDescription("Finding preview audio.");
		const start = await timecode.textContent();
		finishLookup();
		await expect.poll(() => sourceRequests).toBeGreaterThan(0);
		await expect(play).toBeDisabled();
		// Remotion keeps pooled audio tags even without assigned source media.
		expect(
			await modal
				.locator("audio")
				.evaluateAll((elements) =>
					elements.every(
						(element) =>
							element instanceof HTMLMediaElement &&
							!element.src.includes("template-gate.wav") &&
							(element.paused || element.muted || element.volume === 0),
					),
				),
		).toBe(true);
		finishBytes();
		await expect(play).toHaveAccessibleDescription(/Preview unavailable:.*HTTP 503/);
		await page.screenshot({ path: info.outputPath("template-media-failed.png") });
		await modal.getByRole("button", { name: "Retry preview", exact: true }).click();
		await expect(play).toBeEnabled();
		await page.waitForTimeout(350);
		await expect(timecode).toHaveText(start!);
		await context.setOffline(true);
		await play.click();
		await expect.poll(() => timecode.textContent()).not.toBe(start);
		await expect
			.poll(() =>
				modal
					.locator("audio")
					.evaluateAll((elements) =>
						elements.some(
							(element) =>
								element instanceof HTMLMediaElement && element.currentTime > 0.1 && !element.paused,
						),
					),
			)
			.toBe(true);
		await modal.getByRole("button", { name: "Pause", exact: true }).click();
		expect(errors).toEqual([]);
		await page.screenshot({ path: info.outputPath("template-media-ready.png") });
	} finally {
		finishLookup();
		finishBytes();
	}
});
