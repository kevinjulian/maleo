import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import type { StressReport } from "./preview-media-stress-entry.ts";

const names = ["video-a.mp4", "video-b.mp4", "voice.wav", "music.wav"];

function browserRss(root: number): number {
	const rows = execFileSync("ps", ["-axo", "pid=,ppid=,rss="], { encoding: "utf8" })
		.trim()
		.split("\n")
		.map((line) => line.trim().split(/\s+/).map(Number));
	const owned = new Set([root]);
	let size = 0;
	while (size !== owned.size) {
		size = owned.size;
		for (const [pid, parent] of rows) if (pid && parent && owned.has(parent)) owned.add(pid);
	}
	return (
		rows.reduce((sum, [pid, , rss]) => sum + (pid && owned.has(pid) ? (rss ?? 0) : 0), 0) / 1024
	);
}

test("60-second dual 1080p30 playback and 100 latest seeks retain budgets", async ({
	playwright,
}, info) => {
	test.setTimeout(240_000);
	const fixtures = info.outputPath("sources"),
		bundle = info.outputPath("stress.js");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-stress-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	// Stream large fixtures over HTTP instead of serializing them through Playwright's WebSocket.
	const sourceServer = createServer((request, response) => {
		const name = request.url?.slice(1) ?? "";
		if (!names.includes(name)) {
			response.writeHead(404).end();
			return;
		}
		response.writeHead(200, {
			"access-control-allow-origin": "*",
			"content-type": name.endsWith("mp4") ? "video/mp4" : "audio/wav",
			"content-length": statSync(join(fixtures, name)).size,
		});
		createReadStream(join(fixtures, name)).pipe(response);
	});
	await new Promise<void>((resolve) => sourceServer.listen(0, "127.0.0.1", resolve));
	const address = sourceServer.address();
	if (!address || typeof address === "string") throw new Error("Fixture HTTP listener missing");
	execFileSync(
		"bun",
		[
			"build",
			resolve(import.meta.dirname, "preview-media-stress-entry.ts"),
			"--target=browser",
			"--outfile",
			bundle,
		],
		{ stdio: "pipe" },
	);
	const server = await playwright.chromium.launchServer({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	const browser = await playwright.chromium.connect(server.wsEndpoint());
	let phase = "page setup";
	browser.on("disconnected", () =>
		console.log("STRESS_BROWSER_DISCONNECTED", {
			phase,
			code: server.process().exitCode,
			signal: server.process().signalCode,
			peakRssMiB,
		}),
	);
	let peakRssMiB = 0;
	const pid = server.process().pid;
	const monitor = setInterval(() => {
		if (pid) peakRssMiB = Math.max(peakRssMiB, browserRss(pid));
	}, 1000);
	try {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width: 1440, height: 900 },
		});
		await context.route("**/media-stress-probe", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><button id="play">Play</button><button id="pause">Pause</button><canvas width="1920" height="1080" style="width:960px;height:540px"></canvas>',
			}),
		);
		let downloads = 0;
		await context.route("**/stress-sources/*", (route) => {
			downloads++;
			const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
			return route.fulfill({
				status: 302,
				headers: { location: `http://127.0.0.1:${address.port}/${name}` },
			});
		});
		await context.route("**/renderer/maleo_renderer_wasm.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					(await response.text()) +
					`
let stressSerial=0,stressDecoded=0,stressVisualPeak=0,stressVideoSlots=0;
const stressDispatch=MediaPool.prototype.dispatch;
MediaPool.prototype.dispatch=function(payload){const result=stressDispatch.call(this,payload),action=JSON.parse(payload),stats=JSON.parse(stressDispatch.call(this,'{"type":"stats"}'));if(action.type==="complete"&&action.identity.sourceId.endsWith("mp4"))stressDecoded++;stressVisualPeak=Math.max(stressVisualPeak,stats.cachedBytes+stats.reservedBytes);stressVideoSlots=Math.max(stressVideoSlots,stats.videoDecoders);Object.assign(globalThis,{stressVisualPeak,stressVideoSlots,stressDecoded,stressVisualUsed:stats.cachedBytes+stats.reservedBytes});return result;};
const stressReserve=PcmBudget.prototype.reserve,stressRelease=PcmBudget.prototype.release;
PcmBudget.prototype.reserve=function(bytes){const id=stressReserve.call(this,bytes);globalThis.stressPcmUsed=this.used();globalThis.stressPcmPeak=Math.max(globalThis.stressPcmPeak??0,this.used());return id;};
PcmBudget.prototype.release=function(id){stressRelease.call(this,id);globalThis.stressPcmUsed=this.used();};
const stressTick=tick;
tick=async function(now){const started=performance.now(),drawn=await stressTick(now);if(drawn){const report=JSON.parse(state(now));globalThis.stressDraw={serial:++stressSerial,frame:report.frame,ms:performance.now()-started,audio:report.clockOwner==="audio",supported:report.coverage.length===0};}return drawn;};
`,
			});
		});
		await context.route("**/renderer/preview-worker.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`
const stressPost=globalThis.postMessage.bind(globalThis);
globalThis.postMessage=(value,...rest)=>stressPost({...value,stressMetrics:{visualPeak:globalThis.stressVisualPeak??0,visualUsed:globalThis.stressVisualUsed??0,pcmPeak:globalThis.stressPcmPeak??0,pcmUsed:globalThis.stressPcmUsed??0,videoSlots:globalThis.stressVideoSlots??0,decoded:globalThis.stressDecoded??0,draw:globalThis.stressDraw}},...rest);
let stressDelay=false;globalThis.addEventListener("message",event=>{if(event.data?.type==="stress-delay"){stressDelay=event.data.enabled;event.stopImmediatePropagation();}});
const StressWorker=Worker;globalThis.Worker=class extends StressWorker{constructor(...args){super(...args);const released=new WeakSet();this.addEventListener("message",event=>{if(stressDelay&&event.data?.type==="frame"&&!released.has(event.data)){released.add(event.data);event.stopImmediatePropagation();setTimeout(()=>this.dispatchEvent(new MessageEvent("message",{data:event.data})),(event.data.lease%7)*40);}});}};
` + (await response.text()),
			});
		});
		await context.route("**/preview-audio-worklet.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`const stressRegister=registerProcessor;globalThis.registerProcessor=(name,Base)=>stressRegister(name,class extends Base{stressFrames=0;stressPeak=0;process(inputs,outputs,parameters){const active=super.process(inputs,outputs,parameters),pcm=outputs[0]?.[0];if(pcm){this.stressFrames+=pcm.length;for(const value of pcm)this.stressPeak=Math.max(this.stressPeak,Math.abs(value));if(this.stressFrames>=sampleRate){this.port.postMessage({type:"stress-output",frames:this.stressFrames,peak:this.stressPeak});this.stressFrames=0;this.stressPeak=0;}}return active;}});\n` +
					(await response.text()),
			});
		});
		const page = await context.newPage(),
			pageErrors: string[] = [];
		page.on("crash", () => console.log("STRESS_PAGE_CRASH", { phase, peakRssMiB }));
		page.on("pageerror", (error) => {
			pageErrors.push(error.message);
			console.log("STRESS_PAGE_ERROR", error.message);
		});
		await page.goto("/media-stress-probe");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		phase = "complete-source loading";
		console.log("STRESS_PHASE", phase);
		await page.evaluate(() => window.prepareMediaStress());
		phase = "renderer startup";
		console.log("STRESS_PHASE", phase);
		const report = () => page.evaluate(() => window.mediaStress.report());
		await expect
			.poll(async () => (await report()).preview?.mediaReady, { timeout: 20_000 })
			.toBe(true);
		// The output is prepared at media readiness: one context, silent until Play. (Its state depends
		// on the browser's autoplay policy, so it is not asserted.)
		await expect.poll(async () => (await report()).contexts).toHaveLength(1);
		expect((await report()).outputPeak).toBe(0);
		expect(downloads).toBe(4);
		await context.setOffline(true);
		const playStarted = Date.now();
		phase = "60-second playback";
		console.log("STRESS_PHASE", phase);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		let completionFailure: string | undefined;
		try {
			await expect
				// Poll only the position, often: a 1 s interval added up to 1 s to elapsed time.
				.poll(() => page.evaluate(() => window.mediaStress.report().preview?.position), {
					timeout: 65_000,
					intervals: [100],
				})
				.toBeGreaterThanOrEqual(59.9);
		} catch (error) {
			completionFailure = error instanceof Error ? error.message : String(error);
		}
		const elapsedMs = Date.now() - playStarted;
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		const playback = await report();
		const presented = new Set(
			playback.draws
				.filter((draw) => draw.audio && draw.supported && draw.frame < 1800)
				.map((draw) => draw.frame),
		);
		const frameTimes = playback.draws
			.filter((draw) => draw.audio)
			.map((draw) => draw.ms)
			.sort((a, b) => a - b);
		const percentile = (fraction: number) =>
			frameTimes[Math.min(frameTimes.length - 1, Math.floor(frameTimes.length * fraction))] ?? null;
		let seeks: StressReport | undefined,
			paced: Array<{ sec: number; ms: number | null }> | undefined;
		if (!completionFailure) {
			await page.getByRole("button", { name: "Play", exact: true }).click();
			await page.evaluate(() => window.mediaStress.seekBurst());
			await expect
				.poll(async () => (await report()).preview?.position, { timeout: 15_000 })
				.toBeGreaterThanOrEqual(55);
			await page.getByRole("button", { name: "Pause", exact: true }).click();
			seeks = await report();
			phase = "paced seeks";
			console.log("STRESS_PHASE", phase);
			paced = await page.evaluate(() => window.mediaStress.pacedSeeks());
		}
		// Burst (playing): a seek counts as presented when a fully covered draw at or past the
		// target arrives before the next seek replaces it. Only the latest one should.
		const burst = seeks && {
			presented: seeks.seekRequests.map(({ at, sec }, index) => {
				const target = Math.floor(sec * 30),
					until = seeks!.seekRequests[index + 1]?.at ?? Infinity;
				const draw = seeks!.draws.find(
					(draw) => draw.supported && draw.at >= at && draw.at < until && draw.frame >= target,
				);
				return draw ? draw.at - at : null;
			}),
		};
		// Paced: request to presented frame for each of the 100 seeks, one at a time while paused.
		const seekLatency = paced && {
			requests: paced.length,
			timedOut: paced.filter(({ ms }) => ms === null).length,
			...(() => {
				const sorted = paced
					.map(({ ms }) => ms)
					.filter((ms): ms is number => ms !== null)
					.sort((a, b) => a - b);
				const at = (fraction: number) =>
					sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? null;
				return { p50: at(0.5), p95: at(0.95), max: sorted.at(-1) ?? null };
			})(),
			burstPresented: burst?.presented.filter((ms) => ms !== null).length,
			burstLastMs: burst?.presented.at(-1) ?? null,
			paced,
		};
		await page.evaluate(() => window.mediaStress.close());
		const disposed = await report();
		const result = {
			machine: execFileSync(
				"sysctl",
				["-n", "hw.model", "machdep.cpu.brand_string", "hw.memsize"],
				{ encoding: "utf8" },
			)
				.trim()
				.split("\n"),
			os: execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim(),
			browser: browser.version(),
			backend: "Chromium WebGPU / ANGLE Metal",
			sourceBytes: names.reduce((sum, name) => sum + statSync(join(fixtures, name)).size, 0),
			elapsedMs,
			readinessMs: playback.readinessMs,
			presented: presented.size,
			droppedPercent: (100 * (1800 - presented.size)) / 1800,
			frameTimeMs: { p50: percentile(0.5), p95: percentile(0.95) },
			seekLatency,
			peakBrowserTreeRssMiB: peakRssMiB,
			completionFailure,
			playback,
			seeks,
			disposed,
			pageErrors,
			downloads,
		};
		writeFileSync(info.outputPath("stress.json"), JSON.stringify(result, null, 2));
		console.log(
			"MEDIA_STRESS",
			JSON.stringify({
				elapsedMs,
				presented: result.presented,
				droppedPercent: result.droppedPercent,
				frameTimeMs: result.frameTimeMs,
				metrics: playback.metrics,
				peakRssMiB,
				seekLatency: seekLatency && { ...seekLatency, paced: undefined },
				completionFailure,
				transitions: playback.transitions.slice(0, 12),
			}),
		);
		expect(completionFailure).toBeUndefined();
		expect(result.droppedPercent).toBeLessThanOrEqual(1);
		expect(elapsedMs).toBeLessThanOrEqual(61_500);
		expect(playback.outputPeak).toBeGreaterThan(0.08);
		expect(playback.metrics?.visualPeak).toBeLessThanOrEqual(256 * 1024 * 1024);
		expect(playback.metrics?.pcmPeak).toBeLessThanOrEqual(16 * 1024 * 1024);
		expect(playback.metrics?.videoSlots).toBeLessThanOrEqual(2);
		expect(disposed.metrics?.pcmUsed).toBe(0);
		expect(disposed.metrics?.visualUsed).toBe(0);
		expect(disposed.contexts.every((state) => state === "closed")).toBe(true);
		expect(pageErrors).toEqual([]);
		expect(downloads).toBe(4);
		expect(seekLatency?.requests).toBe(100);
	} catch (error) {
		writeFileSync(
			info.outputPath("stress-failure.json"),
			JSON.stringify(
				{
					phase,
					peakRssMiB,
					error:
						error instanceof Error ? { message: error.message, stack: error.stack } : String(error),
				},
				null,
				2,
			),
		);
		throw error;
	} finally {
		clearInterval(monitor);
		await browser.close();
		await server.close();
		sourceServer.closeAllConnections();
		await new Promise<void>((resolve, reject) =>
			sourceServer.close((error) => (error ? reject(error) : resolve())),
		);
	}
});
