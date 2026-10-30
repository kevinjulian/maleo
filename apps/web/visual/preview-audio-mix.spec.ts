import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

test("Rust plans complete local audio windows through bounded mixing and tempo while offline", async ({
	page,
	context,
}, info) => {
	test.setTimeout(90_000);
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	const models = resolve(import.meta.dirname, "../src"),
		shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor");
	const entry = info.outputPath("mix.ts"),
		bundle = info.outputPath("mix.js");
	writeFileSync(
		entry,
		`
import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
import {createPreviewMediaSession} from ${JSON.stringify(models + "/services/preview-media/session.ts")};
import {borrowLocalPreviewSource} from ${JSON.stringify(models + "/services/preview-media/local-sources.ts")};
import {openDecoderLeases} from ${JSON.stringify(models + "/services/preview-media/decoder-leases.ts")};
import {createAudioMedia} from ${JSON.stringify(models + "/preview-worker/audio-media.ts")};
Object.assign(globalThis,{prepareAudioMix:async()=>{
 const engine=await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer()));provideEditorEngine(engine);
 const moduleUrl="/renderer/maleo_renderer_wasm.js",native=await import(moduleUrl);await native.default();
 const files=new Map(await Promise.all(["impulses-44100.wav","vfr-silent.mp4"].map(async name=>[name,new File([await(await fetch("/audio-mix-sources/"+name)).blob()],name)])));
 let ready;const loaded=new Promise(resolve=>ready=resolve);
 const owner=createPreviewMediaSession({resolve:async()=>{throw Error("Unexpected remote source");},changed:()=>{if(owner.snapshot().ready&&owner.resolve("impulses-44100.wav")&&owner.resolve("vfr-silent.mp4"))ready();}});
 owner.update({sources:[{id:"audio",revision:"r1",url:"impulses-44100.wav",kinds:["audio"],clipIds:["audio"]},{id:"silent",revision:"r1",url:"vfr-silent.mp4",kinds:["video"],clipIds:["silent"]}],clips:[{id:"audio",sourceIds:["audio"],blockers:[]},{id:"silent",sourceIds:["silent"],blockers:[]}]},files);await loaded;
 const urls=[owner.resolve("impulses-44100.wav"),owner.resolve("vfr-silent.mp4")];
 const leases=urls.map(url=>borrowLocalPreviewSource(url,async()=>{await mixer.dispose();}));
 const bindings=leases.map((lease,i)=>({url:urls[i],...lease.source}));
 let peak=0,remaining;
 class Budget{value=new native.PcmBudget();reserve(bytes){const lease=this.value.reserve(bytes);peak=Math.max(peak,this.value.used());return lease;}release(lease){this.value.release(lease);}used(){return this.value.used();}free(){remaining=this.value.used();this.value.free();}}
 const mixer=await createAudioMedia({...native,PcmBudget:Budget},openDecoderLeases);
 Object.assign(globalThis,{runAudioMix:async()=>{
  const results=[];
  for(const rate of [.5,1,2]){
   const story={scenes:[],audioOverlays:[{url:urls[0],kind:"voiceover",startSec:0,durationSec:2,volume:1}],videoOverlays:[{url:urls[1],kind:"video",startSec:0,durationSec:2}]};
   await mixer.configure(JSON.stringify(story),30,60,bindings,.95,rate,48000);
   let frames=0,error=0;
   while(true){const block=await mixer.pull(96000);if(!block)break;
    if(rate===1)for(let i=0;i<block.pcm.length/2;i++){
     const position=(45600+frames+i)*44100/48000,left=Math.floor(position),fraction=position-left;
     const impulse=sample=>(sample===0||sample===44100)? .5:0;
     const expected=impulse(left)*(1-fraction)+impulse(left+1)*fraction;
     error=Math.max(error,Math.abs(block.pcm[i*2]-expected),Math.abs(block.pcm[i*2+1]-expected));
    }
    frames+=block.pcm.length/2;structuredClone(block.pcm.buffer,{transfer:[block.pcm.buffer]});mixer.release(block.lease);
   }
   results.push({rate,frames,error});
  }
  await mixer.dispose();for(const lease of leases)lease.release();await owner.dispose();
  return {results,peak,remaining};
 }});
}});
`,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/audio-mix-sources/*", (route) =>
		route.fulfill({
			path: join(fixtures, new URL(route.request().url()).pathname.split("/").at(-1)!),
		}),
	);
	await page.goto("/");
	await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
	await page.evaluate(async () => {
		// SAFETY: generated entry owns setup and its returned local sources.
		await (
			globalThis as typeof globalThis & { prepareAudioMix(): Promise<void> }
		).prepareAudioMix();
	});
	await context.setOffline(true);
	const result = await page.evaluate(async () => {
		// SAFETY: generated entry owns the bounded mixing probe and cleanup.
		return (
			globalThis as typeof globalThis & {
				runAudioMix(): Promise<{
					results: Array<{ rate: number; frames: number; error: number }>;
					peak: number;
					remaining: number;
				}>;
			}
		).runAudioMix();
	});
	expect(result.results.map((row) => row.frames)).toEqual([100800, 50400, 25200]);
	expect(result.results.find((row) => row.rate === 1)!.error).toBeLessThanOrEqual(1e-5);
	expect(result.peak).toBeLessThanOrEqual(16 * 1024 * 1024);
	expect(result.remaining).toBe(0);
	writeFileSync(info.outputPath("audio-mix.json"), JSON.stringify(result, null, "\t") + "\n");
});
