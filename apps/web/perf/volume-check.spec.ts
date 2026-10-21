/* Does a music clip's volume actually reach the player?
 *
 * Written to answer a bug report — "I changed the music volume but it does not
 * work" — because every layer in between looked correct in isolation: the
 * document round-trip keeps `volume`, so does save-and-reload, and so does the
 * render projection. The thing none of those can show is whether the value
 * arrives at the audio element that is making the sound.
 *
 * It does, for a free music clip on a lane. What does NOT honour a volume is
 * documented where it lives: scene-embedded audio (`scene.audioClips`) is
 * rendered at a hard-coded 0.45 and has no volume field in any layer, and the
 * timeline template's default music bed (`storyboard.musicUrl`) plays through
 * `MusicLayer` at a hard-coded level with no clip and no control.
 */
import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";
import { gainFromFader } from "../src/models/timeline/audio-fader.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");

const INJECT = `{
	function wav(seconds, freq) {
		const rate = 8000, n = seconds * rate;
		const buf = new ArrayBuffer(44 + n * 2), view = new DataView(buf);
		const str = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
		str(0, "RIFF"); view.setUint32(4, 36 + n * 2, true); str(8, "WAVEfmt ");
		view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
		view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true);
		view.setUint16(32, 2, true); view.setUint16(34, 16, true);
		str(36, "data"); view.setUint32(40, n * 2, true);
		for (let i = 0; i < n; i++) view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * freq * 2 * Math.PI) * 20000), true);
		let bin = ""; const bytes = new Uint8Array(buf);
		for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
		return "data:audio/wav;base64," + btoa(bin);
	}
	const url = wav(6, 220);
	const voiceUrl = wav(6, 440);
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const res = await realFetch(input, init);
		const href = typeof input === "string" ? input : input.url;
		if (!/\\/api\\/operations\\/projects\\/[^/?]+(\\?|$)/.test(href)) return res;
		const detail = await res.clone().json().catch(() => null);
		const clips = detail?.storyboards?.[0]?.storyboard_json?.clips;
		if (!Array.isArray(clips)) return res;
		clips.push({
			id: "audio:9001", type: "audio", startSec: 0, durationSec: 6, track: 1,
			audio: { id: 9001, kind: "music", origin: "stock", url, content: "Probe music", start: 0, dur: 6, track: 1 },
		});
		// A voiceover over the whole span, so the music is ducking the entire time —
		// which is the condition the bug report was made under.
		clips.push({
			id: "audio:9002", type: "audio", startSec: 0, durationSec: 6, track: 2,
			audio: { id: 9002, kind: "voiceover", origin: "tts", url: voiceUrl, content: "Narration", start: 0, dur: 6, track: 2 },
		});
		return new Response(JSON.stringify(detail), { status: res.status, headers: { "content-type": "application/json" } });
	};
}`;

test("a music clip's volume slider reaches the player", async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript(INJECT);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });

	await page.locator(".tl2-clip-audio").first().click();
	await expect(page.locator(".tl2-clippanel")).toBeVisible();

	// The Levels section is the audio clip's default inspector tab.
	const label = await page.locator(".tl2-clippanel").innerText();
	console.log(`[volume] panel sections: ${JSON.stringify(label.split("\n").slice(0, 12))}`);

	/* Narration renders at 1 and the bed does not, so the quieter playing element
	   is the music. Simpler than matching data-URL sources, and it fails loudly
	   if the bed ever stops being attenuated at all. */
	const musicEl = async (): Promise<number | null> =>
		page.evaluate(() => {
			const playing = [...document.querySelectorAll("audio")].filter((a) => !a.paused);
			const music = playing.map((a) => +a.volume.toFixed(3)).filter((v) => v < 1);
			return music.length ? Math.max(...music) : null;
		});

	const volumeSlider = page.locator("input[type=range]").nth(0);
	const duckSlider = page.locator("input[type=range]").nth(1);

	await page.locator(".tl2-timeline [data-transport='play']").click();
	await page.waitForTimeout(700);
	/* The bug, reproduced: full volume, and the bed still plays at the fixed 35%
	   duck because narration covers the whole clip. */
	const ducked = await musicEl();
	console.log(`[volume] music at volume 100%, duck 35%: ${ducked}`);
	expect(ducked).toBeCloseTo(0.35, 2);

	/* The volume fader does scale it — proportionally, inside the duck. Its
	   positions are decibels rather than amplitude (audio-fader.ts), so the
	   expected amplitude comes from the same model the control uses. */
	await volumeSlider.fill("20");
	await volumeSlider.dispatchEvent("input");
	await page.waitForTimeout(700);
	const quieter = await musicEl();
	console.log(
		`[volume] music at fader 20%, duck 35%: ${quieter} (fader 20% = ${gainFromFader(20).toFixed(4)})`,
	);
	expect(quieter).toBeCloseTo(gainFromFader(20) * 0.35, 3);

	/* And the duck is now the operator's to set: at 100% the level is the level
	   they chose, which is what the volume slider appeared to promise all along. */
	await duckSlider.fill("100");
	await duckSlider.dispatchEvent("input");
	await page.waitForTimeout(700);
	const unducked = await musicEl();
	console.log(`[volume] music at fader 20%, duck 100%: ${unducked}`);
	expect(unducked).toBeCloseTo(gainFromFader(20), 3);

	await page.locator(".tl2-timeline [data-transport='play']").click();
});
