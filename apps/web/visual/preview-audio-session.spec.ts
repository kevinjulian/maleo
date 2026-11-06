import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("real Rust output owns preview time and stops on Pause, GPU loss and suspension", async ({
	playwright,
}, info) => {
	test.setTimeout(90_000);
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	const src = resolve(import.meta.dirname, "../src"),
		editor = resolve(import.meta.dirname, "../../../packages/shared/src/editor");
	const entry = info.outputPath("session.ts"),
		bundle = info.outputPath("session.js");
	writeFileSync(
		entry,
		`
import {instantiateEngine} from ${JSON.stringify(editor + "/engine.ts")};
import {provideEditorEngine} from ${JSON.stringify(editor + "/engine-registry.ts")};
import {createPreviewMediaSession} from ${JSON.stringify(src + "/services/preview-media/session.ts")};
import {createCompareMediaBridge} from ${JSON.stringify(src + "/services/preview-media/compare-bridge.ts")};
import {createCompareAudio} from ${JSON.stringify(src + "/services/preview-media/compare-audio.ts")};
import {createPreviewClient} from ${JSON.stringify(src + "/models/timeline/preview-client.ts")};
Object.assign(globalThis,{prepareSession:async()=>{
 const engine=await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer()));provideEditorEngine(engine);
 const file=new File([await(await fetch("/audio-session-sources/impulses-48000.wav")).blob()],"impulses-48000.wav"),video=new File([await(await fetch("/audio-session-sources/vfr-silent.mp4")).blob()],"video.mp4");
 let ready;const loaded=new Promise(resolve=>ready=resolve);
 const owner=createPreviewMediaSession({resolve:async()=>{throw Error("Unexpected source fetch");},changed:()=>{if(owner.snapshot().ready&&owner.resolve("audio")&&owner.resolve("video"))ready();}});
 owner.update({sources:[{id:"audio",revision:"r1",url:"audio",kinds:["audio"],clipIds:["voice"]},{id:"video",revision:"r1",url:"video",kinds:["video"],clipIds:["visual"]}],clips:[{id:"voice",sourceIds:["audio"],blockers:[]},{id:"visual",sourceIds:["video"],blockers:[]}]},new Map([["audio",file],["video",video]]));await loaded;
 const url=owner.resolve("audio"),worker=new Worker("/renderer/preview-worker.js",{type:"module"});
 const states=[],audioStates=[],errors=[];let audio;
 const bridge=createCompareMediaBridge(worker,error=>errors.push(error));
 const client=createPreviewClient(worker,state=>{states.push(state);audio?.observe(state);},error=>errors.push(error),undefined,event=>{if(!audio?.handle(event))bridge.handle(event);},bridge.dispose);
 audio=await createCompareAudio(worker,client,state=>audioStates.push(state));
 client.init(document.querySelector("canvas").transferControlToOffscreen());
 const story=JSON.stringify({scenes:[],visualTimeline:[{url:owner.resolve("video"),kind:"video",startSec:0,durationSec:3,sourceDurationSec:2,layout:{widthPct:100,heightPct:100,fit:"stretch"}}],audioOverlays:[{url,kind:"voiceover",startSec:0,durationSec:3,volume:1}]});let revision="audio-r1";const readiness=(ready,sequence)=>({revision,sourceGeneration:owner.snapshot().generation,sequence,ready,blockers:[]});
 client.storyboard(story,30,90,[],readiness(owner.snapshot().ready,0),bridge.bindings([url,owner.resolve("video")]));
 document.querySelector("#change").onclick=()=>{revision="audio-r2";client.storyboard(story,30,90,[],readiness(false,0),bridge.bindings([url,owner.resolve("video")]));};document.querySelector("#ready").onclick=()=>client.readiness(readiness(true,1));
 document.querySelector("#play").onclick=()=>audio.start(states.at(-1)?.position??0,1);
 document.querySelector("#pause").onclick=()=>audio.pause(states.at(-1)?.position??0);
 document.querySelector("#seek").onclick=()=>audio.seek(1,1);document.querySelector("#rewind").onclick=()=>audio.seek(.5,1);
 Object.assign(globalThis,{audioSession:{states,audioStates,errors,worker,close:async()=>{await audio.dispose();client.pause(states.at(-1)?.position??0);return{states,audioStates,errors};}},finishAudioSession:async()=>{client.dispose();await bridge.dispose();worker.terminate();bridge.terminated();await owner.dispose();}});
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
		const context = await browser.newContext({ baseURL: "http://127.0.0.1:3031" });
		await context.route("**/audio-session-probe", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><button id="play">Play</button><button id="pause">Pause</button><button id="seek">Seek 1 s</button><button id="rewind">Rewind paused</button><button id="change">Change media</button><button id="ready">Finish media</button><canvas width="160" height="96"></canvas>',
			}),
		);
		await context.route("**/audio-session-sources/*", (route) =>
			route.fulfill({
				path: join(fixtures, new URL(route.request().url()).pathname.split("/").at(-1)!),
			}),
		);
		await context.route("**/renderer/maleo_renderer_wasm.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					(await response.text()) +
					`
const realRecover=recover_device;recover_device=async()=>{await new Promise(resolve=>setTimeout(resolve,300));return realRecover();};
const reserve=PcmBudget.prototype.reserve,release=PcmBudget.prototype.release;
PcmBudget.prototype.reserve=function(bytes){const id=reserve.call(this,bytes);globalThis.audioBudgetPeak=Math.max(globalThis.audioBudgetPeak??0,this.used());globalThis.audioBudgetUsed=this.used();return id;};
PcmBudget.prototype.release=function(id){release.call(this,id);globalThis.audioBudgetUsed=this.used();};
`,
			});
		});
		await context.route("**/preview-audio-worklet.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					`const register=globalThis.registerProcessor.bind(globalThis);globalThis.registerProcessor=(name,Base)=>register(name,class extends Base{process(inputs,outputs,parameters){const active=super.process(inputs,outputs,parameters);this.port.postMessage({type:"capture",pcm:outputs[0][0].slice()});return active;}});` +
					(await response.text()),
			});
		});
		const page = await context.newPage();
		await page.goto("/audio-session-probe");
		await page.evaluate(() => {
			const contexts: AudioContext[] = [];
			const captured: Float32Array[] = [];
			const Original = AudioContext;
			globalThis.AudioContext = class extends Original {
				constructor(options?: AudioContextOptions) {
					super(options);
					contexts.push(this);
				}
			};
			const OriginalNode = AudioWorkletNode;
			globalThis.AudioWorkletNode = class extends OriginalNode {
				constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
					super(context, name, options);
					this.port.addEventListener("message", (event) => {
						if (event.data.type === "capture") {
							captured.push(event.data.pcm);
							event.stopImmediatePropagation();
						}
					});
					this.port.start();
				}
			};
			Object.assign(globalThis, { sessionContexts: contexts, sessionCaptured: captured });
		});
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		await page.evaluate(async () => {
			// SAFETY: generated test entry owns its source and worker setup.
			await (
				globalThis as typeof globalThis & { prepareSession(): Promise<void> }
			).prepareSession();
		});
		const report = () =>
			page.evaluate(() => {
				// SAFETY: generated test entry owns the state ledgers.
				const probe = (
					globalThis as typeof globalThis & {
						audioSession: {
							states: Array<{
								status: string;
								position: number;
								clockOwner: string;
								mediaReady: boolean;
							}>;
							audioStates: Array<{ status: string; message?: string }>;
							errors: string[];
						};
					}
				).audioSession;
				return {
					preview: probe.states.at(-1),
					audio: probe.audioStates.at(-1),
					errors: probe.errors,
				};
			});
		await expect.poll(async () => (await report()).preview?.mediaReady).toBe(true);
		expect(
			await page.evaluate(() => {
				// SAFETY: this test installed the context ledger before controller creation.
				return (globalThis as typeof globalThis & { sessionContexts: AudioContext[] })
					.sessionContexts.length;
			}),
		).toBe(0);
		await context.setOffline(true);
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect.poll(report, { timeout: 15_000 }).toMatchObject({
			preview: { clockOwner: "audio", status: "playing" },
			audio: { status: "playing" },
			errors: [],
		});
		await expect.poll(async () => (await report()).preview?.position).toBeGreaterThan(0.2);
		expect(
			await page.evaluate(() => {
				// SAFETY: this test's worklet observer records actual output channel samples.
				return (
					globalThis as typeof globalThis & { sessionCaptured: Float32Array[] }
				).sessionCaptured.some((block) => block.some((sample) => Math.abs(sample) > 0.1));
			}),
		).toBe(true);
		await page.getByRole("button", { name: "Seek 1 s", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.position).toBeGreaterThanOrEqual(1);
		await expect.poll(async () => (await report()).audio?.status).toBe("playing");
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect.poll(async () => (await report()).audio?.status).toBe("paused");
		const paused = (await report()).preview!.position;
		await page.waitForTimeout(150);
		expect((await report()).preview!.position).toBe(paused);
		await page.getByRole("button", { name: "Rewind paused", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.position).toBe(0.5);
		expect((await report()).preview?.status).toBe("paused");
		expect((await report()).audio?.status).toBe("paused");
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.status).toBe("playing");
		await page.getByRole("button", { name: "Change media", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.mediaReady).toBe(false);
		await expect.poll(async () => (await report()).audio?.status).toBe("paused");
		const changedPosition = (await report()).preview!.position;
		await page.getByRole("button", { name: "Finish media", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.mediaReady).toBe(true);
		expect((await report()).preview).toMatchObject({ status: "paused", position: changedPosition });
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect.poll(async () => (await report()).audio?.status).toBe("playing");
		const worker = page.workers().find((worker) => worker.url().includes("preview-worker.js"));
		if (!worker) throw new Error("Preview worker is missing");
		await worker.evaluate(() => {
			// SAFETY: renderer worker exposes its native device loss hook.
			(globalThis as typeof globalThis & { loseDevice(): void }).loseDevice();
		});
		await expect.poll(async () => (await report()).preview?.status).toBe("device-lost");
		const held = (await report()).preview!.position;
		await page.waitForTimeout(100);
		expect((await report()).preview!.position).toBe(held);
		await expect.poll(report, { timeout: 10_000 }).toMatchObject({
			preview: { status: "playing", clockOwner: "audio" },
			audio: { status: "playing" },
		});
		await worker.evaluate(() => {
			// SAFETY: renderer worker exposes the same actual native device loss hook.
			(globalThis as typeof globalThis & { loseDevice(): void }).loseDevice();
		});
		await expect.poll(async () => (await report()).preview?.status).toBe("device-lost");
		await page.getByRole("button", { name: "Pause", exact: true }).click();
		await expect.poll(async () => (await report()).preview?.status).toBe("paused");
		expect((await report()).audio?.status).toBe("paused");
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect.poll(async () => (await report()).audio?.status).toBe("playing");
		await page.evaluate(async () => {
			// SAFETY: this test's context ledger contains actual controller-owned contexts.
			await (globalThis as typeof globalThis & { sessionContexts: AudioContext[] }).sessionContexts
				.at(-1)!
				.suspend();
		});
		await expect.poll(async () => (await report()).audio?.status).toBe("suspended");
		await page.getByRole("button", { name: "Play", exact: true }).click();
		await expect.poll(async () => (await report()).audio?.status).toBe("playing");
		await worker.evaluate(() => {
			// Patch the prototype, not the constructor: a held audio worker (one per source revision)
			// is reused across windows, so a new-worker-only failure may never be reached.
			const send = Worker.prototype.postMessage;
			Object.assign(globalThis, { audioDecodeFailures: 0 });
			Worker.prototype.postMessage = function (
				this: Worker,
				message: unknown,
				options?: Transferable[] | StructuredSerializeOptions,
			) {
				if (message && typeof message === "object" && "file" in message && "start" in message) {
					// SAFETY: this test initialized the failure counter above.
					(globalThis as typeof globalThis & { audioDecodeFailures: number }).audioDecodeFailures++;
					queueMicrotask(() =>
						this.dispatchEvent(
							new ErrorEvent("error", { message: "Injected audio decoder failure" }),
						),
					);
					return;
				}
				send.call(this, message, Array.isArray(options) ? { transfer: options } : options);
			} as Worker["postMessage"];
		});
		// Decode is ahead of playback (held worker and warm block): the rest of this 3 s fixture may be
		// decoded already, so seek back to make the next start decode through the failing worker.
		await page.getByRole("button", { name: "Rewind paused", exact: true }).click();
		await expect
			.poll(async () => (await report()).audio?.status, { timeout: 10_000 })
			.toBe("failed");
		await expect.poll(async () => (await report()).preview?.status).toBe("paused");
		expect((await report()).audio?.message).toContain("Audio decoder worker failed");
		// The first start and two recovery attempts, each a paused warm-block decode plus its start decode.
		expect(
			await worker.evaluate(() => {
				// SAFETY: this test initialized and incremented the injected failure counter.
				return (globalThis as typeof globalThis & { audioDecodeFailures: number })
					.audioDecodeFailures;
			}),
		).toBe(6);
		const result = await page.evaluate(async () => {
			// SAFETY: generated entry owns disposal and the returned ledgers.
			return (
				globalThis as typeof globalThis & { audioSession: { close(): Promise<unknown> } }
			).audioSession.close();
		});
		await expect
			.poll(
				async () =>
					await worker.evaluate(() => {
						// SAFETY: this test's module wrapper records the actual native budget.
						return (globalThis as typeof globalThis & { audioBudgetUsed: number }).audioBudgetUsed;
					}),
			)
			.toBe(0);
		const peak = await worker.evaluate(() => {
			// SAFETY: this test's module wrapper records the actual native budget.
			return (globalThis as typeof globalThis & { audioBudgetPeak: number }).audioBudgetPeak;
		});
		expect(peak).toBeLessThanOrEqual(16 * 1024 * 1024);
		expect((await report()).errors).toEqual([]);
		expect(
			await page.evaluate(() => {
				// SAFETY: this test owns the context ledger.
				return (
					globalThis as typeof globalThis & { sessionContexts: AudioContext[] }
				).sessionContexts.every((context) => context.state === "closed");
			}),
		).toBe(true);
		await page.evaluate(async () => {
			// SAFETY: generated entry owns final worker and File cleanup.
			await (
				globalThis as typeof globalThis & { finishAudioSession(): Promise<void> }
			).finishAudioSession();
		});
		writeFileSync(
			info.outputPath("audio-session.json"),
			JSON.stringify({ peak, result }, null, "\t") + "\n",
		);
	} finally {
		await browser.close();
	}
});
