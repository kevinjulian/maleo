import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { replayApi } from "./har.ts";
import { FIXTURE_PROJECT_ID } from "./screens.ts";

async function command(page: Page, kind: string, frame = 0) {
	await page.evaluate(
		({ kind, frame }) => {
			// SAFETY: this test's generated entry owns the probe and these commands.
			const scope = globalThis as typeof globalThis & {
				renderedMediaProbe: { command(kind: string, frame: number): void };
			};
			scope.renderedMediaProbe.command(kind, frame);
		},
		{ kind, frame },
	);
}
async function pixels(page: Page) {
	const png = await page.locator("canvas").screenshot();
	return execFileSync(
		"ffmpeg",
		["-v", "error", "-i", "pipe:0", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"],
		{ input: png },
	);
}
function frameId(rgba: Buffer, left = 0, scale = 1, threshold = 128) {
	let id = 0;
	for (let bit = 0; bit < 8; bit++) {
		const x = left + Math.floor((bit * 20 + 10) * scale),
			at = (16 * 160 + x) * 4;
		if ((rgba[at]! + rgba[at + 1]! + rgba[at + 2]!) / 3 > threshold) id |= 1 << bit;
	}
	return id;
}

test("Rust worker renders local video placements and images, seeks offline and releases native slots", async ({
	playwright,
}, info) => {
	test.setTimeout(180_000);
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			"-f",
			"lavfi",
			"-i",
			"color=green:size=160x96",
			"-frames:v",
			"1",
			"-threads",
			"1",
			join(fixtures, "image.png"),
		],
		{ stdio: "pipe" },
	);
	const editor = resolve(import.meta.dirname, "../../../packages/shared/src/editor"),
		media = resolve(import.meta.dirname, "../src/services/preview-media"),
		models = resolve(import.meta.dirname, "../src/models/timeline");
	const entry = info.outputPath("probe.ts"),
		bundle = info.outputPath("probe.js");
	writeFileSync(
		entry,
		`
 import {instantiateEngine} from ${JSON.stringify(editor + "/engine.ts")};
 import {provideEditorEngine} from ${JSON.stringify(editor + "/engine-registry.ts")};
 import {createPreviewMediaSession} from ${JSON.stringify(media + "/session.ts")};
 import {createCompareMediaBridge} from ${JSON.stringify(media + "/compare-bridge.ts")};
 import {createPreviewClient} from ${JSON.stringify(models + "/preview-client.ts")};
 const errors=[],states=[];let pool=null;
 Object.assign(globalThis,{startRenderedMediaProbe:async()=>{
  const engine=await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer()));provideEditorEngine(engine);
  let ready;const loaded=new Promise(resolve=>ready=resolve);
  const owner=createPreviewMediaSession({resolve:async source=>({url:source.url,credentials:"omit"}),changed:()=>{if(owner.snapshot().ready&&owner.resolve(location.origin+"/rendered-sources/cfr-av.mp4")&&owner.resolve(location.origin+"/rendered-sources/image.png"))ready();}});
  owner.update({sources:[{id:"video",revision:"r1",url:location.origin+"/rendered-sources/cfr-av.mp4",kinds:["video"],clipIds:["clip"]},{id:"image",revision:"r1",url:location.origin+"/rendered-sources/image.png",kinds:["image"],clipIds:["image"]}],clips:[{id:"clip",sourceIds:["video"],blockers:[]},{id:"image",sourceIds:["image"],blockers:[]}]});await loaded;
  const video=owner.resolve(location.origin+"/rendered-sources/cfr-av.mp4"),image=owner.resolve(location.origin+"/rendered-sources/image.png");
  const worker=new Worker("/renderer/preview-worker.js",{type:"module"});
  const decoderEvents=[];const rawPost=worker.postMessage.bind(worker);worker.postMessage=(value,...rest)=>{if(value.type.startsWith("decoder-"))decoderEvents.push({direction:"send",...value});rawPost(value,...rest);};const rawStates=[];worker.addEventListener("message",event=>{if(event.data.type.startsWith("decoder-"))decoderEvents.push({direction:"receive",...event.data});if(event.data.type==="state"){rawStates.push(structuredClone(event.data));if(rawStates.length>20)rawStates.shift();}if(event.data.probeStats){pool=event.data.probeStats;}delete event.data.probeStats;});
  const bridge=createCompareMediaBridge(worker,error=>errors.push(error));
  const client=createPreviewClient(worker,state=>states.push(state),error=>errors.push(error),undefined,bridge.handle,bridge.dispose);
  worker.onerror=event=>errors.push(event.message);
  client.init(document.querySelector("canvas").transferControlToOffscreen());
  const bindings=()=>bridge.bindings([video,image]);
  const readiness=()=>({revision:"rendered-local",sourceGeneration:owner.snapshot().generation,sequence:0,ready:owner.snapshot().ready,blockers:[]});
  function show(kind,frame=0){
   if(kind==="rapid"){for(let i=0;i<100;i++)client.seek((i*7)%45);return;}
   if(kind==="seek"){client.seek(frame);return;}
   if(kind==="clear"){client.storyboard(JSON.stringify({scenes:[]}),30,60,[],readiness(),bridge.bindings([]));return;}
   const layout={widthPct:100,heightPct:100,fit:"stretch"};
   const story={scenes:[],bgColor:"#000000"};
   if(kind==="scene")story.scenes=[{image:"",durationSec:2,movement:"Static",transition:"cut",visualClips:[{url:video,kind:"video",mediaStartSec:.4,sourceDurationSec:1.6,layout}]}];
   if(kind==="timeline")story.visualTimeline=[{url:video,kind:"video",startSec:0,durationSec:2,mediaStartSec:.5,sourceDurationSec:1.5,layout}];
   if(kind==="overlap")story.videoOverlays=[{url:video,kind:"video",startSec:0,durationSec:2,mediaStartSec:.1,layout:{...layout,widthPct:50}},{url:video,kind:"video",startSec:0,durationSec:2,mediaStartSec:1.5,layout:{...layout,widthPct:50,xPct:50}}];
   if(kind==="transition")story.visualTimeline=[{url:video,kind:"video",startSec:0,durationSec:.5,sourceDurationSec:.5,layout:{...layout,widthPct:50}},{url:video,kind:"video",startSec:.5,durationSec:1,mediaStartSec:1,sourceDurationSec:1,transition:"fade",transitionDurSec:.4,layout:{...layout,widthPct:50,xPct:50}}];
   if(kind==="missing")story.videoOverlays=[{url:video+"#unavailable",kind:"video",startSec:0,durationSec:2,layout}];
   if(kind==="image")story.videoOverlays=[{url:image,kind:"image",startSec:0,durationSec:2,layout}];
   client.storyboard(JSON.stringify(story),30,60,[image],readiness(),bindings());client.seek(frame);
  }
  Object.assign(globalThis,{renderedMediaProbe:{command:show,report:()=>({errors,states,pool,rawStates,decoderEvents}),close:async()=>{client.dispose();await bridge.dispose();worker.terminate();bridge.terminated();await owner.dispose();const check=engine.decoderOpen();const requested=engine.decoderRequest(check,1,1,2);if(!requested.ok)throw new Error(requested.error.message);const result=engine.decoderGrants();if(!result.ok)throw new Error(result.error.message);const grants=JSON.parse(result.value);if(!grants.some(grant=>grant.owner===check))throw new Error("Video decoder slots remain held after disposal");engine.decoderClose(check);return {errors,states,pool};}}});
  show("overlap");
 }});
 `,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	try {
		const context = await browser.newContext({
			baseURL: "http://127.0.0.1:3031",
			viewport: { width: 160, height: 96 },
			deviceScaleFactor: 1,
		});
		await context.route("**/rendered-media-probe", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><style>body{margin:0}canvas{display:block}</style><canvas width="160" height="96"></canvas>',
			}),
		);
		let downloads = 0;
		await context.route("**/rendered-sources/*", (route) => {
			downloads++;
			const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
			return route.fulfill({
				path: join(fixtures, name),
				contentType: name.endsWith("png") ? "image/png" : "video/mp4",
			});
		});
		await context.route("**/renderer/maleo_renderer_wasm.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					(await response.text()) +
					`\nconst originalDispatch=MediaPool.prototype.dispatch;MediaPool.prototype.dispatch=function(payload){const result=originalDispatch.call(this,payload);const stats=JSON.parse(originalDispatch.call(this,'{"type":"stats"}'));const previous=globalThis.visualProbeStats;globalThis.visualProbeStats={...stats,peakBytes:Math.max(previous?.peakBytes??0,stats.cachedBytes+stats.reservedBytes),peakVideoJobs:Math.max(previous?.peakVideoJobs??0,stats.videoDecoders)};return result;};`,
			});
		});
		await context.route("**/renderer/preview-worker.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`const post=globalThis.postMessage.bind(globalThis);globalThis.postMessage=(value,...rest)=>post({...value,probeStats:globalThis.visualProbeStats},...rest);\n` +
					(await response.text()),
			});
		});
		const page = await context.newPage();
		const pageErrors: string[] = [];
		page.on("pageerror", (error) => pageErrors.push(error.message));
		await page.goto("/rendered-media-probe");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		await page.evaluate(async () => {
			// SAFETY: the entry generated above owns this startup function.
			await (
				globalThis as typeof globalThis & { startRenderedMediaProbe(): Promise<void> }
			).startRenderedMediaProbe();
		});
		await expect
			.poll(
				async () => {
					const rgba = await pixels(page);
					return [frameId(rgba, 0, 0.5), frameId(rgba, 80, 0.5)];
				},
				{ timeout: 90_000 },
			)
			.toEqual([1, 18]);
		expect(downloads).toBe(2);
		await context.setOffline(true);
		await command(page, "scene");
		await expect.poll(async () => frameId(await pixels(page)), { timeout: 30_000 }).toBe(5);
		await command(page, "timeline");
		await expect
			.poll(async () => frameId(await pixels(page)), { timeout: 30_000 })
			.toBe(6)
			.catch(async (error: unknown) => {
				await page.locator("canvas").screenshot({ path: info.outputPath("timeline-failure.png") });
				const report = await page.evaluate(() => {
					// SAFETY: generated entry owns worker state and decoder errors.
					return (
						globalThis as typeof globalThis & { renderedMediaProbe: { report(): unknown } }
					).renderedMediaProbe.report();
				});
				writeFileSync(info.outputPath("timeline-failure.json"), JSON.stringify(report, null, 2));
				throw error;
			});
		await command(page, "rapid");
		await expect.poll(async () => frameId(await pixels(page)), { timeout: 30_000 }).toBe(13);
		await command(page, "clear");
		await command(page, "transition", 18);
		await expect
			.poll(
				async () => {
					const rgba = await pixels(page);
					return [frameId(rgba, 0, 0.5), frameId(rgba, 80, 0.5, 24)];
				},
				{ timeout: 30_000 },
			)
			.toEqual([6, 13]);
		const transition = await pixels(page);
		expect(transition[(16 * 160 + 15) * 4]).toBeGreaterThan(150);
		expect(transition[(16 * 160 + 85) * 4]).toBeLessThan(100);
		await command(page, "missing");
		await expect
			.poll(() =>
				page.evaluate(() => {
					// SAFETY: this test's entry owns the report of actual worker states.
					const scope = globalThis as typeof globalThis & {
						renderedMediaProbe: {
							report(): { states: Array<{ coverage: Array<{ path: string; reason: string }> }> };
						};
					};
					return scope.renderedMediaProbe.report().states.at(-1)?.coverage ?? [];
				}),
			)
			.toContainEqual(
				expect.objectContaining({ path: "videoOverlays[0]", reason: "missing media" }),
			)
			.catch(async (error: unknown) => {
				const report = await page.evaluate(() => {
					// SAFETY: generated test probe owns raw/accepted worker ledgers.
					return (
						globalThis as typeof globalThis & { renderedMediaProbe: { report(): unknown } }
					).renderedMediaProbe.report();
				});
				writeFileSync(
					info.outputPath("missing-media-failure.json"),
					JSON.stringify(report, null, 2),
				);
				throw error;
			});
		await command(page, "clear");
		await command(page, "timeline", 18);
		await expect.poll(async () => frameId(await pixels(page)), { timeout: 30_000 }).toBe(13);
		await command(page, "image");
		await expect
			.poll(
				async () => {
					const rgba = await pixels(page),
						at = (48 * 160 + 80) * 4;
					return rgba[at + 1]! - Math.max(rgba[at]!, rgba[at + 2]!);
				},
				{ timeout: 30_000 },
			)
			.toBeGreaterThan(60);
		const result = await page.evaluate(async () => {
			// SAFETY: the generated entry owns this report and cleanup function.
			const scope = globalThis as typeof globalThis & {
				renderedMediaProbe: {
					close(): Promise<{
						errors: string[];
						pool: {
							cachedBytes: number;
							reservedBytes: number;
							videoDecoders: number;
							peakBytes: number;
							peakVideoJobs: number;
						};
					}>;
				};
			};
			return scope.renderedMediaProbe.close();
		});
		expect(pageErrors).toEqual([]);
		expect(result.errors).toEqual([]);
		expect(downloads).toBe(2);
		expect(result.pool).toMatchObject({ cachedBytes: 0, reservedBytes: 0, videoDecoders: 0 });
		expect(result.pool.peakBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
		expect(result.pool.peakVideoJobs).toBe(2);
		writeFileSync(info.outputPath("rendered-media.json"), JSON.stringify(result, null, 2));
	} finally {
		await browser.close();
	}
});

test("production compare panel seeks a completed local video while offline", async ({
	playwright,
}, info) => {
	test.setTimeout(120_000);
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
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
		await replayApi(context, join(import.meta.dirname, "fixtures/api.har"));
		let downloads = 0;
		await context.route("**/compare-local.mp4", (route) => {
			downloads++;
			return route.fulfill({ path: join(fixtures, "cfr-av.mp4"), contentType: "video/mp4" });
		});
		const page = await context.newPage();
		const errors: string[] = [];
		page.on("pageerror", (error) => errors.push(error.message));
		await page.addInitScript(() => {
			const original = globalThis.fetch;
			globalThis.fetch = Object.assign(
				async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
					const response = await original(input, init);
					const url =
						typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
					if (!/\/api\/operations\/projects\/[^/?]+(\?|$)/.test(url)) return response;
					const detail = await response
						.clone()
						.json()
						.catch(() => null);
					if (!Array.isArray(detail?.storyboards?.[0]?.storyboard_json?.clips)) return response;
					detail.storyboards[0].storyboard_json.clips = [
						{
							id: "video:900",
							type: "video",
							startSec: 0,
							durationSec: 2,
							track: 0,
							video: {
								id: 900,
								kind: "video",
								start: 0,
								dur: 2,
								track: 0,
								url: location.origin + "/compare-local.mp4",
								sourceDurationSec: 2,
								volume: 0,
							},
						},
					];
					return new Response(JSON.stringify(detail), {
						status: response.status,
						headers: { "content-type": "application/json" },
					});
				},
				original,
			);
		});
		await page.goto(`/content/${FIXTURE_PROJECT_ID}?renderer=compare`);
		await expect(page.locator(".tl2-timeline")).toBeVisible();
		const panel = page.getByRole("region", { name: "Rust renderer", exact: true });
		await expect(panel.locator("[data-slot=panel-header-sub]")).toContainText(/Frame [0-9]/, {
			timeout: 60_000,
		});
		await expect(panel).not.toContainText("`video` media");
		await expect(panel).not.toContainText("missing media", { timeout: 30_000 });
		await expect(panel.getByRole("alert")).toHaveCount(0);
		const before = await panel.locator("canvas").screenshot();
		const loaded = downloads;
		await context.setOffline(true);
		const slider = page.getByRole("slider", { name: "Playhead", exact: true });
		await slider.focus();
		for (let frame = 0; frame < 45; frame++) await slider.press("ArrowRight");
		await expect(slider).toHaveAttribute("aria-valuenow", "1.5");
		await expect(panel).not.toContainText("missing media", { timeout: 30_000 });
		await expect
			.poll(async () => (await panel.locator("canvas").screenshot()).equals(before), {
				timeout: 30_000,
			})
			.toBe(false);
		expect(downloads).toBe(loaded);
		expect(errors).toEqual([]);
		await page.screenshot({ path: info.outputPath("production-compare-local-video.png") });
	} finally {
		await browser.close();
	}
});
