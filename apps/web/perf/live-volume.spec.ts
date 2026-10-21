/* Read-only-ish probe against the running dev server and a real project.
 *
 * Plays for a few seconds and reports what each audio element is actually set
 * to, so a STORED volume can be compared with the one that reaches the output.
 * `PROBE_SWEEP=1` additionally drives the Volume slider and reports what each
 * setting produces — it writes to the project, so it restores the value it
 * found before finishing.
 *
 * Skipped unless `PROBE_PROJECT` names a project.
 */
import { test } from "@playwright/test";

const PROJECT = process.env.PROBE_PROJECT ?? "";
const SWEEP = process.env.PROBE_SWEEP === "1";

/** The playing elements, quietest first. */
async function playing(
	page: import("@playwright/test").Page,
): Promise<Array<{ v: number; src: string }>> {
	return page.evaluate(() =>
		[...document.querySelectorAll("audio")]
			.filter((a) => !a.paused)
			.map((a) => ({
				v: +a.volume.toFixed(4),
				src: a.currentSrc.split("/").slice(-1)[0]?.slice(0, 26) ?? "",
			}))
			.sort((a, b) => a.v - b.v),
	);
}

test("what the player does with a stored music volume", async ({ page }) => {
	test.skip(!PROJECT, "set PROBE_PROJECT");
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`${process.env.PROBE_ORIGIN ?? "http://localhost:3030"}/content/${PROJECT}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 120_000 });
	await page.waitForTimeout(3000);

	/* How many clips drew a waveform and how many fell back to a label. A stock
	   clip that cannot be DECODED (no CORS header at its host) shows the label,
	   so this is the visible half of routing stock audio through this origin. */
	console.log(
		`[live] waveforms=${await page.locator("canvas.tl2-wave").count()} fallbacks=${await page.locator(".tl2-wave-fallback").count()}`,
	);

	await page.locator(".tl2-timeline [data-transport='play']").click();
	for (let i = 0; i < 4; i++) {
		await page.waitForTimeout(1000);
		console.log(`[live] t+${i + 1}s ${JSON.stringify(await playing(page))}`);
	}
	await page.locator(".tl2-timeline [data-transport='play']").click();

	if (!SWEEP) return;
	// Select the music clip and sweep its Volume, reporting what each setting
	// produces at the element that is actually making the sound.
	const music = page.locator(".tl2-clip-audio.tl2-audio-music").first();
	await music.click();
	const volumeSlider = page.locator("input[type=range]").nth(0);
	const duckSlider = page.locator("input[type=range]").nth(1);
	const before = { volume: await volumeSlider.inputValue(), duck: await duckSlider.inputValue() };
	console.log(`[live] stored volume=${before.volume}% duck=${before.duck}%`);

	await page.locator(".tl2-timeline [data-transport='play']").click();
	for (const [volume, duck] of [
		["100", "100"],
		["100", before.duck],
		["10", before.duck],
		["10", "100"],
	]) {
		await volumeSlider.fill(volume!);
		await volumeSlider.dispatchEvent("input");
		await duckSlider.fill(duck!);
		await duckSlider.dispatchEvent("input");
		await page.waitForTimeout(900);
		console.log(`[live] volume=${volume}% duck=${duck}% -> ${JSON.stringify(await playing(page))}`);
	}
	await page.locator(".tl2-timeline [data-transport='play']").click();

	// Put it back exactly as it was found.
	await volumeSlider.fill(before.volume);
	await volumeSlider.dispatchEvent("input");
	await duckSlider.fill(before.duck);
	await duckSlider.dispatchEvent("input");
	await page.waitForTimeout(500);
	console.log(
		`[live] restored volume=${await volumeSlider.inputValue()}% duck=${await duckSlider.inputValue()}%`,
	);
});
