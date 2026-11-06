import { instantiateEngine } from "../../../packages/shared/src/editor/engine.ts";
import { provideEditorEngine } from "../../../packages/shared/src/editor/engine-registry.ts";
import { createPreviewMediaSession } from "../src/services/preview-media/session.ts";
import { createCompareMediaBridge } from "../src/services/preview-media/compare-bridge.ts";
import { createCompareAudio } from "../src/services/preview-media/compare-audio.ts";
import { createPreviewClient } from "../src/models/timeline/preview-client.ts";
import type { PreviewState } from "../src/models/timeline/preview-protocol.ts";

export interface StressMetrics {
	visualPeak: number;
	pcmPeak: number;
	pcmUsed: number;
	visualUsed: number;
	videoSlots: number;
	decoded: number;
	draw?: { serial: number; frame: number; ms: number; audio: boolean; supported: boolean };
}
export interface StressReport {
	preview?: PreviewState;
	metrics?: StressMetrics;
	/** Each drawn frame, stamped with the page time its report arrived. */
	draws: Array<NonNullable<StressMetrics["draw"]> & { at: number }>;
	/** Each seek of the burst, in page milliseconds. */
	seekRequests: Array<{ at: number; sec: number }>;
	/** Each preview status change, in page milliseconds, to locate stalls. */
	transitions: Array<{ at: number; status: string; position: number }>;
	errors: string[];
	audioState?: string;
	readinessMs: number;
	sampleRate?: number;
	contexts: string[];
	outputPeak: number;
	outputFrames: number;
}
declare global {
	interface Window {
		prepareMediaStress(): Promise<void>;
		mediaStress: {
			report(): StressReport;
			seekBurst(): Promise<void>;
			/** Paused seeks, one at a time: request to the first fully covered frame at the target. */
			pacedSeeks(): Promise<Array<{ sec: number; ms: number | null }>>;
			close(): Promise<void>;
		};
	}
}

window.prepareMediaStress = async () => {
	provideEditorEngine(
		await instantiateEngine(
			new Uint8Array(await (await fetch("/editor-engine.wasm")).arrayBuffer()),
		),
	);
	let finish!: () => void;
	let fail!: (error: Error) => void;
	const ready = new Promise<void>((resolve, reject) => {
		finish = resolve;
		fail = reject;
	});
	const names = ["video-a.mp4", "video-b.mp4", "voice.wav", "music.wav"];
	const started = performance.now();
	const owner = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {
			const failed = owner.snapshot().clips.find((clip) => clip.state.state === "failed");
			if (failed?.state.state === "failed") fail(new Error(failed.state.message));
			if (owner.snapshot().ready && names.every((name) => owner.resolve(`/stress-sources/${name}`)))
				finish();
		},
	});
	owner.update({
		sources: names.map((name) => ({
			id: name,
			revision: "synthetic-r1",
			url: `/stress-sources/${name}`,
			kinds: [name.endsWith("mp4") ? "video" : "audio"],
			clipIds: [name],
		})),
		clips: names.map((name) => ({ id: name, sourceIds: [name], blockers: [] })),
	});
	const timeout = setTimeout(
		() => fail(new Error(`Source readiness timed out: ${JSON.stringify(owner.snapshot())}`)),
		15_000,
	);
	try {
		await ready;
	} finally {
		clearTimeout(timeout);
	}
	const readinessMs = performance.now() - started;
	const urls = names.map((name) => owner.resolve(`/stress-sources/${name}`)!);
	const worker = new Worker("/renderer/preview-worker.js", { type: "module" });
	let metrics: StressMetrics | undefined;
	const draws: StressReport["draws"] = [];
	const drawWaiters = new Set<(draw: StressReport["draws"][number]) => void>();
	worker.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
		if (event.data.stressMetrics) {
			// SAFETY: the probe's worker/glue instrumentation supplies this scalar report.
			metrics = event.data.stressMetrics as StressMetrics;
			if (metrics.draw && draws.at(-1)?.serial !== metrics.draw.serial) {
				const draw = { ...metrics.draw, at: performance.now() };
				draws.push(draw);
				for (const waiter of drawWaiters) waiter(draw);
			}
			delete event.data.stressMetrics;
		}
	});
	const transitions: StressReport["transitions"] = [];
	const seekRequests: StressReport["seekRequests"] = [];
	const states: PreviewState[] = [],
		errors: string[] = [],
		contexts: AudioContext[] = [];
	let outputPeak = 0,
		outputFrames = 0,
		audioState: string | undefined;
	const NativeContext = AudioContext;
	globalThis.AudioContext = class extends NativeContext {
		constructor(options?: AudioContextOptions) {
			super(options);
			contexts.push(this);
		}
	};
	const NativeNode = AudioWorkletNode;
	globalThis.AudioWorkletNode = class extends NativeNode {
		constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
			super(context, name, options);
			this.port.addEventListener(
				"message",
				(event: MessageEvent<{ type: string; peak: number; frames: number }>) => {
					if (event.data.type === "stress-output") {
						outputPeak = Math.max(outputPeak, event.data.peak);
						outputFrames += event.data.frames;
						event.stopImmediatePropagation();
					}
				},
			);
			this.port.start();
		}
	};
	let audio: Awaited<ReturnType<typeof createCompareAudio>> | undefined;
	const bridge = createCompareMediaBridge(worker, (error) => errors.push(error));
	const client = createPreviewClient(
		worker,
		(state) => {
			if (state.status !== states.at(-1)?.status)
				transitions.push({ at: performance.now(), status: state.status, position: state.position });
			states.push(state);
			audio?.observe(state);
			// Like the editor with Rust audio selected: open the device before Play.
			if (state.mediaReady) audio?.prepare();
		},
		(error) => errors.push(error),
		undefined,
		(event) => {
			if (!audio?.handle(event)) bridge.handle(event);
		},
		bridge.dispose,
	);
	audio = await createCompareAudio(worker, client, (state) => {
		audioState = state.status;
	});
	const canvas = document.querySelector("canvas");
	if (!canvas) throw new Error("Stress canvas missing");
	client.init(canvas.transferControlToOffscreen());
	client.storyboard(
		JSON.stringify({
			scenes: [],
			videoOverlays: urls.slice(0, 2).map((url, index) => ({
				url,
				kind: "video",
				startSec: 0,
				durationSec: 60,
				volume: 0,
				layout: { xPct: 25 + index * 50, yPct: 50, widthPct: 50, heightPct: 100, fit: "contain" },
			})),
			audioOverlays: urls.slice(2).map((url, index) => ({
				url,
				kind: index === 0 ? "voiceover" : "music",
				startSec: 0,
				durationSec: 60,
				volume: index === 0 ? 1 : 0.3,
			})),
		}),
		30,
		1800,
		[],
		{
			revision: "stress-r1",
			sourceGeneration: owner.snapshot().generation,
			sequence: 0,
			ready: true,
			blockers: [],
		},
		bridge.bindings(urls),
	);
	const play = document.querySelector<HTMLButtonElement>("#play"),
		pause = document.querySelector<HTMLButtonElement>("#pause");
	if (!play || !pause) throw new Error("Stress controls missing");
	play.onclick = () => audio?.start(states.at(-1)?.position ?? 0, 1);
	pause.onclick = () => void audio?.pause(states.at(-1)?.position ?? 0);
	window.mediaStress = {
		report: () => ({
			preview: states.at(-1),
			metrics,
			draws,
			seekRequests,
			transitions,
			errors,
			audioState,
			readinessMs,
			sampleRate: contexts[0]?.sampleRate,
			contexts: contexts.map((context) => context.state),
			outputPeak,
			outputFrames,
		}),
		async seekBurst() {
			worker.postMessage({ type: "stress-delay", enabled: true });
			for (let index = 0; index < 100; index++) {
				const sec = index === 99 ? 55 : ((index * 17) % 55) + 0.1;
				seekRequests.push({ at: performance.now(), sec });
				audio?.seek(sec, 1);
				await new Promise((resolve) => setTimeout(resolve, 10));
			}
		},
		async pacedSeeks() {
			const latencies: Array<{ sec: number; ms: number | null }> = [];
			for (let index = 0; index < 100; index++) {
				const sec = index === 99 ? 55 : ((index * 17) % 55) + 0.1,
					target = Math.floor(sec * 30),
					at = performance.now();
				const ms = await new Promise<number | null>((resolve) => {
					const check = (draw: StressReport["draws"][number]) => {
						if (!draw.supported || draw.frame < target || draw.frame > target + 6) return;
						clearTimeout(timer);
						drawWaiters.delete(check);
						resolve(draw.at - at);
					};
					const timer = setTimeout(() => {
						drawWaiters.delete(check);
						resolve(null);
					}, 2000);
					drawWaiters.add(check);
					audio?.seek(sec, 1);
				});
				latencies.push({ sec, ms });
			}
			return latencies;
		},
		async close() {
			await audio?.dispose();
			client.dispose();
			await bridge.dispose();
			worker.terminate();
			bridge.terminated();
			await owner.dispose();
		},
	};
};
