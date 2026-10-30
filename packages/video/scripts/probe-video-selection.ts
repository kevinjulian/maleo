// Run in the production image. Measure actual OffthreadVideo source IDs, not desktop decoding.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { VIDEO_ENTRY } from "../src/paths.ts";
import { storyboardSchema } from "../src/schema.ts";

assert(process.env.MALEO_GOLDEN_IMAGE, "Production image ID is required");
const directory = resolve(process.argv[2]);
const output = resolve(process.argv[3]);
mkdirSync(output, { recursive: true });
const serveUrl = await bundle({ entryPoint: VIDEO_ENTRY });
const browser = await openBrowser("chrome");
const observations: Array<{
	source: string;
	frame: number;
	rate: number;
	sourceStart: number;
	sourceTime: number;
	id: number;
}> = [];
try {
	for (const source of ["cfr-av.mp4", "vfr-silent.mp4", "nonzero-silent.mp4"]) {
		const src = `data:video/mp4;base64,${readFileSync(resolve(directory, source)).toString("base64")}`;
		const requests = [0, 49, 50, 51, 100, 120, 480, 1080, 1440, 2100, 2388].map((frame) => ({
			frame,
			rate: 1,
			sourceStart: 0,
		}));
		for (const rate of [0.25, 0.5, 1, 2, 4]) requests.push({ frame: 240, rate, sourceStart: 0.25 });
		for (const [index, request] of requests.entries()) {
			const inputProps = storyboardSchema.parse({
				scenes: [],
				hideBase: true,
				videoOverlays: [
					{
						url: src,
						kind: "video",
						startSec: 0,
						durationSec: 2,
						mediaStartSec: request.sourceStart,
						layout: { widthPct: 100, heightPct: 100, fit: "stretch", playbackRate: request.rate },
					},
				],
			});
			const selected = await selectComposition({
				serveUrl,
				id: "StoryboardReel",
				inputProps,
				puppeteerInstance: browser,
			});
			const file = resolve(output, `${source}-${index}.png`);
			await renderStill({
				serveUrl,
				composition: { ...selected, width: 160, height: 96, fps: 1200, durationInFrames: 2400 },
				inputProps,
				frame: request.frame,
				output: file,
				imageFormat: "png",
				puppeteerInstance: browser,
			});
			const raw = execFileSync("ffmpeg", [
				"-v",
				"error",
				"-i",
				file,
				"-f",
				"rawvideo",
				"-pix_fmt",
				"rgb24",
				"pipe:1",
			]);
			assert.equal(raw.length, 160 * 96 * 3);
			let id = 0;
			for (let bit = 0; bit < 8; bit++) {
				const at = (16 * 160 + bit * 20 + 10) * 3;
				if ((raw[at] + raw[at + 1] + raw[at + 2]) / 3 > 128) id |= 1 << bit;
			}
			const observation = {
				source,
				...request,
				sourceTime: request.sourceStart + (request.frame / 1200) * request.rate,
				id,
			};
			observations.push(observation);
			console.log(JSON.stringify(observation));
		}
	}
} finally {
	await browser.close({ silent: true });
}
writeFileSync(
	resolve(output, "production-selection.json"),
	JSON.stringify({ image: process.env.MALEO_GOLDEN_IMAGE, fps: 1200, observations }, null, "\t") +
		"\n",
);
