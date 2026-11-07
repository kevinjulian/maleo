/* Browser export proof on representative projects (OpenSpec p2-export task 2.5).
 *
 * Each golden corpus case below exports through the browser export path with
 * its media as complete local sources. Each compared frame of the decoded file
 * is scored by full-frame SSIM against the case's production Remotion
 * reference, with the golden gate's metric (11x11 Gaussian, sigma 1.5, BT.601
 * luma; `crates/renderer/tests/golden/compare.rs`). The golden gate already
 * holds the Rust renderer to these references, so the gap between the two
 * scores is what export adds: encoding. */
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CORPUS = resolve(import.meta.dirname, "../../../crates/renderer/corpus");
/** One or two cases per retained feature family. */
const CASES = [
	"caption-combined-a",
	"caption-highlight",
	"transition-series-fade",
	"transition-absolute-wipe",
	"effect-flash",
	"effect-zoom_punch",
	"video-scene-transition",
	"video-overlay-mask-color",
	"composition-primitives",
	"shape-primitives-wide",
	"combined-project",
];
/** The lowest decoded-frame SSIM accepted against the Remotion reference. */
export const EXPORT_FRAME_SSIM = 0.95;

interface Scored {
	name: string;
	frames: number;
	scores: { frame: number; ssim: number }[];
}

const SSIM = `
function luma(rgba,w,h){const out=new Float64Array(w*h);for(let i=0;i<w*h;i++){const p=i*4;out[i]=(0.299*rgba[p]+0.587*rgba[p+1]+0.114*rgba[p+2])*rgba[p+3]/255;}return out;}
const KERNEL=(()=>{const k=[];for(let i=-5;i<=5;i++)k.push(Math.exp(-(i*i)/(2*1.5*1.5)));const t=k.reduce((a,b)=>a+b,0);return k.map(v=>v/t);})();
function gaussian(src,w,h){const tmp=new Float64Array(w*h),out=new Float64Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let k=0;k<11;k++){const xx=Math.min(w-1,Math.max(0,x+k-5));s+=KERNEL[k]*src[y*w+xx];}tmp[y*w+x]=s;}
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){let s=0;for(let k=0;k<11;k++){const yy=Math.min(h-1,Math.max(0,y+k-5));s+=KERNEL[k]*tmp[yy*w+x];}out[y*w+x]=s;}
 return out;}
function ssim(a,b,w,h){const x=luma(a,w,h),y=luma(b,w,h);const n=w*h;const xx=new Float64Array(n),yy=new Float64Array(n),xy=new Float64Array(n);
 for(let i=0;i<n;i++){xx[i]=x[i]*x[i];yy[i]=y[i]*y[i];xy[i]=x[i]*y[i];}
 const mx=gaussian(x,w,h),my=gaussian(y,w,h),sxx=gaussian(xx,w,h),syy=gaussian(yy,w,h),sxy=gaussian(xy,w,h);
 const c1=(0.01*255)**2,c2=(0.03*255)**2;let total=0;
 for(let i=0;i<n;i++){const vx=sxx[i]-mx[i]*mx[i],vy=syy[i]-my[i]*my[i],cov=sxy[i]-mx[i]*my[i];total+=((2*mx[i]*my[i]+c1)*(2*cov+c2))/((mx[i]*mx[i]+my[i]*my[i]+c1)*(vx+vy+c2));}
 return total/n;}
`;

function entrySource(): string {
	const src = resolve(import.meta.dirname, "../src"),
		shared = resolve(import.meta.dirname, "../../../packages/shared/src/editor");
	return `
import {instantiateEngine} from ${JSON.stringify(shared + "/engine.ts")};
import {provideEditorEngine} from ${JSON.stringify(shared + "/engine-registry.ts")};
import {createPreviewMediaSession} from ${JSON.stringify(src + "/services/preview-media/session.ts")};
import {startBrowserExport, exportBitrate} from ${JSON.stringify(src + "/services/preview-media/browser-export.ts")};
import {ALL_FORMATS, BlobSource, Input, VideoSampleSink} from "mediabunny";
${SSIM}
let engineReady;
async function pixels(source,w,h){const canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext("2d");ctx.drawImage(source,0,0,w,h);return ctx.getImageData(0,0,w,h).data;}
Object.assign(globalThis,{scoreCase:async(c)=>{
 engineReady??=(async()=>{const engine=await instantiateEngine(new Uint8Array(await(await fetch("/editor-engine.wasm")).arrayBuffer()));provideEditorEngine(engine);})();
 await engineReady;
 const names=c.media;
 const files=new Map(await Promise.all(names.map(async n=>["media/"+n,new File([await(await fetch("/corpus/"+c.name+"/media/"+n)).blob()],n)])));
 let owner;
 if(names.length){
  let ready;const loaded=new Promise(r=>ready=r);
  owner=createPreviewMediaSession({resolve:async()=>{throw Error("Unexpected remote source");},changed:()=>{if(owner.snapshot().ready&&names.every(n=>owner.resolve("media/"+n)))ready();}});
  owner.update({sources:names.map(n=>({id:n,revision:"r1",url:"media/"+n,kinds:/\\.(mp4|webm)$/.test(n)?["video"]:["image"],clipIds:[n]})),clips:names.map(n=>({id:n,sourceIds:[n],blockers:[]}))},files);
  await loaded;
 }
 const storyboard=JSON.parse(c.storyboard,(key,value)=>typeof value==="string"&&value.startsWith("media/")?owner.resolve(value):value);
 const frames=Math.max(...c.frames)+1;
 const blob=await startBrowserExport({storyboard,fps:30,frames,width:c.width,height:c.height,bitrate:exportBitrate(c.width,c.height)}).done;
 await owner?.dispose();
 const input=new Input({formats:ALL_FORMATS,source:new BlobSource(blob)});
 const track=await input.getPrimaryVideoTrack();
 const stats=await track.computePacketStats();
 const sink=new VideoSampleSink(track);
 const scores=[];
 for(const frame of c.frames){
  const sample=await sink.getSample((frame+0.5)/30);
  const canvas=new OffscreenCanvas(c.width,c.height),ctx=canvas.getContext("2d");sample.draw(ctx,0,0);sample.close();
  const decoded=ctx.getImageData(0,0,c.width,c.height).data;
  const bitmap=await createImageBitmap(await(await fetch("/corpus/"+c.name+"/reference/"+frame+".png")).blob());
  const reference=await pixels(bitmap,c.width,c.height);
  scores.push({frame,ssim:ssim(decoded,reference,c.width,c.height)});
 }
 return {name:c.name,frames:stats.packetCount,scores};
}});
`;
}

test("representative projects export at parity with production references", async ({
	playwright,
}, info) => {
	test.setTimeout(900_000);
	const entry = info.outputPath("corpus.ts"),
		bundle = info.outputPath("corpus.js");
	writeFileSync(entry, entrySource());
	execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], { stdio: "pipe" });
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	const results: Scored[] = [];
	try {
		const context = await browser.newContext({ baseURL: "http://127.0.0.1:3031" });
		await context.route("**/corpus/**", (route) =>
			route.fulfill({
				path: join(CORPUS, new URL(route.request().url()).pathname.replace(/^\/corpus\//, "")),
			}),
		);
		const page = await context.newPage();
		await page.goto("/");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		for (const name of CASES) {
			const dir = join(CORPUS, name);
			const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8")) as {
				width: number;
				height: number;
				frames: number[];
			};
			const media = existsSync(join(dir, "media")) ? readdirSync(join(dir, "media")) : [];
			const input = {
				name,
				width: spec.width,
				height: spec.height,
				frames: spec.frames,
				media,
				storyboard: readFileSync(join(dir, "storyboard.json"), "utf8"),
			};
			results.push(
				await page.evaluate(
					(c) =>
						// SAFETY: the generated entry defines scoreCase.
						(
							globalThis as typeof globalThis & { scoreCase(c: unknown): Promise<Scored> }
						).scoreCase(c),
					input,
				),
			);
		}
	} finally {
		await browser.close();
		writeFileSync(info.outputPath("scores.json"), JSON.stringify(results, null, 2));
	}
	for (const result of results) {
		const spec = JSON.parse(readFileSync(join(CORPUS, result.name, "case.json"), "utf8")) as {
			frames: number[];
		};
		expect(result.frames, result.name).toBe(Math.max(...spec.frames) + 1);
		for (const score of result.scores)
			expect(score.ssim, `${result.name} frame ${score.frame}`).toBeGreaterThanOrEqual(
				EXPORT_FRAME_SSIM,
			);
	}
});
