import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

test("real preview worker rejects unready Play and preserves accepted input across malformed and stale requests", async ({
	playwright,
}, info) => {
	test.setTimeout(60_000);
	const browser = await playwright.chromium.launch({
		args: [
			"--enable-unsafe-webgpu",
			...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
		],
	});
	try {
		const context = await browser.newContext({ baseURL: "http://127.0.0.1:3031" });
		await context.route("**/renderer/maleo_renderer_wasm.js", async (route) => {
			const response = await route.fetch();
			await route.fulfill({
				response,
				body:
					(await response.text()) +
					`
const realRecoverDevice=recover_device;
globalThis.recoveryAttempts=0;
recover_device=async()=>{globalThis.recoveryAttempts++;await new Promise(resolve=>setTimeout(resolve,300));if(globalThis.forceRecoveryFailure)throw new Error("Injected adapter refusal");const accepted=await realRecoverDevice();(globalThis.recoveryResults??=[]).push(accepted);return accepted;};
`,
			});
		});
		const page = await context.newPage();
		const entry = info.outputPath("state.ts"),
			bundle = info.outputPath("state.js");
		writeFileSync(
			entry,
			`
import {createPreviewClient} from ${JSON.stringify(resolve(import.meta.dirname, "../src/models/timeline/preview-client.ts"))};
const worker=new Worker("/renderer/preview-worker.js",{type:"module"}),states=[],errors=[];
const client=createPreviewClient(worker,state=>states.push(state),error=>errors.push(error),undefined,()=>{});
client.init(document.querySelector("canvas").transferControlToOffscreen());
const story=JSON.stringify({scenes:[{durationSec:10,image:"",movement:"Static",transition:"cut"}],bgColor:"#193456"});
const pending={revision:"full-dependencies-r1",sourceGeneration:1,sequence:0,ready:false,blockers:[]};
client.storyboard(story,30,300,[],pending);
Object.assign(globalThis,{stateProbe:{states,errors,client,worker,ready:()=>client.readiness({...pending,ready:true,sequence:1}),bad:()=>client.storyboard("{invalid",30,300,[],{...pending,revision:"bad",ready:true,sequence:2}),next:()=>client.storyboard(story,30,300,[],{...pending,revision:"full-dependencies-r2",ready:true,sequence:3}),close:()=>client.dispose()}});
`,
		);
		execFileSync("bun", ["build", entry, "--target=browser", "--outfile", bundle], {
			stdio: "pipe",
		});
		await context.route("**/media-state-probe", (route) =>
			route.fulfill({
				contentType: "text/html",
				body: '<!doctype html><canvas width="160" height="96"></canvas>',
			}),
		);
		await page.goto("/media-state-probe");
		await page.addScriptTag({ content: readFileSync(bundle, "utf8") });
		await page.waitForFunction(() => "stateProbe" in globalThis);
		const state = () =>
			page.evaluate(() => {
				// SAFETY: this test's generated entry owns the protocol probe and its state ledger.
				const probe = (
					globalThis as typeof globalThis & {
						stateProbe: {
							states: Array<{
								status: string;
								position: number;
								generation: number;
								mediaReady: boolean;
								clockOwner: string;
								error: string | null;
							}>;
						};
					}
				).stateProbe;
				return probe.states.at(-1);
			});
		await expect.poll(async () => (await state())?.generation).toBe(1);
		await page.evaluate(() => {
			// SAFETY: methods come from createPreviewClient in the generated entry.
			const probe = (
				globalThis as typeof globalThis & {
					stateProbe: {
						client: { play(position: number, rate: number): void; seek(frame: number): void };
					};
				}
			).stateProbe;
			probe.client.play(1, 1);
		});
		await expect.poll(async () => (await state())?.error).toContain("loading");
		expect(await state()).toMatchObject({ position: 0, mediaReady: false });
		await page.evaluate(() => {
			// SAFETY: generated probe owns readiness completion and client.
			const probe = (
				globalThis as typeof globalThis & {
					stateProbe: { client: { seek(frame: number): void }; ready(): void };
				}
			).stateProbe;
			probe.client.seek(60);
			probe.ready();
		});
		await expect.poll(async () => (await state())?.mediaReady).toBe(true);
		expect(await state()).toMatchObject({ position: 2, status: "ready" });
		await page.evaluate(() => {
			// SAFETY: generated probe intentionally submits an invalid storyboard through the actual client.
			(globalThis as typeof globalThis & { stateProbe: { bad(): void } }).stateProbe.bad();
		});
		await expect.poll(async () => (await state())?.error).not.toBeNull();
		expect(await state()).toMatchObject({ generation: 1, position: 2, mediaReady: true });
		const rollback = await page.evaluate(() => {
			// SAFETY: generated probe exposes the client's accepted generation.
			return (globalThis as typeof globalThis & { stateProbe: { client: { generation: number } } })
				.stateProbe.client.generation;
		});
		expect(rollback).toBe(1);
		await page.evaluate(() => {
			// SAFETY: generated probe submits a fresh input and then an obsolete update.
			const probe = (
				globalThis as typeof globalThis & { stateProbe: { next(): void; worker: Worker } }
			).stateProbe;
			probe.next();
			probe.worker.postMessage({
				type: "media-readiness",
				generation: 1,
				readiness: {
					revision: "full-dependencies-r1",
					sourceGeneration: 1,
					sequence: 999,
					ready: false,
					blockers: [],
				},
			});
		});
		await expect.poll(async () => (await state())?.generation).toBe(3);
		expect(await state()).toMatchObject({ position: 2, mediaReady: true });
		await page.evaluate(() => {
			// SAFETY: output observations are deterministic fake output data at the real WASM boundary.
			const probe = (
				globalThis as typeof globalThis & {
					stateProbe: {
						client: {
							audioPlay(anchor: {
								generation: number;
								position: number;
								sampleRate: number;
								rate: number;
							}): void;
							audioPosition(observation: {
								generation: number;
								frames: number;
								renderFrame: number;
								contextTime: number;
								performanceTime: number;
								output: { contextTime: number; performanceTime: number };
								latency: null;
							}): void;
						};
					};
				}
			).stateProbe;
			probe.client.audioPlay({ generation: 1, position: 2, sampleRate: 48000, rate: 2 });
			probe.client.audioPosition({
				generation: 1,
				frames: 24000,
				renderFrame: 48000,
				contextTime: 1,
				performanceTime: 1000,
				output: { contextTime: 0.98, performanceTime: 1000 },
				latency: null,
			});
		});
		await expect.poll(async () => (await state())?.clockOwner).toBe("audio");
		await expect.poll(async () => (await state())?.position).toBeCloseTo(2.96, 8);
		await page.evaluate(() => {
			// SAFETY: generated client sends explicit buffering while retaining user play intent.
			(
				globalThis as typeof globalThis & {
					stateProbe: { client: { mediaPlayback(playback: { state: "buffering" }): void } };
				}
			).stateProbe.client.mediaPlayback({ state: "buffering" });
		});
		await expect.poll(async () => (await state())?.status).toBe("buffering");
		expect((await state())?.position).toBeCloseTo(2.96, 8);
		const previewWorker = page
			.workers()
			.find((worker) => worker.url().includes("preview-worker.js"));
		if (!previewWorker) throw new Error("Preview worker is missing");
		await previewWorker.evaluate(() => {
			// SAFETY: renderer worker owns the debug loss hook.
			(globalThis as typeof globalThis & { loseDevice(): void }).loseDevice();
		});
		await expect.poll(async () => (await state())?.status).toBe("device-lost");
		await page.evaluate(() => {
			// SAFETY: generated client supplies explicit user Pause during recovery.
			(
				globalThis as typeof globalThis & {
					stateProbe: { client: { pause(position: number): void } };
				}
			).stateProbe.client.pause(2.96);
		});
		await expect.poll(async () => (await state())?.status).toBe("paused");
		expect((await state())?.position).toBeCloseTo(2.96, 8);
		await previewWorker.evaluate(() => {
			interface AdapterRequests {
				requestAdapter(options?: unknown): Promise<unknown>;
			}
			// SAFETY: the test already created a real GPU; DOM lib versions differ on this property.
			const gpu: AdapterRequests = (navigator as Navigator & { gpu: AdapterRequests }).gpu;
			const request = gpu.requestAdapter.bind(gpu);
			let calls = 0;
			gpu.requestAdapter = async (options) => {
				if (calls++ === 0) await new Promise((resolve) => setTimeout(resolve, 2100));
				return request(options);
			};
			// SAFETY: generated module wrapper owns the completion ledger and actual loss hook.
			const scope = globalThis as typeof globalThis & {
				recoveryResults: boolean[];
				loseDevice(): void;
			};
			scope.recoveryResults = [];
			scope.loseDevice();
		});
		await expect
			.poll(
				async () =>
					await previewWorker.evaluate(() => {
						// SAFETY: generated wrapper records actual accepted/discarded native recovery results.
						return (globalThis as typeof globalThis & { recoveryResults: boolean[] })
							.recoveryResults;
					}),
				{ timeout: 10_000 },
			)
			.toEqual([true, false]);
		expect(await state()).toMatchObject({ status: "paused", position: 2.96 });
		await previewWorker.evaluate(() => {
			// SAFETY: this test's module wrapper owns the refusal flag and attempt counter.
			const scope = globalThis as typeof globalThis & {
				forceRecoveryFailure: boolean;
				recoveryAttempts: number;
				loseDevice(): void;
			};
			scope.forceRecoveryFailure = true;
			scope.recoveryAttempts = 0;
			scope.loseDevice();
		});
		await expect.poll(async () => (await state())?.status).toBe("failed");
		expect((await state())?.position).toBeCloseTo(2.96, 8);
		expect(
			await previewWorker.evaluate(() => {
				// SAFETY: generated module wrapper owns this attempt counter.
				return (globalThis as typeof globalThis & { recoveryAttempts: number }).recoveryAttempts;
			}),
		).toBe(2);
		const result = await page.evaluate(() => {
			// SAFETY: generated probe owns disposal and returned ledgers.
			const probe = (
				globalThis as typeof globalThis & {
					stateProbe: { close(): void; errors: string[]; states: unknown[] };
				}
			).stateProbe;
			const result = { errors: probe.errors, states: probe.states };
			probe.close();
			return result;
		});
		expect(result.errors).toEqual([]);
		writeFileSync(info.outputPath("media-state.json"), JSON.stringify(result, null, "\t") + "\n");
	} finally {
		await browser.close();
	}
});
