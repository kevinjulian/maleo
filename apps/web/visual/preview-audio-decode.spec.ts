import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("complete local audio feeds bounded Rust PCM mixing with two actual audio decoders", async ({
	page,
	context,
}, info) => {
	test.setTimeout(120_000);
	const fixtures = info.outputPath("audio");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	const entry = info.outputPath("audio.ts"),
		bundle = info.outputPath("audio.js");
	const shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor"),
		media = resolve(import.meta.dirname, "../src/services/preview-media");
	writeFileSync(
		entry,
		`
import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
import {decodeLocalAudio} from ${JSON.stringify(media + "/audio-client.ts")};
Object.assign(globalThis,{runAudioProbe:async()=>{
 provideEditorEngine(await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer())));
 const moduleUrl="/renderer/maleo_renderer_wasm.js",native=await import(moduleUrl);await native.default();
 const budget=new native.PcmBudget(),files={};let maximumBytes=0;
 const counted={reserve:bytes=>{const lease=budget.reserve(bytes);maximumBytes=Math.max(maximumBytes,budget.used());return lease;},release:lease=>budget.release(lease)};
 const names=["impulses-44100.wav","impulses-48000.wav","cfr-av.mp4"];
 for(const name of names)files[name]=new File([await(await fetch("/audio-sources/"+name)).blob()],name);
 await globalThis.blockAudioNetwork();
 const source=(path)=>({path,url:path,startFrame:0,frames:60,mediaStartSec:0,playbackRate:1,loopSource:false,embedded:false,kind:"voiceover",gainMode:"native",volume:1,volumeKeys:[],fadeInSec:0,fadeOutSec:0,duckUnderVoice:null});
 const observations=[];
 for(const name of names.slice(0,2)){
  const window=await decodeLocalAudio({sourceId:name,revision:"r1",file:files[name],start:0,end:1.1},counted);
  const m=window.metadata,inputs=[{path:name,sampleRate:m.sampleRate,channels:m.channels,firstTimestamp:m.firstTimestamp,frames:m.frames,windows:[{start:m.start,offset:0,count:window.pcm.length}]}];
  const mix={fps:30,frames:60,sources:[source(name)],voiceoverRanges:[],legacyVoiceover:null};
  const outputLease=counted.reserve(52800*2*4*2);
  try{
   const output=native.mix_audio(JSON.stringify(mix),JSON.stringify(inputs),window.pcm,48000,2,0,52800);
   let maximumError=0,nonzero=0;
   for(let sample=0;sample<52800;sample++){
    const position=sample*m.sampleRate/48000,left=Math.floor(position),fraction=position-left;
    const impulse=i=>(i===0||i===m.sampleRate)?0.5:0;
    const expected=impulse(left)*(1-fraction)+impulse(left+1)*fraction;
    maximumError=Math.max(maximumError,Math.abs(output[sample*2]-expected),Math.abs(output[sample*2+1]-expected));
    if(output[sample*2]!==0)nonzero++;
   }
   observations.push({name,sampleRate:m.sampleRate,channels:m.channels,maximumError,nonzero,first:output[0],second:output[96000]});
  }finally{counted.release(outputLease);window.release();}
 }
 const concurrent=await Promise.all(Array.from({length:4},(_,i)=>decodeLocalAudio({sourceId:"aac-"+i,revision:"r1",file:files["cfr-av.mp4"],start:.1,end:.6},counted)));
 const aac=concurrent.map(window=>({rate:window.metadata.sampleRate,count:window.metadata.count,bytes:window.pcm.byteLength}));for(const window of concurrent)window.release();
 let rejected=false;try{budget.reserve(16*1024*1024+1);}catch{rejected=true;}
 const offline=new OfflineAudioContext(1,128,48000);
 for(let i=0;i<2;i++){const tone=offline.createConstantSource();tone.offset.value=.75;tone.connect(offline.destination);tone.start();}
 const referenceHeadroom=(await offline.startRendering()).getChannelData(0)[0];
 const headroomSource=source("headroom"),headroomMix={fps:30,frames:60,sources:[headroomSource,{...headroomSource,path:"headroom2"}],voiceoverRanges:[],legacyVoiceover:null};
 const headroomInputs=["headroom","headroom2"].map(path=>({path,sampleRate:48000,channels:1,firstTimestamp:0,frames:2,windows:[{start:0,offset:0,count:2}]}));
 const headroomLease=counted.reserve(32),rustHeadroom=native.mix_audio(JSON.stringify(headroomMix),JSON.stringify(headroomInputs),new Float32Array([.75,.75]),48000,1,0,1)[0];counted.release(headroomLease);
 const remainingBytes=budget.used();budget.free();return {observations,aac,rejected,remainingBytes,maximumBytes,referenceHeadroom,rustHeadroom};
}});
`,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/audio-decode-probe", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Audio decode</title>" }),
	);
	let blocked = false,
		downloads = 0;
	await context.route("**/audio-sources/*", (route) => {
		downloads++;
		if (blocked) return route.abort();
		return route.fulfill({
			path: join(fixtures, new URL(route.request().url()).pathname.split("/").at(-1)!),
		});
	});
	await page.exposeFunction("blockAudioNetwork", () => {
		blocked = true;
	});
	await context.route("**/preview-audio-worker.js", async (route) => {
		const response = await route.fetch();
		const observe = `
const Original=globalThis.AudioDecoder;
globalThis.AudioDecoder=class extends Original{
 constructor(init){super(init);this.done=false;globalThis.postMessage({type:"audio-codec-observation",delta:1});}
 async flush(){await super.flush();await new Promise(resolve=>setTimeout(resolve,100));}
 close(){if(!this.done){this.done=true;globalThis.postMessage({type:"audio-codec-observation",delta:-1});}return super.close();}
};`;
		await route.fulfill({ response, body: observe + (await response.text()) });
	});
	await page.goto("/audio-decode-probe");
	await page.evaluate(() => {
		const counts = { active: 0, max: 0, created: 0 };
		Object.assign(globalThis, { audioCodecCounts: counts });
		const Original = Worker;
		globalThis.Worker = class extends Original {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				this.addEventListener("message", (event: MessageEvent<{ type: string; delta: number }>) => {
					if (event.data.type !== "audio-codec-observation") return;
					event.stopImmediatePropagation();
					counts.active += event.data.delta;
					if (event.data.delta > 0) counts.created++;
					counts.max = Math.max(counts.max, counts.active);
				});
			}
		};
	});
	await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
	const result = await page.evaluate(async () => {
		// SAFETY: this test's generated entry and worker observer own these globals.
		const probe = globalThis as typeof globalThis & {
			runAudioProbe(): Promise<{
				referenceHeadroom: number;
				rustHeadroom: number;
				observations: Array<{
					name: string;
					sampleRate: number;
					channels: number;
					maximumError: number;
					nonzero: number;
					first: number;
					second: number;
				}>;
				aac: Array<{ rate: number; count: number; bytes: number }>;
				rejected: boolean;
				remainingBytes: number;
				maximumBytes: number;
			}>;
			audioCodecCounts: { active: number; max: number; created: number };
		};
		return { ...(await probe.runAudioProbe()), codecs: probe.audioCodecCounts };
	});
	expect(result.observations.map((row) => row.sampleRate)).toEqual([44100, 48000]);
	for (const row of result.observations) {
		expect(row.maximumError).toBeLessThanOrEqual(1e-5);
		expect(row.first).toBe(0.5);
		expect(row.second).toBeCloseTo(0.5, 5);
		expect(row.nonzero).toBeGreaterThanOrEqual(2);
	}
	expect(result.aac).toHaveLength(4);
	for (const row of result.aac) expect(row.bytes).toBeGreaterThan(0);
	expect(result.codecs).toMatchObject({ active: 0, max: 2 });
	expect(result.codecs.created).toBeGreaterThanOrEqual(4);
	expect(result.rejected).toBe(true);
	expect(result.referenceHeadroom).toBe(1.5);
	expect(result.rustHeadroom).toBe(result.referenceHeadroom);
	expect(result.remainingBytes).toBe(0);
	expect(result.maximumBytes).toBeLessThanOrEqual(16 * 1024 * 1024);
	expect(downloads).toBe(3);
	writeFileSync(info.outputPath("audio-decode.json"), JSON.stringify(result, null, "\t") + "\n");
});
