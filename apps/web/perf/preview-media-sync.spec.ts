import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import type { SyncReport } from "./preview-media-sync-entry.ts";
import { analyzeSync, percentile, type Segment } from "./sync-analysis.ts";

const names = ["sync-video.mp4", "sync-clicks.m4a"];
const FPS = 30;
const CLICK_INTERVAL_SEC = 0.5;

/** D10 transport plan: every rate, pauses, seeks while paused and playing, and rate changes in place. */
const PLAN: Array<
	| { label: string; action: "play" | "seek"; target: number; rate: number; holdMs: number }
	| { label: string; action: "rate"; rate: number; holdMs: number }
	| { label: string; action: "pause"; holdMs: number }
> = [
	{ label: "play 1x from 0", action: "play", target: 0, rate: 1, holdMs: 60_000 },
	{ label: "rate 2x in place", action: "rate", rate: 2, holdMs: 30_000 },
	{ label: "pause", action: "pause", holdMs: 2_000 },
	{ label: "play 0.5x from 300", action: "play", target: 300, rate: 0.5, holdMs: 30_000 },
	{ label: "seek 500 at 0.5x", action: "seek", target: 500, rate: 0.5, holdMs: 15_000 },
	{ label: "rate 1x in place", action: "rate", rate: 1, holdMs: 20_000 },
	{ label: "seek 100 at 1x", action: "seek", target: 100, rate: 1, holdMs: 20_000 },
	{ label: "rate 2x in place", action: "rate", rate: 2, holdMs: 15_000 },
	{ label: "seek 550 at 2x", action: "seek", target: 550, rate: 2, holdMs: 15_000 },
	{ label: "final pause", action: "pause", holdMs: 1_000 },
];

async function run(page: Page, step: (typeof PLAN)[number], first: boolean) {
	if (step.action === "play" && first) {
		// AudioContext activation needs a real user gesture; the button starts at 0 at 1x.
		await page.getByRole("button", { name: "Play", exact: true }).click();
		return;
	}
	await page.evaluate((value) => {
		const sync = window.mediaSync;
		if (value.action === "play") sync.play(value.target, value.rate);
		else if (value.action === "seek") sync.seek(value.target, value.rate);
		else if (value.action === "rate") sync.rate(value.rate);
		else return sync.pause();
	}, step);
}

test("10-minute marker fixture holds audiovisual offset across rates, pauses and seeks", async ({
	playwright,
}, info) => {
	test.setTimeout(600_000);
	const fixtures = info.outputPath("sources"),
		bundle = info.outputPath("sync.js");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-sync-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	const sourceServer = createServer((request, response) => {
		const name = request.url?.slice(1) ?? "";
		if (!names.includes(name)) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			"access-control-allow-origin": "*",
			"content-type": name.endsWith("mp4") ? "video/mp4" : "audio/mp4",
			"content-length": statSync(join(fixtures, name)).size,
		});
		createReadStream(join(fixtures, name)).pipe(response);
	});
	await new Promise<void>((done) => sourceServer.listen(0, "127.0.0.1", done));
	const address = sourceServer.address();
	if (!address || typeof address === "string") throw new Error("Fixture HTTP listener missing");
	execFileSync(
		"bun",
		[
			"build",
			resolve(import.meta.dirname, "preview-media-sync-entry.ts"),
			"--target=browser",
			"--outfile",
			bundle,
		],
		{ stdio: "pipe" },
	);
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	try {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width: 1440, height: 900 },
		});
		await context.route("**/media-sync-probe", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><button id="play">Play</button><canvas width="640" height="360"></canvas>',
			}),
		);
		await context.route("**/sync-sources/*", (route) => {
			const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
			return route.fulfill({
				status: 302,
				headers: { location: `http://127.0.0.1:${address.port}/${name}` },
			});
		});
		// Draw instrumentation: each drawn timeline frame with its epoch time, flushed on the next post.
		await context.route("**/renderer/maleo_renderer_wasm.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					(await response.text()) +
					`
globalThis.syncDraws=[];
const syncTick=tick;
tick=async function(now){const drawn=await syncTick(now);if(drawn){const report=JSON.parse(state(now));globalThis.syncDraws.push({frame:report.frame,at:performance.timeOrigin+performance.now()});}return drawn;};
`,
			});
		});
		await context.route("**/renderer/preview-worker.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`
const syncPost=globalThis.postMessage.bind(globalThis);
globalThis.postMessage=(value,...rest)=>{const draws=globalThis.syncDraws;if(draws?.length&&value&&typeof value==="object"){globalThis.syncDraws=[];return syncPost({...value,syncDraws:draws},...rest);}return syncPost(value,...rest);};
` + (await response.text()),
			});
		});
		// Output capture after the processor: clicks above 0.5 and output onsets after silence.
		await context.route("**/preview-audio-worklet.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`const syncRegister=registerProcessor;globalThis.registerProcessor=(name,Base)=>syncRegister(name,class extends Base{syncLast=-1e9;syncSilent=99;process(inputs,outputs,parameters){const active=super.process(inputs,outputs,parameters),pcm=outputs[0]?.[0];if(pcm){let peak=0,first=-1;for(let i=0;i<pcm.length;i++){const v=Math.abs(pcm[i]);peak=Math.max(peak,v);if(first<0&&v>0.02)first=i;if(v>0.5&&currentFrame+i-this.syncLast>0.1*sampleRate){this.syncLast=currentFrame+i;this.port.postMessage({type:"sync-click",contextTime:(currentFrame+i)/sampleRate});}}if(peak>0.02){if(this.syncSilent>=4)this.port.postMessage({type:"sync-onset",contextTime:(currentFrame+first)/sampleRate});this.syncSilent=0;}else if(peak<0.005)this.syncSilent++;}return active;}});\n` +
					(await response.text()),
			});
		});
		const page = await context.newPage(),
			pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await page.goto("/media-sync-probe");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		await page.evaluate(() => window.prepareMediaSync());
		const report = () => page.evaluate(() => window.mediaSync.report());
		await expect
			.poll(async () => (await report()).preview?.mediaReady, { timeout: 30_000 })
			.toBe(true);
		// Every later sample comes from complete local bytes.
		await context.setOffline(true);
		const segments: Segment[] = [];
		let rate = 1;
		for (const [index, step] of PLAN.entries()) {
			const command = await page.evaluate(() => window.mediaSync.now());
			await run(page, step, index === 0);
			if (step.action !== "pause") {
				rate = step.rate;
				if (segments.length) segments.at(-1)!.end = command;
				segments.push({
					label: step.label,
					command,
					end: command + step.holdMs,
					rate,
					...(step.action === "rate" ? {} : { target: step.target }),
				});
			} else if (segments.length) segments.at(-1)!.end = command;
			await page.waitForTimeout(step.holdMs);
		}
		const captured: SyncReport = await report();
		await page.evaluate(() => window.mediaSync.close());
		const results = analyzeSync({
			draws: captured.draws,
			clicks: captured.clicks,
			onsets: captured.onsets,
			segments,
			fps: FPS,
			clickIntervalSec: CLICK_INTERVAL_SEC,
		});
		const offsets = results.flatMap((result) => result.offsetsMs.map(Math.abs));
		const byRate = Object.fromEntries(
			[0.5, 1, 2].map((value) => {
				const values = results
					.filter((result) => result.rate === value)
					.flatMap((result) => result.offsetsMs);
				return [
					`${value}x`,
					{
						clicks: values.length,
						p50Ms: percentile(values, 0.5),
						p95AbsMs: percentile(values.map(Math.abs), 0.95),
						maxAbsMs: Math.max(...values.map(Math.abs)),
					},
				];
			}),
		);
		const summary = {
			machine: execFileSync(
				"sysctl",
				["-n", "hw.model", "machdep.cpu.brand_string", "hw.memsize"],
				{
					encoding: "utf8",
				},
			)
				.trim()
				.split("\n"),
			os: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
			browser: browser.version(),
			backend: "Chromium WebGPU / ANGLE Metal, headless",
			sampleRate: captured.sampleRate,
			outputLatencyMs: captured.outputLatencyMs,
			baseLatencyMs: captured.baseLatencyMs,
			draws: captured.draws.length,
			clicks: captured.clicks.length,
			onsets: captured.onsets.length,
			overall: {
				clicks: offsets.length,
				p95AbsMs: percentile(offsets, 0.95),
				maxAbsMs: Math.max(...offsets),
			},
			byRate,
			// D3 breakdown of each start, from the audio messages on the main thread:
			// activation = command to audio-configure; first decode = configure to the first block;
			// tempo fill = first block to audio-play (queue filled to 0.25 s); worklet fill = audio-play
			// to the audible onset. Decode and tempo work inside the first block are not separable here.
			breakdown: results.map((result, index) => {
				const segment = segments[index]!,
					events = captured.audioEvents.filter(
						({ at }) => at >= segment.command && at < segment.end,
					);
				const first = (type: string, after = segment.command) =>
					events.find((event) => event.type === type && event.at >= after)?.at;
				const configure = first("out:audio-configure"),
					block = configure === undefined ? undefined : first("in:audio-block", configure),
					play = block === undefined ? undefined : first("out:audio-play", block),
					heard = result.audioMs === null ? undefined : segment.command + result.audioMs;
				const span = (from?: number, to?: number) =>
					from === undefined || to === undefined ? null : to - from;
				return {
					label: result.label,
					activationMs: span(segment.command, configure),
					firstDecodeMs: span(configure, block),
					tempoFillMs: span(block, play),
					workletFillMs: span(play, heard),
					pulls: events.filter(
						({ type, at }) => type === "out:audio-pull" && play !== undefined && at < play,
					).length,
				};
			}),
			segments: results.map((result) => ({
				label: result.label,
				rate: result.rate,
				settleMs: result.settleMs,
				drawMs: result.drawMs,
				audioMs: result.audioMs,
				audioBy: result.audioBy,
				clicks: result.offsetsMs.length,
				p95AbsMs: percentile(result.offsetsMs.map(Math.abs), 0.95),
				maxAbsMs: Math.max(...result.offsetsMs.map(Math.abs)),
			})),
			errors: captured.errors,
			pageErrors,
		};
		writeFileSync(info.outputPath("sync.json"), JSON.stringify(summary, null, 2));
		writeFileSync(info.outputPath("sync-raw.json"), JSON.stringify({ segments, captured }));
		console.log("MEDIA_SYNC", JSON.stringify(summary));
		expect(pageErrors).toEqual([]);
		expect(captured.errors).toEqual([]);
		for (const result of results) {
			expect(result.settleMs, result.label).not.toBeNull();
			expect(result.settleMs!, result.label).toBeLessThanOrEqual(250);
			expect(result.offsetsMs.length, result.label).toBeGreaterThan(0);
		}
		expect(summary.overall.p95AbsMs).toBeLessThanOrEqual(50);
		expect(summary.overall.maxAbsMs).toBeLessThanOrEqual(100);
	} finally {
		await browser.close();
		sourceServer.closeAllConnections();
		await new Promise<void>((done, reject) =>
			sourceServer.close((error) => (error ? reject(error) : done())),
		);
	}
});
