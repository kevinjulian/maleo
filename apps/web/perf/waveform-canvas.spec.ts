import { expect, test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");

/* Build a real, decodable WAV in the page and hand the timeline an audio clip
 * that points at it. The fixture project has no audio at all, so without this
 * the waveform is unreachable from the suite. */
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
		for (let i = 0; i < n; i++) {
			const env = 0.2 + 0.8 * Math.abs(Math.sin((i / n) * Math.PI * 4));
			view.setInt16(44 + i * 2, Math.round(Math.sin((i / rate) * freq * 2 * Math.PI) * 30000 * env), true);
		}
		let bin = ""; const bytes = new Uint8Array(buf);
		for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
		return "data:audio/wav;base64," + btoa(bin);
	}
	const url = wav(4, 220);
	const realFetch = globalThis.fetch;
	globalThis.fetch = async (input, init) => {
		const res = await realFetch(input, init);
		const href = typeof input === "string" ? input : input.url;
		if (!/\\/api\\/operations\\/projects\\/[^/?]+(\\?|$)/.test(href)) return res;
		const detail = await res.clone().json().catch(() => null);
		const clips = detail?.storyboards?.[0]?.storyboard_json?.clips;
		if (!Array.isArray(clips)) return res;
		clips.push({
			id: "audio:9001", type: "audio", startSec: 0, durationSec: 4, track: 1,
			audio: { id: 9001, kind: "music", origin: "stock", url, content: "Probe tone", start: 0, dur: 4, track: 1 },
		});
		return new Response(JSON.stringify(detail), { status: res.status, headers: { "content-type": "application/json" } });
	};
}`;

test("an audio clip draws its waveform to one canvas", async ({ page, context }) => {
	await replayApi(context, HAR);
	await page.addInitScript(INJECT);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	const canvas = page.locator("canvas.tl2-wave").first();
	await canvas.waitFor({ state: "visible", timeout: 20_000 });

	// One element for the whole waveform, whatever its resolution.
	expect(await page.locator(".tl2-wave i").count()).toBe(0);

	// And it actually painted: a backing store sized for the display, and ink in it.
	const drawn = await canvas.evaluate((el) => {
		const c = el as HTMLCanvasElement;
		const ctx = c.getContext("2d")!;
		const { data } = ctx.getImageData(0, 0, c.width, c.height);
		let opaque = 0;
		for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) opaque += 1;
		return { backing: c.width, css: c.clientWidth, dpr: window.devicePixelRatio, opaque };
	});
	expect(drawn.backing).toBe(Math.round(drawn.css * Math.min(drawn.dpr, 3)));
	expect(drawn.opaque).toBeGreaterThan(0);
	console.log(`[waveform] ${JSON.stringify(drawn)}`);

	/* "A waveform is redrawn at a new width." Zooming changes the clip's rendered
	   width, and the requirement is that the redraw costs no elements — the
	   resolution changes, the node count does not. Exactly zero, with no
	   tolerance: one bar per sample was the defect, so any number above zero is
	   the defect returning. */
	/* The toolbar is rendered twice — a wide arrangement and a compact one — so
	   the visible button is the one to press; `.first()` picks whichever is in
	   the DOM first, which at this width is the hidden one. */
	const zoomIn = page.locator('button[title="Zoom in (+)"]:visible').first();
	const clip = page.locator("[data-clipid='audio:9001']").first();
	const clipBefore = await clip.evaluate((el) => el.clientWidth);
	await zoomIn.click();
	await zoomIn.click();
	/* The clip really did widen, checked before anything is concluded from the
	   canvas: a waveform that "kept its element count" because nothing resized is
	   the vacuous pass this scenario is most likely to produce. */
	await expect
		.poll(async () => clip.evaluate((el) => el.clientWidth), {
			message: "the zoom never widened the clip",
		})
		.toBeGreaterThan(clipBefore);
	await expect
		.poll(async () => canvas.evaluate((el) => el.clientWidth), {
			message: "the waveform did not follow the clip's new width",
		})
		.toBeGreaterThan(drawn.css);
	const wider = await canvas.evaluate((el) => ({
		backing: (el as HTMLCanvasElement).width,
		css: el.clientWidth,
	}));
	expect(await page.locator(".tl2-wave i").count(), "a zoom added an element per sample bar").toBe(
		0,
	);
	expect(await page.locator("canvas.tl2-wave").count(), "a zoom added a second canvas").toBe(1);
	expect(wider.backing, "the backing store did not follow the new width").toBe(
		Math.round(wider.css * Math.min(drawn.dpr, 3)),
	);
	console.log(`[waveform] after zoom ${JSON.stringify(wider)}`);
});
