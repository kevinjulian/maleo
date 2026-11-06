import { PREVIEW_AUDIO_WORKLET_URL } from "./script-urls.ts";
import { audioOutputReply } from "@models/timeline/preview-audio-output-protocol.ts";

interface Budget {
	reserve(bytes: number): bigint | Promise<bigint>;
	release(lease: bigint): void;
}
export interface AudioOutputSnapshot {
	generation: number;
	frames: number;
	renderFrame: number;
	state: "paused" | "playing" | "buffering" | "suspended" | "closed" | "failed";
	error?: string;
}
export interface AudioOutputTimestamp {
	contextTime: number;
	performanceTime: number;
	output: { contextTime: number; performanceTime: number } | null;
	baseLatency: number | null;
	outputLatency: number | null;
}

/**
 * Call from the main-thread Play gesture, or with `activate: false` ahead of Play to prepare a
 * suspended output: the context opens its device (about 200 ms) and loads the worklet before the
 * gesture, and Play then only calls `resume()`.
 */
export async function createAudioOutput(options: {
	budget: Budget;
	change(snapshot: AudioOutputSnapshot): void;
	workletUrl?: string;
	activate?: boolean;
}) {
	const context = new AudioContext({ latencyHint: "interactive" });
	let node: AudioWorkletNode;
	try {
		if (options.activate !== false) {
			// Resume before any module/network await so the caller's user activation is retained.
			await context.resume();
			if (context.state !== "running")
				throw new DOMException("Audio output activation was rejected", "NotAllowedError");
		}
		await context.audioWorklet.addModule(options.workletUrl ?? PREVIEW_AUDIO_WORKLET_URL);
		node = new AudioWorkletNode(context, "maleo-preview-audio", {
			numberOfInputs: 0,
			numberOfOutputs: 1,
			outputChannelCount: [2],
		});
		node.connect(context.destination);
	} catch (error) {
		await context.close();
		throw error;
	}
	const pending = new Map<number, { lease: bigint; frames: number }>(),
		flushing = new Map<number, () => void>();
	let generation = 0,
		nextId = 0,
		queuedFrames = 0,
		posting = false,
		closed = false;
	let snapshot: AudioOutputSnapshot = { generation, frames: 0, renderFrame: 0, state: "paused" };
	let disposing: Promise<void> | undefined;
	let postingDone: Promise<void> | undefined, finishPosting: (() => void) | undefined;
	let failure: string | undefined;
	function notify(state: AudioOutputSnapshot["state"]) {
		snapshot = { ...snapshot, generation, state, ...(failure ? { error: failure } : {}) };
		options.change(snapshot);
	}
	function release(ids: number[]) {
		for (const id of ids) {
			const block = pending.get(id);
			if (!block) continue;
			pending.delete(id);
			queuedFrames -= block.frames;
			options.budget.release(block.lease);
		}
	}
	async function dispose() {
		if (disposing) return disposing;
		closed = true;
		disposing = (async () => {
			context.onstatechange = null;
			node.port.onmessage = null;
			node.port.postMessage({ type: "dispose" });
			node.disconnect();
			try {
				await context.close();
			} finally {
				await postingDone;
				node.port.close();
				release([...pending.keys()]);
				for (const resolve of flushing.values()) resolve();
				flushing.clear();
				notify(failure ? "failed" : "closed");
			}
		})();
		return disposing;
	}
	function flush(): Promise<void> {
		if (closed) return Promise.resolve();
		generation++;
		snapshot = {
			generation,
			frames: 0,
			renderFrame: 0,
			state: context.state === "running" ? "paused" : "suspended",
		};
		const done = new Promise<void>((resolve) => flushing.set(generation, resolve));
		node.port.postMessage({ type: "flush", generation });
		options.change(snapshot);
		return done;
	}
	node.onprocessorerror = () => {
		failure = "AudioWorklet processor failed";
		notify("failed");
		void dispose();
	};
	node.port.onmessage = ({ data }: MessageEvent<unknown>) => {
		if (closed) return;
		const parsed = audioOutputReply.safeParse(data);
		if (!parsed.success) {
			failure = "Invalid audio output response";
			notify("failed");
			void dispose();
			return;
		}
		const message = parsed.data;
		if (message.type === "released" || message.type === "flushed") {
			release(message.ids);
			if (message.type === "flushed") {
				flushing.get(message.generation)?.();
				flushing.delete(message.generation);
			}
			return;
		}
		if (message.type === "failed") {
			failure = message.message;
			notify("failed");
			void dispose();
			return;
		}
		if (message.generation !== generation) return;
		snapshot = {
			generation: message.generation,
			frames: message.frames,
			renderFrame: message.renderFrame,
			state: context.state === "running" ? message.state : "suspended",
		};
		options.change(snapshot);
	};
	context.onstatechange = () => {
		if (closed) return;
		if (context.state !== "running") {
			notify("suspended");
			void flush();
		}
	};
	return {
		sampleRate: context.sampleRate,
		get generation() {
			return generation;
		},
		get queuedFrames() {
			return queuedFrames;
		},
		get snapshot() {
			return snapshot;
		},
		/** A false return retains the caller's buffer. A true return transfers and detaches it. */
		async push(pcm: Float32Array<ArrayBuffer>, at: number): Promise<boolean> {
			if (closed || at !== generation) return false;
			if (pcm.length % 2 || pcm.length === 0 || pcm.some((value) => !Number.isFinite(value)))
				throw new Error("Invalid stereo output PCM");
			const frames = pcm.length / 2;
			if (posting || queuedFrames + frames > context.sampleRate * 2) return false;
			posting = true;
			postingDone = new Promise<void>((resolve) => {
				finishPosting = resolve;
			});
			let lease: bigint | undefined;
			try {
				lease = await options.budget.reserve(pcm.byteLength);
				if (closed || at !== generation) {
					options.budget.release(lease);
					return false;
				}
				const id = ++nextId;
				pending.set(id, { lease, frames });
				queuedFrames += frames;
				try {
					node.port.postMessage({ type: "block", id, generation, pcm }, [pcm.buffer]);
				} catch (error) {
					release([id]);
					throw error;
				}
				return true;
			} finally {
				posting = false;
				finishPosting?.();
				finishPosting = undefined;
				postingDone = undefined;
			}
		},
		play() {
			if (closed) throw new Error("Audio output is closed");
			if (context.state !== "running")
				throw new DOMException("Audio output is suspended", "NotAllowedError");
			node.port.postMessage({ type: "play", generation });
		},
		pause: flush,
		flush,
		/** Resume must also be called from a fresh user gesture after platform suspension. */
		async resume() {
			if (closed) throw new Error("Audio output is closed");
			await context.resume();
			if (context.state !== "running")
				throw new DOMException("Audio output activation was rejected", "NotAllowedError");
		},
		/** Audio render-frame and platform output timestamps share this AudioContext clock. */
		timestamp(): AudioOutputTimestamp {
			const now = performance.now();
			const reported =
				typeof context.getOutputTimestamp === "function" ? context.getOutputTimestamp() : null;
			const contextTime = reported?.contextTime,
				performanceTime = reported?.performanceTime;
			const output =
				typeof contextTime === "number" &&
				Number.isFinite(contextTime) &&
				contextTime >= 0 &&
				typeof performanceTime === "number" &&
				Number.isFinite(performanceTime) &&
				performanceTime > 0
					? { contextTime, performanceTime }
					: null;
			return {
				contextTime: context.currentTime,
				performanceTime: now,
				output,
				baseLatency:
					Number.isFinite(context.baseLatency) && context.baseLatency >= 0
						? context.baseLatency
						: null,
				outputLatency:
					Number.isFinite(context.outputLatency) && context.outputLatency >= 0
						? context.outputLatency
						: null,
			};
		},
		dispose,
	};
}
