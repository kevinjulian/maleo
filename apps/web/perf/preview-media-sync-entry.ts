import { instantiateEngine } from "../../../packages/shared/src/editor/engine.ts";
import { provideEditorEngine } from "../../../packages/shared/src/editor/engine-registry.ts";
import { createPreviewMediaSession } from "../src/services/preview-media/session.ts";
import { createCompareMediaBridge } from "../src/services/preview-media/compare-bridge.ts";
import { createCompareAudio } from "../src/services/preview-media/compare-audio.ts";
import { createPreviewClient } from "../src/models/timeline/preview-client.ts";
import type { PreviewState } from "../src/models/timeline/preview-protocol.ts";

/** Epoch milliseconds: the page and the worker share no performance time origin. */
export interface SyncDraw {
	frame: number;
	at: number;
}
export interface SyncVideoEvent {
	at: number;
	type: string;
	id: number;
	/** Requested timeline seconds on `out:frame`, sample seconds on `decoded`. */
	time?: number;
	consumer?: string;
}
export interface SyncReport {
	preview?: PreviewState;
	draws: SyncDraw[];
	/** Audible epoch time of each detected click, mapped through getOutputTimestamp(). */
	clicks: number[];
	/** Audible epoch time of output resuming after silence. */
	onsets: number[];
	audioEvents: Array<{ at: number; type: string }>;
	/** Video decode path from the probe's instrumentation: worker id, message or decoder event. */
	videoEvents: SyncVideoEvent[];
	/** The first Play's click event in the page; Playwright's click round trip comes before it. */
	playClickedAt?: number;
	/** Each preview status change, in epoch milliseconds. */
	transitions: Array<{ at: number; status: string; position: number; message: string | null }>;
	errors: string[];
	sampleRate?: number;
	outputLatencyMs?: number;
	baseLatencyMs?: number;
	contexts: string[];
}
declare global {
	interface Window {
		prepareMediaSync(): Promise<void>;
		mediaSync: {
			report(): SyncReport;
			now(): number;
			play(position: number, rate: number): void;
			rate(rate: number): void;
			seek(position: number, rate: number): void;
			pause(): Promise<void>;
			close(): Promise<void>;
		};
	}
}
const epoch = () => performance.timeOrigin + performance.now();

window.prepareMediaSync = async () => {
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
	const names = ["sync-video.mp4", "sync-clicks.m4a"];
	const owner = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {
			const failed = owner.snapshot().clips.find((clip) => clip.state.state === "failed");
			if (failed?.state.state === "failed") fail(new Error(failed.state.message));
			if (owner.snapshot().ready && names.every((name) => owner.resolve(`/sync-sources/${name}`)))
				finish();
		},
	});
	owner.update({
		sources: names.map((name) => ({
			id: name,
			revision: "sync-r1",
			url: `/sync-sources/${name}`,
			kinds: [name.endsWith("mp4") ? "video" : "audio"],
			clipIds: [name],
		})),
		clips: names.map((name) => ({ id: name, sourceIds: [name], blockers: [] })),
	});
	const timeout = setTimeout(
		() => fail(new Error(`Source readiness timed out: ${JSON.stringify(owner.snapshot())}`)),
		30_000,
	);
	try {
		await ready;
	} finally {
		clearTimeout(timeout);
	}
	const [video, audioUrl] = names.map((name) => owner.resolve(`/sync-sources/${name}`)!);
	const worker = new Worker("/renderer/preview-worker.js", { type: "module" });
	const draws: SyncDraw[] = [];
	const videoEvents: SyncVideoEvent[] = [];
	// The audio start path, for the D3 breakdown: requests out and replies in, in epoch ms.
	const audioEvents: SyncReport["audioEvents"] = [];
	const send = worker.postMessage.bind(worker);
	worker.postMessage = ((message: { type?: unknown }, transfer?: Transferable[]) => {
		if (typeof message?.type === "string" && message.type.startsWith("audio"))
			audioEvents.push({ at: epoch(), type: `out:${message.type}` });
		send(message, transfer ?? []);
	}) as Worker["postMessage"];
	worker.addEventListener("message", (event: MessageEvent<Record<string, unknown>>) => {
		if (typeof event.data.type === "string" && event.data.type.startsWith("audio"))
			audioEvents.push({ at: epoch(), type: `in:${event.data.type}` });
		if (event.data.syncDraws) {
			// SAFETY: the probe's worker instrumentation supplies this array of scalar draws.
			draws.push(...(event.data.syncDraws as SyncDraw[]));
			delete event.data.syncDraws;
		}
		if (event.data.syncVideo) {
			// SAFETY: the probe's worker instrumentation supplies this array of scalar events.
			videoEvents.push(...(event.data.syncVideo as SyncVideoEvent[]));
			delete event.data.syncVideo;
		}
	});
	const transitions: SyncReport["transitions"] = [];
	const states: PreviewState[] = [],
		errors: string[] = [],
		contexts: AudioContext[] = [],
		clicks: number[] = [],
		onsets: number[] = [];
	const NativeContext = AudioContext;
	globalThis.AudioContext = class extends NativeContext {
		constructor(options?: AudioContextOptions) {
			super(options);
			contexts.push(this);
			audioEvents.push({ at: epoch(), type: "context:create" });
			const addModule = this.audioWorklet.addModule.bind(this.audioWorklet);
			this.audioWorklet.addModule = async (...args: Parameters<typeof addModule>) => {
				audioEvents.push({ at: epoch(), type: "context:addModule" });
				await addModule(...args);
				audioEvents.push({ at: epoch(), type: "context:addModule-done" });
			};
		}
		override async resume() {
			audioEvents.push({ at: epoch(), type: "context:resume" });
			await super.resume();
			audioEvents.push({ at: epoch(), type: "context:resume-done" });
		}
	};
	const NativeNode = AudioWorkletNode;
	globalThis.AudioWorkletNode = class extends NativeNode {
		constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
			super(context, name, options);
			this.port.addEventListener(
				"message",
				(event: MessageEvent<{ type: string; contextTime: number }>) => {
					if (event.data.type !== "sync-click" && event.data.type !== "sync-onset") return;
					event.stopImmediatePropagation();
					// A rendered sample becomes audible at the output timestamp's mapping of its context time.
					const stamp = (context as AudioContext).getOutputTimestamp();
					if (stamp.contextTime === undefined || stamp.performanceTime === undefined) return;
					const audible =
						performance.timeOrigin +
						stamp.performanceTime +
						(event.data.contextTime - stamp.contextTime) * 1000;
					(event.data.type === "sync-click" ? clicks : onsets).push(audible);
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
				transitions.push({
					at: epoch(),
					status: state.status,
					position: state.position,
					message: state.message,
				});
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
	audio = await createCompareAudio(worker, client, () => {});
	const canvas = document.querySelector("canvas");
	if (!canvas) throw new Error("Sync canvas missing");
	client.init(canvas.transferControlToOffscreen());
	client.storyboard(
		JSON.stringify({
			scenes: [],
			videoOverlays: [
				{
					url: video,
					kind: "video",
					startSec: 0,
					durationSec: 600,
					volume: 0,
					layout: { xPct: 50, yPct: 50, widthPct: 100, heightPct: 100, fit: "contain" },
				},
			],
			audioOverlays: [
				{ url: audioUrl, kind: "voiceover", startSec: 0, durationSec: 600, volume: 1 },
			],
		}),
		30,
		18_000,
		[],
		{
			revision: "sync-r1",
			sourceGeneration: owner.snapshot().generation,
			sequence: 0,
			ready: true,
			blockers: [],
		},
		bridge.bindings([video!, audioUrl!]),
	);
	const play = document.querySelector<HTMLButtonElement>("#play");
	if (!play) throw new Error("Sync controls missing");
	// The first start needs a real user gesture for AudioContext; the spec clicks this button.
	let playClickedAt: number | undefined;
	play.onclick = () => {
		playClickedAt = epoch();
		audio?.start(0, 1);
	};
	window.mediaSync = {
		report: () => {
			const context = contexts[0];
			return {
				preview: states.at(-1),
				draws,
				clicks,
				onsets,
				audioEvents,
				videoEvents,
				playClickedAt,
				transitions,
				errors,
				sampleRate: context?.sampleRate,
				outputLatencyMs: context ? context.outputLatency * 1000 : undefined,
				baseLatencyMs: context ? context.baseLatency * 1000 : undefined,
				contexts: contexts.map((item) => item.state),
			};
		},
		now: epoch,
		play: (position, rate) => audio?.start(position, rate),
		rate: (rate) => audio?.rate(rate),
		seek: (position, rate) => audio?.seek(position, rate),
		pause: async () => {
			await audio?.pause();
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
