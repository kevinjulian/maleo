import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("browser WASM grants only two video leases and retains reservation-aware cache state", async ({
	page,
	context,
}) => {
	await context.route("**/media-pool-probe", (route) =>
		route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Media pool</title>" }),
	);
	await page.goto("/media-pool-probe");
	const result = await page.evaluate(async () => {
		const path = "/renderer/maleo_renderer_wasm.js";
		// SAFETY: generated glue exports the MediaPool class defined in crates/renderer-wasm/src/media_pool.rs.
		const module = (await import(path)) as {
			default: () => Promise<unknown>;
			MediaPool: new () => { dispatch: (json: string) => string; free: () => void };
		};
		await module.default();
		const pool = new module.MediaPool();
		try {
			const request = {
				consumer: "a",
				generation: 1,
				sequence: 1,
				sourceId: "shared",
				revision: "r1",
				time: 0,
				width: 1,
				height: 1,
				kind: "video",
			};
			for (const [i, consumer] of ["a", "b", "c"].entries())
				pool.dispatch(
					JSON.stringify({ type: "enqueue", request: { ...request, consumer, time: i } }),
				);
			const first = pool.dispatch('{"type":"acquire"}');
			const second = pool.dispatch('{"type":"acquire"}');
			const wait = pool.dispatch('{"type":"acquire"}');
			const two = pool.dispatch('{"type":"stats"}');
			const frame = pool.dispatch(
				JSON.stringify({
					type: "complete",
					lease: 1,
					identity: { sourceId: "shared", revision: "r1", start: 0, end: 1, width: 1, height: 1 },
				}),
			);
			const third = pool.dispatch('{"type":"acquire"}');
			pool.dispatch('{"type":"release","lease":2}');
			pool.dispatch('{"type":"release","lease":3}');
			const resident = pool.dispatch('{"type":"stats"}');
			pool.dispatch('{"type":"clear"}');
			const empty = pool.dispatch('{"type":"stats"}');
			let rejected = false;
			try {
				pool.dispatch('{"type":"enqueue","request":{"consumer":"broken"}}');
			} catch {
				rejected = true;
			}
			return { first, second, wait, two, frame, third, resident, empty, rejected };
		} finally {
			pool.free();
		}
	});
	expect(JSON.parse(result.first)).toMatchObject({
		type: "start",
		lease: { id: 1, request: { consumer: "a" }, bytes: 4 },
	});
	expect(JSON.parse(result.second)).toMatchObject({
		type: "start",
		lease: { id: 2, request: { consumer: "b" } },
	});
	expect(JSON.parse(result.wait)).toEqual({ type: "wait" });
	expect(JSON.parse(result.two)).toEqual({
		videoDecoders: 2,
		reservedBytes: 8,
		cachedBytes: 0,
		queued: 1,
	});
	expect(JSON.parse(result.frame)).toMatchObject({ frame: { id: 1, bytes: 4 } });
	expect(JSON.parse(result.third)).toMatchObject({
		type: "start",
		lease: { id: 3, request: { consumer: "c" } },
	});
	expect(JSON.parse(result.resident)).toEqual({
		videoDecoders: 0,
		reservedBytes: 0,
		cachedBytes: 4,
		queued: 0,
	});
	expect(JSON.parse(result.empty)).toEqual({
		videoDecoders: 0,
		reservedBytes: 0,
		cachedBytes: 0,
		queued: 0,
	});
	expect(result.rejected).toBe(true);
});

test("production source workers share native decoder grants during overlapping real codec probes", async ({
	page,
	context,
}, info) => {
	const file = info.outputPath("decoders.mp4");
	execFileSync(
		"ffmpeg",
		[
			"-y",
			"-f",
			"lavfi",
			"-i",
			"testsrc=size=160x96:rate=12",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440",
			"-t",
			"1",
			"-c:v",
			"libx264",
			"-pix_fmt",
			"yuv420p",
			"-c:a",
			"aac",
			file,
		],
		{ stdio: "pipe" },
	);
	const entry = info.outputPath("source-probe.ts"),
		bundle = info.outputPath("source-probe.js");
	const shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor");
	const client = resolve(import.meta.dirname, "../src/services/preview-media/source-client.ts");
	writeFileSync(
		entry,
		`
 import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
 import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
 import {createPreviewSourceClient} from ${JSON.stringify(client)};
 Object.assign(globalThis,{runSourceDecoderProbe:async()=>{
  provideEditorEngine(await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer())));
  const clients=Array.from({length:4},()=>createPreviewSourceClient({resolve:async source=>({url:source.url,credentials:"omit"}),progress:()=>{},validating:()=>{}}));
  try {const files=await Promise.all(clients.map((client,i)=>client.load({id:"fixture-"+i,revision:"r1",url:location.origin+"/decoders.mp4",kinds:["video","audio"]})));return files.map(file=>file.size);}
  finally{await Promise.all(clients.map(client=>client.dispose()));}
 }});
 `,
	);
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	await context.route("**/decoder-probe", (route) =>
		route.fulfill({
			contentType: "text/html",
			body: "<!doctype html><title>Decoder probe</title>",
		}),
	);
	await context.route("**/decoders.mp4", (route) =>
		route.fulfill({ contentType: "video/mp4", path: file }),
	);
	await context.route("**/preview-media-worker.js", async (route) => {
		const response = await route.fetch();
		const probe = `
  for(const [name,kind] of [["VideoDecoder","video"],["AudioDecoder","audio"]]) {
   const Original=globalThis[name];
   globalThis[name]=class extends Original {
    constructor(init){super(init);this.__closed=false;globalThis.postMessage({type:"decoder-observation",kind,delta:1});}
    async flush(){await super.flush();await new Promise(resolve=>setTimeout(resolve,100));}
    close(){if(!this.__closed){this.__closed=true;globalThis.postMessage({type:"decoder-observation",kind,delta:-1});}return super.close();}
   };
  }
  `;
		await route.fulfill({ response, body: probe + (await response.text()) });
	});
	await page.goto("/decoder-probe");
	await page.evaluate(() => {
		const counts = { video: { active: 0, max: 0 }, audio: { active: 0, max: 0 } };
		Object.assign(globalThis, { decoderCounts: counts });
		const Original = Worker;
		globalThis.Worker = class extends Original {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options);
				this.addEventListener(
					"message",
					(event: MessageEvent<{ type: string; kind: "video" | "audio"; delta: number }>) => {
						if (event.data.type !== "decoder-observation") return;
						event.stopImmediatePropagation();
						const count = counts[event.data.kind];
						count.active += event.data.delta;
						count.max = Math.max(count.max, count.active);
					},
				);
			}
		};
	});
	await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
	const result = await page.evaluate(async () => {
		// SAFETY: the test bundle and observer above own these globals.
		const probe = globalThis as typeof globalThis & {
			runSourceDecoderProbe: () => Promise<number[]>;
			decoderCounts: {
				video: { active: number; max: number };
				audio: { active: number; max: number };
			};
		};
		return { sizes: await probe.runSourceDecoderProbe(), counts: probe.decoderCounts };
	});
	expect(result.sizes).toHaveLength(4);
	for (const size of result.sizes) expect(size).toBeGreaterThan(0);
	expect(result.counts.video).toEqual({ active: 0, max: 2 });
	expect(result.counts.audio).toEqual({ active: 0, max: 2 });
	await info.attach("decoder-counts.json", {
		body: JSON.stringify(result, null, 2),
		contentType: "application/json",
	});
});
