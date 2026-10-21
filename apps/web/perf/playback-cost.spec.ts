/* What playback actually costs on the main thread, at a given clip count.
 *
 * The render-budget suite counts renders; this one measures the consequence —
 * frame pacing and long tasks while the preview plays. It exists because the
 * timeline stopped re-rendering during playback and playback still felt laggy,
 * which is a question a render count cannot answer.
 *
 * `PERF_CLIPS=240 bunx playwright test --project=perf -g "playback cost"`. The
 * clip count is the point: the numbers only mean something as a curve.
 */
import { test } from "@playwright/test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_PROJECT_ID } from "../visual/screens.ts";
import { replayApi } from "../visual/har.ts";

const HAR = resolve(dirname(fileURLToPath(import.meta.url)), "../visual/fixtures/api.har");

test("playback cost", async ({ page, context }) => {
	await replayApi(context, HAR);
	const CLIPS = Number(process.env.PERF_CLIPS ?? 40);
	await page.addInitScript(`{
		globalThis.__maleoRenderCounts = {};
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (input, init) => {
			const res = await realFetch(input, init);
			const url = typeof input === "string" ? input : input.url;
			if (!/\\/api\\/operations\\/projects\\/[^/?]+(\\?|$)/.test(url)) return res;
			const detail = await res.clone().json().catch(() => null);
			const clips = detail?.storyboards?.[0]?.storyboard_json?.clips;
			if (!Array.isArray(clips)) return res;
			const seeds = clips.filter((c) => c.type !== "transition" && !c.scene);
			const out = clips.slice();
			let copy = 1;
			while (out.length < ${CLIPS} && seeds.length > 0) {
				for (const seed of seeds) {
					if (out.length >= ${CLIPS}) break;
					const [source, refId] = String(seed.id).split(":");
					const nextId = Number(refId) + copy * 100000;
					const dup = JSON.parse(JSON.stringify(seed));
					dup.id = source + ":" + nextId;
					dup.startSec = (seed.startSec ?? 0) + copy * ((seed.durationSec ?? 1) + 0.2);
					for (const key of ["video", "text", "audio", "infographic", "effect"]) {
						if (dup[key]) { dup[key].id = nextId; dup[key].start = dup.startSec; }
					}
					out.push(dup);
				}
				copy += 1;
			}
			detail.storyboards[0].storyboard_json.clips = out;
			return new Response(JSON.stringify(detail), { status: res.status, headers: { "content-type": "application/json" } });
		};
		globalThis.__long = [];
		new PerformanceObserver((l) => { for (const e of l.getEntries()) globalThis.__long.push(e.duration); })
			.observe({ entryTypes: ["longtask"] });
	}`);
	await page.setViewportSize({ width: 1440, height: 900 });
	await page.goto(`/content/${FIXTURE_PROJECT_ID}`);
	await page.locator(".tl2-timeline").waitFor({ state: "visible", timeout: 60_000 });
	await page.waitForTimeout(1500);

	const result = await page.evaluate(async () => {
		const w = globalThis as unknown as {
			__maleoRenderCounts: Record<string, number>;
			__long: number[];
		};
		w.__maleoRenderCounts = {};
		w.__long = [];
		const samples: number[] = [];
		let frames = 0;
		const head = document.querySelector<HTMLElement>("[data-vui-slot='playhead']")!;
		const read = (): number => {
			const m = /translateX\(([-0-9.]+)px\)/.exec(head.style.transform);
			return m ? Number(m[1]) : 0;
		};
		let last = performance.now();
		let running = true;
		const tick = (): void => {
			if (!running) return;
			const now = performance.now();
			samples.push(now - last);
			last = now;
			frames += 1;
			requestAnimationFrame(tick);
		};
		document.querySelector<HTMLButtonElement>(".tl2-timeline [data-transport='play']")!.click();
		requestAnimationFrame(tick);
		const from = read();
		await new Promise((r) => setTimeout(r, 3000));
		running = false;
		const moved = read() - from;
		document.querySelector<HTMLButtonElement>(".tl2-timeline [data-transport='play']")!.click();
		samples.sort((a, b) => a - b);
		const at = (p: number): number =>
			samples[Math.min(samples.length - 1, Math.floor(samples.length * p))] ?? 0;
		return {
			renders: { ...w.__maleoRenderCounts },
			longTasks: w.__long.length,
			longTaskMs: Math.round(w.__long.reduce((s, d) => s + d, 0)),
			worstLongTask: Math.round(Math.max(0, ...w.__long)),
			rafFrames: frames,
			frameMs: {
				p50: +at(0.5).toFixed(1),
				p90: +at(0.9).toFixed(1),
				p99: +at(0.99).toFixed(1),
				worst: +at(1).toFixed(1),
			},
			playheadMovedPx: Math.round(moved),
		};
	});
	console.log(`[playback] ${JSON.stringify(result, null, 1)}`);
});
