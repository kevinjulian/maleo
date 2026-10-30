import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("Rust PCM and upstream transport preserve captured 440 Hz pitch with bounded resettable state", async ({
	page,
	context,
}, info) => {
	test.setTimeout(60_000);
	const entry = info.outputPath("tempo.ts"),
		bundle = info.outputPath("tempo.js");
	writeFileSync(
		entry,
		`
import {AudioTempo} from ${JSON.stringify(resolve(import.meta.dirname, "../src/services/preview-media/audio-tempo.ts"))};
const moduleUrl="/renderer/maleo_renderer_wasm.js",native=await import(moduleUrl);await native.default();
const rate=Number(new URLSearchParams(location.search).get("rate"));
document.querySelector("button").onclick=async()=>{
 const context=new AudioContext();await context.resume();
 const sampleRate=context.sampleRate,frames=sampleRate,budget=new native.PcmBudget();let maximumBytes=0;
 const account={reserve:bytes=>{const lease=budget.reserve(bytes);maximumBytes=Math.max(maximumBytes,budget.used());return lease;},release:lease=>budget.release(lease)};
 const inputLease=account.reserve(frames*4*3),outputFrames=Math.round(frames/rate),outputLease=account.reserve(outputFrames*2*4*2),scratchLease=account.reserve(512*2*4*3);
 const input=new Float32Array(frames),output=new Float32Array(outputFrames*2),scratch=new Float32Array(1024),tempo=new AudioTempo(sampleRate,rate,account);
 for(let i=0;i<frames;i++)input[i]=Math.sin(2*Math.PI*440*i/sampleRate)*.5;
 const source={path:"tone",url:"tone",startFrame:0,frames:60,mediaStartSec:0,playbackRate:1,loopSource:false,embedded:false,kind:"voiceover",gainMode:"native",volume:1,volumeKeys:[],fadeInSec:0,fadeOutSec:0,duckUnderVoice:null};
 const mix=JSON.stringify({fps:30,frames:60,sources:[source],voiceoverRanges:[],legacyVoiceover:null}),inputs=JSON.stringify([{path:"tone",sampleRate,channels:1,firstTimestamp:0,frames,windows:[{start:0,offset:0,count:frames}]}]);
 let written=0;
 function drain(){let count;while((count=tempo.read(scratch))>0){if(written+count>outputFrames)throw Error("Global rate applied more than once");output.set(scratch.subarray(0,count*2),written*2);written+=count;}}
 for(let at=0;at<frames;at+=512){const pcm=native.mix_audio(mix,inputs,input,sampleRate,2,at,Math.min(512,frames-at));if(!tempo.push(pcm))throw Error("Unexpected tempo backpressure");drain();}
 tempo.finish();drain();const primingFrames=tempo.primingFrames;
 tempo.reset(1);const resetFrames=tempo.read(scratch);tempo.dispose();
 structuredClone(input.buffer,{transfer:[input.buffer]});account.release(inputLease);account.release(scratchLease);
 const buffer=context.createBuffer(2,written,sampleRate);
 for(let channel=0;channel<2;channel++){const plane=buffer.getChannelData(channel);for(let i=0;i<written;i++)plane[i]=output[i*2+channel];}
 const sourceNode=context.createBufferSource(),analyser=context.createAnalyser();analyser.fftSize=16384;sourceNode.buffer=buffer;sourceNode.connect(analyser);analyser.connect(context.destination);sourceNode.start();
 Object.assign(globalThis,{readTempo:()=>{const bins=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(bins);let peak=0;for(let i=1;i<bins.length;i++)if(bins[i]>bins[peak])peak=i;return {rate,sampleRate,frames:written,targetFrames:outputFrames,primingFrames,resetFrames,hz:peak*sampleRate/analyser.fftSize,db:bins[peak],maximumBytes,currentBytes:budget.used()};},closeTempo:async()=>{await context.close();sourceNode.buffer=null;structuredClone(output.buffer,{transfer:[output.buffer]});account.release(outputLease);const bytes=budget.used();budget.free();return bytes;}});
};
Object.assign(globalThis,{tempoReady:true});
`,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/audio-tempo-probe*", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><button>Play Rust tone</button>",
		}),
	);
	const observations = [];
	for (const rate of [0.5, 1, 2]) {
		await page.goto(`/audio-tempo-probe?rate=${rate}`);
		await page.addScriptTag({ type: "module", content: readFileSync(bundle, "utf8") });
		await page.waitForFunction(() => "tempoReady" in globalThis);
		await page.getByRole("button", { name: "Play Rust tone" }).click();
		const read = () =>
			page.evaluate(() => {
				// SAFETY: generated probe above owns measurement and cleanup functions.
				return (
					globalThis as typeof globalThis & {
						readTempo(): {
							rate: number;
							sampleRate: number;
							frames: number;
							targetFrames: number;
							primingFrames: number;
							resetFrames: number;
							hz: number;
							db: number;
							maximumBytes: number;
							currentBytes: number;
						};
					}
				).readTempo();
			});
		await page.waitForFunction(() => "readTempo" in globalThis);
		// Use the same signal-detection floor as the captured reference player probe.
		await expect.poll(async () => (await read()).db).toBeGreaterThan(-50);
		const observation = await read();
		expect(observation.hz).toBeGreaterThan(430);
		expect(observation.hz).toBeLessThan(450);
		expect(observation.frames).toBe(observation.targetFrames);
		expect(observation.frames).toBe(Math.round(observation.sampleRate / rate));
		expect(observation.resetFrames).toBe(0);
		expect(observation.maximumBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
		const remaining = await page.evaluate(async () => {
			// SAFETY: generated probe closes its actual AudioContext before releasing output reservations.
			return (globalThis as typeof globalThis & { closeTempo(): Promise<number> }).closeTempo();
		});
		expect(remaining).toBe(0);
		observations.push({ ...observation, remaining });
	}
	writeFileSync(
		info.outputPath("audio-tempo.json"),
		JSON.stringify({ observations }, null, "\t") + "\n",
	);
});
