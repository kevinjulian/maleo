import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { createAudioOutput } from "../src/services/preview-media/audio-output.ts";

// The generated browser entry and capture observer below own these test globals.
declare global {
	interface Window {
		workletOutput: Awaited<ReturnType<typeof createAudioOutput>>;
		workletCaptured: Array<{ frame: number; pcm: Float32Array }>;
		workletContexts: AudioContext[];
		workletDetached: number[];
		outputFailure?: string;
		resumeDone?: boolean;
		closeWorklet(): Promise<{ remaining: number; maximumBytes: number }>;
	}
}

// The same browser switch as the codec matrix: WebKit output proof runs this spec unchanged.
test.use({ browserName: process.env.MEDIA_CODEC_BROWSER === "webkit" ? "webkit" : "chromium" });

test("gesture-owned worklet consumes real Rust blocks, preserves gaps and flushes seek/suspension audio", async ({
	page,
	context,
}, info) => {
	test.setTimeout(60_000);
	const entry = info.outputPath("output.ts"),
		bundle = info.outputPath("output.js");
	const services = resolve(import.meta.dirname, "../src/services/preview-media");
	writeFileSync(
		entry,
		`
import {createAudioOutput} from ${JSON.stringify(services + "/audio-output.ts")};
import {AudioTempo} from ${JSON.stringify(services + "/audio-tempo.ts")};
const moduleUrl="/renderer/maleo_renderer_wasm.js",native=await import(moduleUrl);await native.default();
const workletText=await(await fetch("/preview-audio-worklet.js")).text(),workletUrl=URL.createObjectURL(new Blob([workletText],{type:"text/javascript"}));
const budget=new native.PcmBudget(),snapshots=[];let output,tempo,maximumBytes=0,inputLease;
const account={reserve:bytes=>{const lease=budget.reserve(bytes);maximumBytes=Math.max(maximumBytes,budget.used());return lease;},release:lease=>budget.release(lease)};
document.querySelector("#play").onclick=async()=>{
 try{
  output=await createAudioOutput({budget:account,change:snapshot=>snapshots.push(snapshot),workletUrl});URL.revokeObjectURL(workletUrl);
  tempo=new AudioTempo(output.sampleRate,1,account);
  inputLease=account.reserve(12288*4*3);const source=new Float32Array(12288);source.fill(.25,0,4096);source.fill(-.25,8192);
  const input=JSON.stringify([{path:"pattern",sampleRate:output.sampleRate,channels:1,firstTimestamp:0,frames:source.length,windows:[{start:0,offset:0,count:source.length}]}]);
  const mix=JSON.stringify({fps:30,frames:30,voiceoverRanges:[],legacyVoiceover:null,sources:[{path:"pattern",url:"pattern",startFrame:0,frames:30,mediaStartSec:0,playbackRate:1,loopSource:false,embedded:false,kind:"voiceover",gainMode:"native",volume:1,volumeKeys:[],fadeInSec:0,fadeOutSec:0,duckUnderVoice:null}]});
  const detached=[];
  for(let at=0;at<source.length;at+=4096){
   const scratchLease=account.reserve(4096*2*4*3);
   const mixed=native.mix_audio(mix,input,source,output.sampleRate,2,at,4096),pcm=new Float32Array(8192);
   if(!tempo.push(mixed)||tempo.read(pcm)!==4096)throw Error("1x tempo bypass failed");
   if(!await output.push(pcm,output.generation))throw Error("Output backpressure before initial play");
   detached.push(pcm.byteLength);structuredClone(mixed.buffer,{transfer:[mixed.buffer]});account.release(scratchLease);
  }
  structuredClone(source.buffer,{transfer:[source.buffer]});account.release(inputLease);inputLease=undefined;
  Object.assign(globalThis,{workletOutput:output,workletSnapshots:snapshots,workletDetached:detached});output.play();
 }catch(error){Object.assign(globalThis,{outputFailure:String(error)});}
};
document.querySelector("#resume").onclick=async()=>{await output.resume();Object.assign(globalThis,{resumeDone:true});};
Object.assign(globalThis,{outputReady:true,closeWorklet:async()=>{await output.dispose();tempo.dispose();const remaining=budget.used();budget.free();return{remaining,maximumBytes};}});
`,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/audio-output-probe", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: '<!doctype html><button id="play">Play Rust output</button><button id="resume">Resume output</button>',
		}),
	);
	await context.route("**/preview-audio-worklet.js", async (route) => {
		const response = await route.fetch();
		const observe = `const register=globalThis.registerProcessor.bind(globalThis);globalThis.registerProcessor=(name,Base)=>register(name,class extends Base{process(inputs,outputs,parameters){const active=super.process(inputs,outputs,parameters);this.port.postMessage({type:"capture",frame:currentFrame,pcm:outputs[0][0].slice()});return active;}});`;
		await route.fulfill({ response, body: observe + (await response.text()) });
	});
	await page.goto("/audio-output-probe");
	await page.evaluate(() => {
		const captured: Array<{ frame: number; pcm: Float32Array }> = [],
			contexts: AudioContext[] = [];
		const OriginalContext = AudioContext,
			OriginalNode = AudioWorkletNode;
		globalThis.AudioContext = class extends OriginalContext {
			constructor(options?: AudioContextOptions) {
				super(options);
				contexts.push(this);
			}
		};
		globalThis.AudioWorkletNode = class extends OriginalNode {
			constructor(ctx: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
				super(ctx, name, options);
				this.port.addEventListener(
					"message",
					(event: MessageEvent<{ type: string; frame: number; pcm: Float32Array }>) => {
						if (event.data.type !== "capture") return;
						event.stopImmediatePropagation();
						captured.push({ frame: event.data.frame, pcm: event.data.pcm });
					},
				);
			}
		};
		Object.assign(globalThis, { workletCaptured: captured, workletContexts: contexts });
	});
	await page.addScriptTag({ type: "module", content: readFileSync(bundle, "utf8") });
	await page.waitForFunction(() => "outputReady" in globalThis);
	expect(await page.evaluate(() => window.workletContexts.length)).toBe(0);
	await page.getByRole("button", { name: "Play Rust output" }).click();
	await page.waitForFunction(() => "workletOutput" in globalThis || "outputFailure" in globalThis);
	expect(await page.evaluate(() => window.outputFailure)).toBeUndefined();
	await page.waitForFunction(() => window.workletOutput.snapshot.frames === 12288);
	await expect
		.poll(() =>
			page.evaluate(() =>
				window.workletCaptured.reduce(
					(count, row) => count + Array.from(row.pcm).filter((value) => value === -0.25).length,
					0,
				),
			),
		)
		.toBe(4096);
	const first = await page.evaluate(() => {
		const output = window.workletOutput,
			samples = window.workletCaptured.flatMap((row: { pcm: Float32Array }) =>
				Array.from(row.pcm),
			) as number[];
		const positive = samples.indexOf(0.25),
			negative = samples.indexOf(-0.25);
		return {
			frames: output.snapshot.frames,
			renderFrame: output.snapshot.renderFrame,
			capturedEnd: window.workletCaptured.reduce((end, row) => {
				const last = row.pcm.lastIndexOf(-0.25);
				return last < 0 ? end : Math.max(end, row.frame + last + 1);
			}, 0),
			positive: samples.filter((value) => value === 0.25).length,
			negative: samples.filter((value) => value === -0.25).length,
			gap: negative - positive - 4096,
			detached: window.workletDetached,
			queued: output.queuedFrames,
			timestamp: output.timestamp(),
			gapSilent: samples.slice(positive + 4096, negative).every((value) => value === 0),
		};
	});
	expect(first.renderFrame).toBe(first.capturedEnd);
	expect(first).toMatchObject({
		frames: 12288,
		positive: 4096,
		negative: 4096,
		gap: 4096,
		gapSilent: true,
		detached: [0, 0, 0],
	});
	await expect.poll(() => page.evaluate(() => window.workletOutput.queuedFrames)).toBe(0);
	const seek = await page.evaluate(async () => {
		const output = window.workletOutput;
		await output.flush();
		const old = output.generation;
		const accepted = await output.push(new Float32Array(output.sampleRate * 2 * 2).fill(0.9), old),
			backpressure = await output.push(new Float32Array(2), old);
		await output.flush();
		const stale = new Float32Array(2),
			staleAccepted = await output.push(stale, old);
		await output.push(new Float32Array(8192).fill(0.75), output.generation);
		await window.workletContexts[0].suspend();
		return { accepted, backpressure, staleAccepted, staleBytes: stale.byteLength };
	});
	expect(seek).toEqual({
		accepted: true,
		backpressure: false,
		staleAccepted: false,
		staleBytes: 8,
	});
	await expect
		.poll(() => page.evaluate(() => window.workletOutput.snapshot.state))
		.toBe("suspended");
	const suspendedGeneration = await page.evaluate(() => window.workletOutput.generation);
	await page.getByRole("button", { name: "Resume output" }).click();
	await page.waitForFunction(() => window.resumeDone === true);
	await expect.poll(() => page.evaluate(() => window.workletOutput.queuedFrames)).toBe(0);
	await page.evaluate(async () => {
		const output = window.workletOutput;
		await output.push(new Float32Array(1024).fill(0.125), output.generation);
		output.play();
	});
	await page.waitForFunction(() => window.workletOutput.snapshot.frames === 512);
	const result = await page.evaluate(async () => {
		const output = window.workletOutput,
			values = window.workletCaptured.flatMap((row: { pcm: Float32Array }) =>
				Array.from(row.pcm),
			) as number[];
		return {
			snapshot: output.snapshot,
			staleSound: values.some((value) => Math.abs(value - 0.9) < 1e-6 || value === 0.75),
			freshSamples: values.filter((value) => value === 0.125).length,
			cleanup: await window.closeWorklet(),
			contextState: window.workletContexts[0].state,
		};
	});
	expect(result.staleSound).toBe(false);
	expect(result.freshSamples).toBe(512);
	expect(result.snapshot.generation).toBe(suspendedGeneration);
	expect(result.cleanup.remaining).toBe(0);
	expect(result.cleanup.maximumBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
	expect(result.contextState).toBe("closed");
	await page.evaluate(() => {
		AudioContext.prototype.resume = async () => {
			throw new DOMException("Output activation rejected", "NotAllowedError");
		};
	});
	await page.getByRole("button", { name: "Play Rust output" }).click();
	await page.waitForFunction(() => window.outputFailure !== undefined);
	const rejection = await page.evaluate(() => ({
		message: window.outputFailure,
		contexts: window.workletContexts.map((context) => context.state),
	}));
	expect(rejection.message).toContain("Output activation rejected");
	expect(rejection.contexts).toEqual(["closed", "closed"]);
	writeFileSync(
		info.outputPath("audio-output.json"),
		JSON.stringify({ first, seek, result, rejection }, null, "\t") + "\n",
	);
});
