import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";

test("local video decodes presentation intervals through sequential playback, eviction and 100 seeks", async ({
	page,
	context,
}, info) => {
	test.setTimeout(120_000);
	const fixtures = info.outputPath("frames");
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
			"-i",
			join(fixtures, "cfr-av.mp4"),
			"-an",
			"-vf",
			"format=yuva420p,colorchannelmixer=aa=0.5,format=yuva420p",
			"-c:v",
			"libvpx-vp9",
			"-lossless",
			"1",
			"-auto-alt-ref",
			"0",
			"-threads",
			"1",
			join(fixtures, "alpha.webm"),
		],
		{ stdio: "pipe" },
	);
	const production = z
		.object({
			observations: z.array(
				z.object({ source: z.string(), sourceTime: z.number(), id: z.number() }),
			),
		})
		.parse(
			JSON.parse(
				readFileSync(
					resolve(
						import.meta.dirname,
						"../../../crates/media/tests/fixtures/production-video-selection.json",
					),
					"utf8",
				),
			),
		);
	const samples = new Map<string, { ticks: number[]; resolution: number; ids: number[] }>();
	for (const name of [
		"cfr-av.mp4",
		"vfr-silent.mp4",
		"nonzero-silent.mp4",
		"silent.webm",
		"alpha.webm",
	]) {
		const probe = z
			.object({
				frames: z.array(z.object({ best_effort_timestamp: z.number() })),
				streams: z.array(z.object({ time_base: z.string() })),
			})
			.parse(
				JSON.parse(
					execFileSync(
						"ffprobe",
						[
							"-v",
							"error",
							"-select_streams",
							"v:0",
							"-show_frames",
							"-show_streams",
							"-show_entries",
							"frame=best_effort_timestamp:stream=time_base",
							"-of",
							"json",
							join(fixtures, name),
						],
						{ encoding: "utf8" },
					),
				),
			);
		const [numerator, denominator] = probe.streams[0]!.time_base.split("/").map(Number);
		const ids = Array.from({ length: 24 }, (_, index) => index).filter(
			(index) => name !== "vfr-silent.mp4" || index % 3 !== 1,
		);
		expect(probe.frames).toHaveLength(ids.length);
		samples.set(name, {
			ticks: probe.frames.map((frame) => frame.best_effort_timestamp),
			resolution: denominator! / numerator!,
			ids,
		});
	}
	function expectedId(name: string, time: number) {
		const source = samples.get(name)!;
		const target = Math.trunc(time * source.resolution);
		let selected = 0;
		for (let index = 1; index < source.ticks.length; index++)
			if (Math.abs(source.ticks[index]! - target) <= Math.abs(source.ticks[selected]! - target))
				selected = index;
		return source.ids[selected]!;
	}
	const entry = info.outputPath("decode.ts"),
		bundle = info.outputPath("decode.js");
	const shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor"),
		media = resolve(import.meta.dirname, "../src/services/preview-media");
	writeFileSync(
		entry,
		`
 import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
 import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
 import {createPreviewSourceClient} from ${JSON.stringify(media + "/source-client.ts")};
 import {createVideoFrameClient} from ${JSON.stringify(media + "/video-client.ts")};
 const names=["cfr-av.mp4","vfr-silent.mp4","nonzero-silent.mp4","silent.webm","alpha.webm"];
 // Frames arrive as GPU-bound VideoFrames; read one back to RGBA here, then close it like the renderer does.
 const rgbaOf=(decoded)=>{const pixels=decoded.pixels,{width,height}=decoded.identity;if(pixels instanceof Uint8Array)return pixels;const context=new OffscreenCanvas(width,height).getContext("2d");context.drawImage(pixels,0,0);pixels.close();return context.getImageData(0,0,width,height).data;};
 const idOf=(rgba,width)=>{let id=0;for(let bit=0;bit<8;bit++){const at=(16*width+bit*20+10)*4;if((rgba[at]+rgba[at+1]+rgba[at+2])/3>128)id|=1<<bit;}return id;};
 Object.assign(globalThis,{runVideoDecodeProbe:async()=>{
  provideEditorEngine(await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer())));
  const moduleUrl="/renderer/maleo_renderer_wasm.js",native=await import(moduleUrl);await native.default();
  const sources=[...names,"cfr-longgop.mp4"].map(name=>({id:name,revision:"r1",url:location.origin+"/frame-sources/"+name,kinds:["video"]}));
  const loader=createPreviewSourceClient({resolve:async source=>({url:source.url,credentials:"omit"}),progress:()=>{},validating:()=>{}});
  const clients=[],pools=[];let maximumBytes=0;
  try {
   const files=await Promise.all(sources.map(source=>loader.load(source)));
   await globalThis.blockSourceNetwork();
   const observations=[];
   function harness(index,consumer){
    const source=sources[index],file=files[index],metadata=loader.metadata(source);
    if(!metadata)throw new Error("Validated video metadata missing");
    const pool=new native.MediaPool();pools.push(pool);const send=action=>JSON.parse(pool.dispatch(JSON.stringify(action))),buffers=new Map();
    const video=createVideoFrameClient({id:source.id,revision:source.revision,file,metadata},{reserve:(lease,width,height,bytes)=>{
     const result=send({type:"resize",lease:lease.id,width,height,bytes});for(const id of result.evicted)buffers.delete(id);
     const stats=send({type:"stats"});maximumBytes=Math.max(maximumBytes,stats.reservedBytes+stats.cachedBytes);
    }});clients.push(video);let sequence=0;
    function request(time,generation=1){return {consumer,sourceId:source.id,revision:source.revision,generation,sequence:++sequence,time,width:metadata.width,height:metadata.height,kind:"video"};}
    async function read(time,generation=1){
     const req=request(time,generation),hit=send({type:"lookup",request:req}).frame;
     if(hit){const rgba=buffers.get(hit.id);if(!rgba)throw new Error("Native cache handle missing from host");return {time,id:idOf(rgba,hit.identity.width),start:hit.identity.start,end:hit.identity.end,presentation:hit.identity.presentation,cached:true};}
     send({type:"enqueue",request:req});const plan=send({type:"acquire"});if(plan.type!=="start")throw new Error("Expected native frame lease: "+JSON.stringify(plan));
     for(const id of plan.evicted)buffers.delete(id);
     try {const decoded=await video.request(plan.lease),rgba=rgbaOf(decoded),result=send({type:"complete",lease:plan.lease.id,identity:decoded.identity});
      if(!result.frame)throw new Error("Current frame was rejected as stale");buffers.set(result.frame.id,rgba);
      return {time,id:idOf(rgba,decoded.identity.width),start:decoded.identity.start,end:decoded.identity.end,presentation:decoded.identity.presentation,cached:false,pixels:source.id==="alpha.webm"?Array.from({length:8},(_,i)=>Array.from(rgba.slice((16*decoded.identity.width+i*20+10)*4,(16*decoded.identity.width+i*20+10)*4+4))):undefined};
     }catch(error){send({type:"release",lease:plan.lease.id});throw error;}
    }
    return {video,pool,send,request,read,clear(){send({type:"clear"});buffers.clear();}};
   }
   const times=[0,49/1200,1/24,51/1200,1/12,.1,.25,.4,.5,.9,1.2,1.75,1.99];
   for(let i=0;i<names.length;i++){
    const h=harness(i,"sequential-"+i),frames=[];
    for(const time of times)frames.push(await h.read(time));
    h.clear();const recovered=await h.read(.9,2);
    observations.push({source:names[i],frames,recovered});await h.video.dispose();h.clear();
   }
   const production=[];
   for(const row of ${JSON.stringify(production.observations)}){
    const h=harness(names.indexOf(row.source),"production-"+production.length);
    production.push({...row,actual:await h.read(row.sourceTime)});await h.video.dispose();h.clear();
   }
   const random=harness(0,"random"),seeks=[];
   for(let i=0;i<100;i++){
    random.clear();const time=((i*7)%23)/12+.02,start=performance.now(),frame=await random.read(time,i+1);
    seeks.push({...frame,ms:performance.now()-start});
   }
   await random.video.dispose();random.clear();
   const rapid=harness(0,"rapid"),first=rapid.request(0,1);rapid.send({type:"enqueue",request:first});const old=rapid.send({type:"acquire"});
   const initial=rapid.video.request(old.lease);
   for(let i=2;i<=100;i++)rapid.send({type:"enqueue",request:rapid.request(((i*7)%23)/12+.02,i)});
   const during=rapid.send({type:"stats"}),stale=await initial,rejected=rapid.send({type:"complete",lease:old.lease.id,identity:stale.identity});
   const last=rapid.send({type:"acquire"}),latest=await rapid.video.request(last.lease),accepted=rapid.send({type:"complete",lease:last.lease.id,identity:latest.identity});
   const rapidResult={during,oldAccepted:rejected.frame!==null,lastGeneration:last.lease.request.generation,lastTime:last.lease.request.time,id:idOf(rgbaOf(latest),latest.identity.width),accepted:accepted.frame!==null};
   await rapid.video.dispose();rapid.clear();
   // Cancels can land mid-decode or mid-reopen; the decoder must still serve an earlier time after them.
   const cut=harness(names.length,"cut");await cut.read(6.5);const cutOutcomes=[];
   for(const [time,wait] of [[7.5,5],[2,0],[6,20],[3,40]]){const req=cut.request(time);cut.send({type:"enqueue",request:req});const plan=cut.send({type:"acquire"});const pending=cut.video.request(plan.lease).then(()=>"resolved",error=>error.name);await new Promise(done=>setTimeout(done,wait));cut.video.cancel("cut");cutOutcomes.push(await Promise.race([pending,new Promise((_,fail)=>setTimeout(()=>fail(new Error("Video request hung after a cancel")),5000))]));cut.send({type:"release",lease:plan.lease.id});}
   const afterCut=await Promise.race([cut.read(4),new Promise((_,fail)=>setTimeout(()=>fail(new Error("Video decode hung after a cancel")),5000))]);
   await cut.video.dispose();cut.clear();
   const left=harness(0,"left"),right=harness(0,"right");
   const overlap=await Promise.all([left.read(.1),right.read(1.5)]);
   await left.video.dispose();await right.video.dispose();left.clear();right.clear();
   return {observations,production,seeks,rapid:rapidResult,cut:{outcomes:cutOutcomes,time:afterCut.time,start:afterCut.start,end:afterCut.end},overlap,maximumBytes,empty:pools.map(pool=>JSON.parse(pool.dispatch('{"type":"stats"}')))};
  }finally{await Promise.all(clients.map(client=>client.dispose()));await loader.dispose();for(const pool of pools)pool.free();}
 }});
 `,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/video-decode-probe", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Video decode</title>" }),
	);
	let blocked = false,
		downloads = 0;
	// One keyframe and 720p: every earlier request decodes from frame 0 for long enough that a
	// cancel lands mid-decode.
	execFileSync(
		"ffmpeg",
		[
			"-v",
			"error",
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc2=size=1280x720:rate=30:duration=8",
			"-c:v",
			"libx264",
			"-g",
			"1000",
			"-keyint_min",
			"1000",
			"-sc_threshold",
			"0",
			"-bf",
			"0",
			"-pix_fmt",
			"yuv420p",
			join(fixtures, "cfr-longgop.mp4"),
		],
		{ stdio: "pipe" },
	);
	await context.route("**/frame-sources/*", (route) => {
		downloads++;
		if (blocked) return route.abort();
		const name = new URL(route.request().url()).pathname.split("/").at(-1)!;
		return route.fulfill({
			path: join(fixtures, name),
			contentType: name.endsWith("webm") ? "video/webm" : "video/mp4",
		});
	});
	await page.exposeFunction("blockSourceNetwork", () => {
		blocked = true;
	});
	await context.route(/\/preview-(media|video)-worker\.js$/, async (route) => {
		const response = await route.fetch();
		const observe = `
   const __counts={video:{active:0,max:0,created:0,closed:0,frames:0},audio:{active:0,max:0,created:0,closed:0,frames:0}};
   for(const [name,kind,dataName] of [["VideoDecoder","video","VideoFrame"],["AudioDecoder","audio","AudioData"]]){
    const Native=globalThis[name],Data=globalThis[dataName],live=new Set();
    if(!Native || !Data)continue;
    const close=Data.prototype.close,clone=Data.prototype.clone;
    const track=value=>{if(!live.has(value)){live.add(value);__counts[kind].frames++;}};
    Data.prototype.close=function(){if(live.delete(this))__counts[kind].frames--;return close.call(this);};
    Data.prototype.clone=function(){const value=clone.call(this);track(value);return value;};
    globalThis[name]=class extends Native {
     constructor(init){super({...init,output:sample=>{track(sample);init.output(sample);}});this.__closed=false;const count=__counts[kind];count.active++;count.created++;count.max=Math.max(count.max,count.active);}
     close(){if(!this.__closed){this.__closed=true;__counts[kind].active--;__counts[kind].closed++;}return super.close();}
    };
   }
   const __post=globalThis.postMessage.bind(globalThis);
   globalThis.postMessage=(message,transfer)=>__post({...message,resources:structuredClone(__counts)},transfer);
  `;
		await route.fulfill({ response, body: observe + (await response.text()) });
	});

	await page.goto("/video-decode-probe");
	const errors: string[] = [];
	page.on("pageerror", (error) => errors.push(error.message));

	await page.evaluate(() => {
		const reports: Array<{
			video: { active: number; max: number; created: number; closed: number; frames: number };
			audio: { active: number; max: number; created: number; closed: number; frames: number };
		}> = [];
		Object.assign(globalThis, { videoResourceReports: reports });
		const Native = Worker;
		globalThis.Worker = class extends Native {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				const id = reports.length;
				reports.push({
					video: { active: 0, max: 0, created: 0, closed: 0, frames: 0 },
					audio: { active: 0, max: 0, created: 0, closed: 0, frames: 0 },
				});
				this.addEventListener(
					"message",
					(event: MessageEvent<{ resources?: (typeof reports)[number] }>) => {
						if (event.data.resources) reports[id] = event.data.resources;
					},
				);
			}
		};
	});
	await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
	const result = await page.evaluate(async () => {
		// SAFETY: the generated probe above owns this global and its returned measurement shape.
		const probe = globalThis as typeof globalThis & {
			runVideoDecodeProbe: () => Promise<{
				observations: Array<{
					source: string;
					frames: Array<{
						time: number;
						id: number;
						start: number;
						end: number;
						presentation: [number, number];
						cached: boolean;
						pixels?: number[][];
					}>;
					recovered: { id: number };
				}>;
				production: Array<{
					source: string;
					sourceTime: number;
					id: number;
					actual: { id: number };
				}>;
				seeks: Array<{ time: number; id: number; ms: number }>;
				rapid: {
					during: { videoDecoders: number; queued: number };
					oldAccepted: boolean;
					lastGeneration: number;
					lastTime: number;
					id: number;
					accepted: boolean;
				};
				cut: { outcomes: string[]; time: number; start: number; end: number };
				overlap: Array<{ id: number }>;
				maximumBytes: number;
				empty: Array<{
					cachedBytes: number;
					reservedBytes: number;
					videoDecoders: number;
					queued: number;
				}>;
			}>;
		};
		const result = await probe.runVideoDecodeProbe();
		// SAFETY: the worker observer immediately above owns this measurement global.
		const observer = globalThis as typeof globalThis & {
			videoResourceReports: Array<{
				video: { active: number; max: number; created: number; closed: number; frames: number };
				audio: { active: number; max: number; created: number; closed: number; frames: number };
			}>;
		};
		return { ...result, resources: observer.videoResourceReports };
	});
	writeFileSync(info.outputPath("video-decode.json"), JSON.stringify(result, null, 2));
	expect(errors).toEqual([]);
	expect(downloads).toBe(6);
	for (const source of result.observations)
		for (const frame of source.frames) {
			const expected = expectedId(source.source, frame.time);
			expect(frame.id, source.source + " at " + frame.time).toBe(expected);
			expect(frame.start).toBeLessThanOrEqual(frame.time + 1e-10);
			expect(frame.end).toBeGreaterThan(frame.time);
			if (source.source === "alpha.webm" && frame.pixels)
				for (const [bit, pixel] of frame.pixels.entries()) {
					const level = expected & (1 << bit) ? 255 : 0;
					for (const value of pixel.slice(0, 3))
						expect(Math.abs(value - level)).toBeLessThanOrEqual(2);
					expect(pixel[3]).toBe(129);
				}
		}
	for (const seek of result.seeks) expect(seek.id).toBe(expectedId("cfr-av.mp4", seek.time));
	for (const row of result.production)
		expect(row.actual.id, row.source + " at " + row.sourceTime).toBe(row.id);
	expect(result.seeks).toHaveLength(100);
	expect(result.rapid.oldAccepted).toBe(false);
	expect(result.rapid.accepted).toBe(true);
	expect(result.rapid.lastGeneration).toBe(100);
	expect(result.rapid.during).toMatchObject({ videoDecoders: 1, queued: 1 });
	expect(result.rapid.id).toBe(expectedId("cfr-av.mp4", result.rapid.lastTime));
	for (const outcome of result.cut.outcomes) expect(["resolved", "AbortError"]).toContain(outcome);
	expect(result.cut.start).toBeLessThanOrEqual(4);
	expect(result.cut.end).toBeGreaterThan(4);
	expect(result.overlap.map((frame) => frame.id)).toEqual([1, 18]);
	expect(result.maximumBytes).toBeLessThanOrEqual(256 * 1024 * 1024);
	for (const stats of result.empty)
		expect(stats).toMatchObject({ cachedBytes: 0, reservedBytes: 0, videoDecoders: 0, queued: 0 });

	for (const resource of result.resources)
		for (const count of [resource.video, resource.audio]) {
			expect(count.active).toBe(0);
			expect(count.frames).toBe(0);
			expect(count.closed).toBe(count.created);
			expect(count.max).toBeLessThanOrEqual(2);
		}
	await info.attach("video-decode.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
});
