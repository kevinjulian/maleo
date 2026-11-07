/* Browser export through the Rust renderer (OpenSpec p2-export tasks 2.1 and 2.2).
 *
 * Each test exports a storyboard over complete local sources from
 * `scripts/media-playback-fixtures.ts` through the export worker, MediaBunny
 * and WebCodecs, then decodes the file in the same page.
 *
 * - Video: `cfr-av.mp4` holds 24 frames at 12 fps with the frame index in eight
 *   binary cells. Each sampled output frame must show the source frame the
 *   renderer selects for its time (nearest presentation time).
 * - Audio: `impulses-*.wav` hold one 0.5 impulse per second. Each placed clip's
 *   impulses must start within one output frame of their authored times, and
 *   fades, trims and mute must remove exactly the impulses they cover. */
import { expect, test, type PlaywrightWorkerArgs, type TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const FPS = 30;

/** JS shared by every test page: local sources, export and decode helpers. */
function prelude(): string {
	const src = resolve(import.meta.dirname, "../src"),
		shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor");
	return `
import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
import {createPreviewMediaSession} from ${JSON.stringify(src + "/services/preview-media/session.ts")};
import {startBrowserExport} from ${JSON.stringify(src + "/services/preview-media/browser-export.ts")};
import {ALL_FORMATS, AudioBufferSink, BlobSource, Input, VideoSampleSink} from "mediabunny";
async function localSources(sources){
 const engine=await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer()));provideEditorEngine(engine);
 const files=new Map(await Promise.all(sources.map(async s=>[s.name,new File([await(await fetch("/export-sources/"+s.name)).blob()],s.name)])));
 let ready;const loaded=new Promise(resolve=>ready=resolve);
 const owner=createPreviewMediaSession({resolve:async()=>{throw Error("Unexpected remote source");},changed:()=>{if(owner.snapshot().ready&&sources.every(s=>owner.resolve(s.name)))ready();}});
 owner.update({sources:sources.map(s=>({id:s.name,revision:"r1",url:s.name,kinds:s.kinds,clipIds:[s.name]})),clips:sources.map(s=>({id:s.name,sourceIds:[s.name],blockers:[]}))},files);
 await loaded;
 return owner;
}
`;
}

async function runInExportPage<T>(
	playwright: PlaywrightWorkerArgs["playwright"],
	info: TestInfo,
	body: string,
): Promise<T> {
	const fixtures = info.outputPath("sources");
	execFileSync(
		"bun",
		[resolve(import.meta.dirname, "../../../scripts/media-playback-fixtures.ts"), fixtures],
		{ stdio: "pipe" },
	);
	const entry = info.outputPath("export.ts"),
		bundle = info.outputPath("export.js");
	writeFileSync(entry, `${prelude()}\nObject.assign(globalThis,{runExport:async()=>{${body}}});\n`);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	try {
		const context = await browser.newContext({ baseURL: "http://127.0.0.1:3031" });
		await context.route("**/export-sources/*", (route) =>
			route.fulfill({
				path: join(fixtures, new URL(route.request().url()).pathname.split("/").at(-1)!),
			}),
		);
		const page = await context.newPage();
		await page.goto("/");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		const result = await page.evaluate(() =>
			// SAFETY: the generated entry defines runExport.
			(globalThis as typeof globalThis & { runExport(): Promise<unknown> }).runExport(),
		);
		writeFileSync(info.outputPath("result.json"), JSON.stringify(result, null, 2));
		// SAFETY: each test's body returns the shape its caller names.
		return result as T;
	} finally {
		await browser.close();
	}
}

interface VideoResult {
	frames: number;
	width: number;
	height: number;
	duration: number;
	ids: { index: number; id: number; band: number }[];
	progress: number;
	refused: string;
}

test("an exported file decodes to the renderer's frames at the output rate", async ({
	playwright,
}, info) => {
	test.setTimeout(180_000);
	const width = 320,
		height = 192,
		frames = 60;
	const result = await runInExportPage<VideoResult>(
		playwright,
		info,
		`
 const width=${width},height=${height},fps=${FPS},frames=${frames};
 const owner=await localSources([{name:"cfr-av.mp4",kinds:["video"]}]);
 const storyboard={scenes:[],videoOverlays:[{url:owner.resolve("cfr-av.mp4"),kind:"video",startSec:0,durationSec:2,volume:0}]};
 let progress=0;
 const blob=await startBrowserExport({storyboard,fps,frames,width,height,bitrate:2000000,onProgress:(phase,frame)=>{if(phase==="rendering")progress=frame;}}).done;
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
 const track=await input.getPrimaryVideoTrack();
 const stats=await track.computePacketStats();
 const sink=new VideoSampleSink(track);
 const canvas=new OffscreenCanvas(track.displayWidth,track.displayHeight),ctx=canvas.getContext("2d");
 const ids=[];
 for(const index of [0,1,2,5,12,13,29,30,44,59]){
  const sample=await sink.getSample((index+0.5)/fps);
  sample.draw(ctx,0,0);sample.close();
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;
  const at=(x,y)=>pixels[(y*canvas.width+x)*4];
  let id=0;for(let cell=0;cell<8;cell++)if(at(Math.round((cell*20+10)*width/160),Math.round(16*height/96))>127)id|=1<<cell;
  ids.push({index,id,band:at(Math.round(width/2),Math.round(64*height/96))});
 }
 let refused="";
 try{await startBrowserExport({storyboard:{scenes:[],textOverlays:[{content:"t",preset:"lower-third",startSec:0.5,durationSec:0.2}]},fps,frames:30,width,height,bitrate:2000000}).done;refused="encoded";}catch(error){refused=String(error.message);}
 await owner.dispose();
 return {frames:stats.packetCount,width:track.displayWidth,height:track.displayHeight,duration:await track.computeDuration(),ids,progress,refused};
`,
	);
	expect(result.frames).toBe(frames);
	expect(result.progress).toBe(frames);
	expect([result.width, result.height]).toEqual([width, height]);
	expect(result.duration).toBeCloseTo(frames / FPS, 6);
	// A frame with an element the renderer does not cover is never encoded.
	expect(result.refused).toMatch(
		/Frame 15 cannot be exported: textOverlays\[0\] `lower-third` preset/,
	);
	for (const sample of result.ids) {
		// Nearest presentation time, ties to the later frame, held at the last frame
		// (`crates/renderer/AGENTS.md`, video supply).
		const expected = Math.min(23, Math.floor((sample.index / FPS) * 12 + 0.5));
		expect(sample, `output frame ${sample.index}`).toMatchObject({ id: expected });
		// The lower band's grey level carries the same index: 64 + 4 * id, within encoding loss.
		expect(Math.abs(sample.band - (64 + expected * 4)), `band ${sample.index}`).toBeLessThanOrEqual(
			6,
		);
	}
});

interface AudioResult {
	sampleRate: number;
	channels: number;
	duration: number;
	videoDuration: number;
	peak: number;
	onsets: { time: number; peak: number }[];
}

test("the exported audio track is the Rust mix with authored timing, fades, trims and mute", async ({
	playwright,
}, info) => {
	test.setTimeout(180_000);
	const frames = 180;
	const result = await runInExportPage<AudioResult>(
		playwright,
		info,
		`
 const fps=${FPS},frames=${frames};
 const owner=await localSources([
  {name:"impulses-48000.wav",kinds:["audio"]},
  {name:"impulses-44100.wav",kinds:["audio"]},
  {name:"cfr-av.mp4",kinds:["audio","video"]},
 ]);
 const a48=owner.resolve("impulses-48000.wav"),a44=owner.resolve("impulses-44100.wav"),av=owner.resolve("cfr-av.mp4");
 const storyboard={scenes:[],
  audioOverlays:[
   {url:a48,kind:"voiceover",startSec:0.2,durationSec:2,volume:1,fadeInSec:1},
   {url:a44,kind:"music",startSec:2.4,durationSec:1,volume:1,loopSource:false},
   {url:a48,kind:"sfx",startSec:5.2,durationSec:0.4,volume:1,mediaStartSec:1},
   {url:a48,kind:"sfx",startSec:5.6,durationSec:0.4,volume:0},
  ],
  videoOverlays:[{url:av,kind:"video",startSec:3.6,durationSec:2,volume:1}]};
 const blob=await startBrowserExport({storyboard,fps,frames,width:320,height:192,bitrate:2000000}).done;
 await owner.dispose();
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
 const track=await input.getPrimaryAudioTrack();
 const sink=new AudioBufferSink(track);
 const rate=track.sampleRate,mono=new Float32Array(Math.ceil((await input.computeDuration())*rate)+rate);
 for await(const {buffer,timestamp} of sink.buffers()){
  const at=Math.round(timestamp*rate);
  for(let ch=0;ch<buffer.numberOfChannels;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++)if(at+i>=0&&at+i<mono.length)mono[at+i]+=data[i]/buffer.numberOfChannels;}
 }
 let peak=0;for(const v of mono)peak=Math.max(peak,Math.abs(v));
 const onsets=[];
 for(let i=0;i<mono.length;i++)if(Math.abs(mono[i])>peak*0.25&&(!onsets.length||i/rate-onsets.at(-1).time>0.3)){
  let local=0;for(let j=i;j<Math.min(mono.length,i+rate*0.05);j++)local=Math.max(local,Math.abs(mono[j]));
  onsets.push({time:i/rate,peak:local});
 }
 return {sampleRate:rate,channels:track.numberOfChannels,duration:await input.computeDuration(),videoDuration:await (await input.getPrimaryVideoTrack()).computeDuration(),peak,onsets};
`,
	);
	expect(result.sampleRate).toBe(48_000);
	expect(result.channels).toBe(2);
	expect(result.videoDuration).toBeCloseTo(frames / FPS, 6);
	// AAC ends on a 1024-sample packet boundary, so the file may run up to one packet longer.
	expect(result.duration - frames / FPS).toBeGreaterThanOrEqual(0);
	expect(result.duration - frames / FPS).toBeLessThanOrEqual(1024 / 48_000 + 1 / FPS);
	// Voiceover: the impulse at 0.2 s sits at the start of a 1 s fade-in and is silent.
	// Music: trimmed to 1 s, so its impulse at 3.4 s is cut. Clip audio: 3.6 and 4.6 s.
	// Sound effect: trimmed 1 s into its source, so its 1 s impulse plays at 5.2 s.
	// The muted sound effect at 5.6 s adds nothing.
	const expected = [1.2, 2.4, 3.6, 4.6, 5.2];
	expect(
		result.onsets.map((onset) => onset.time),
		JSON.stringify(result.onsets),
	).toHaveLength(expected.length);
	for (const [index, time] of expected.entries())
		expect(Math.abs(result.onsets[index]!.time - time), `onset ${time} s`).toBeLessThanOrEqual(
			1 / FPS,
		);
});
