import { PREVIEW_AUDIO_WORKLET_URL } from "./script-urls.ts";
import type { PreviewClient, PreviewWorkerLike } from "@models/timeline/preview-client.ts";
import type {
	PreviewMediaEvent,
	PreviewRequest,
	PreviewState,
} from "@models/timeline/preview-protocol.ts";
import { createAudioOutput, type AudioOutputSnapshot } from "./audio-output.ts";

export interface CompareAudioState {
	status: "paused" | "priming" | "playing" | "buffering" | "suspended" | "failed";
	message?: string;
}
type Output = Awaited<ReturnType<typeof createAudioOutput>>;
type Block = Extract<PreviewMediaEvent, { type: "audio-block" }>["block"];
interface Waiting<T> {
	resolve(value: T): void;
	reject(error: Error): void;
}

/** Prepare scripts only. start() creates/resumes output in the caller's Play gesture. */
export async function createCompareAudio(
	worker: PreviewWorkerLike,
	client: PreviewClient,
	changed: (state: CompareAudioState) => void,
) {
	const response = await fetch(PREVIEW_AUDIO_WORKLET_URL);
	if (!response.ok) throw new Error("Audio output script is unavailable");
	const workletUrl = URL.createObjectURL(await response.blob());
	let closed = false,
		wanted = false,
		epoch = 0,
		nextRequest = 0;
	let output: Output | undefined, activation: Promise<Output> | undefined;
	/** A prepared output, resolved and not yet playing: Play resumes it inside the gesture. */
	let primed: Output | undefined;
	let snapshot: AudioOutputSnapshot | undefined, preview: PreviewState | undefined;
	let phase: CompareAudioState["status"] = "paused",
		rate = 1,
		end = false;
	let dead = false;
	let disposing: Promise<void> | undefined, terminated: Promise<void> | undefined;
	let deactivating: Promise<void> | undefined;
	let waitingFor: "gpu" | "video" | "buffering" | undefined;
	let attempts = 0,
		lastRecoveryPosition = -1;
	let frame = 0,
		timer: ReturnType<typeof setTimeout> | undefined;
	let configured: Waiting<void> | undefined;
	let started: Waiting<void> | undefined;
	let operation: Promise<void> = Promise.resolve();
	let pumping = false;
	const reservations = new Map<number, Waiting<bigint>>();
	const pulls = new Map<number, Waiting<Block>>();
	function post(message: PreviewRequest) {
		if (closed || dead) throw new Error("Compare audio is closed");
		worker.postMessage(message, []);
	}
	function state(status: CompareAudioState["status"], message?: string) {
		if (phase === status && !message) return;
		phase = status;
		changed({ status, ...(message ? { message } : {}) });
	}
	function release(lease: bigint) {
		if (!closed && !dead) post({ type: "pcm-release", lease });
	}
	const budget = {
		reserve(bytes: number): Promise<bigint> {
			const requestId = ++nextRequest;
			return new Promise((resolve, reject) => {
				reservations.set(requestId, { resolve, reject });
				try {
					post({ type: "pcm-reserve", requestId, bytes });
				} catch (error) {
					reservations.delete(requestId);
					reject(error);
				}
			});
		},
		release,
	};
	function discard(block: Block) {
		if (!block) return;
		if (block.pcm.buffer.byteLength)
			structuredClone(block.pcm.buffer, { transfer: [block.pcm.buffer] });
		release(block.lease);
	}
	function cancel() {
		epoch++;
		cancelAnimationFrame(frame);
		if (timer) clearTimeout(timer);
		timer = undefined;
		const error = new DOMException("Audio generation replaced", "AbortError");
		configured?.reject(error);
		configured = undefined;
		started?.reject(error);
		started = undefined;
		for (const waiting of pulls.values()) waiting.reject(error);
		pulls.clear();
	}
	async function silence() {
		await output?.pause();
	}
	function fail(message: string, status: "failed" | "suspended" = "failed") {
		if (closed || dead || (!wanted && (phase === "failed" || phase === "suspended"))) return;
		wanted = false;
		waitingFor = undefined;
		cancel();
		state(status, message);
		client.mediaPlayback({ state: "stalled", message });
		const stopped = output ? Promise.resolve(output) : activation;
		output = undefined;
		activation = undefined;
		primed = undefined;
		void stopped?.then((device) => device.dispose()).catch(() => {});
		client.audioStop();
	}
	function observe() {
		if (!output || !snapshot || !wanted || phase !== "playing") return;
		const stamp = output.timestamp();
		const latency =
			stamp.baseLatency === null || stamp.outputLatency === null
				? null
				: stamp.baseLatency + stamp.outputLatency;
		if (!stamp.output && latency === null) {
			fail("Audio output has no timestamp or latency estimate");
			return;
		}
		client.audioPosition({
			generation: epoch,
			frames: snapshot.frames,
			renderFrame: snapshot.renderFrame,
			contextTime: stamp.contextTime,
			performanceTime: stamp.performanceTime,
			output: stamp.output,
			latency,
		});
	}
	async function queueBlock(generation: number) {
		const device = output;
		if (!device || generation !== epoch || closed) return;
		const requestId = ++nextRequest;
		const pending = new Promise<Block>((resolve, reject) =>
			pulls.set(requestId, { resolve, reject }),
		);
		post({
			type: "audio-pull",
			generation: client.generation,
			outputGeneration: generation,
			requestId,
			availableFrames: device.sampleRate * 2 - device.queuedFrames,
		});
		const block = await pending;
		if (!block) {
			end = true;
			return;
		}
		try {
			if (generation !== epoch || closed) return;
			if (!(await device.push(block.pcm, device.generation)))
				throw new Error("Audio output rejected a reserved block");
		} finally {
			discard(block);
		}
	}
	function schedule(generation: number) {
		frame = requestAnimationFrame(() => {
			if (closed || generation !== epoch || !wanted || phase !== "playing") return;
			observe();
			if (!pumping && !end && output && output.queuedFrames < output.sampleRate) {
				pumping = true;
				operation = queueBlock(generation)
					.catch((error: unknown) => {
						if (generation === epoch)
							recover(error instanceof Error ? error.message : "Audio decode failed");
					})
					.finally(() => {
						pumping = false;
					});
			}
			schedule(generation);
		});
	}
	function recover(message: string) {
		if (!wanted || closed || waitingFor) return;
		observe();
		waitingFor = "buffering";
		client.mediaPlayback({ state: "buffering" });
		state("buffering", message);
		cancel();
		void silence();
	}
	function activate(resume: boolean): Promise<Output> {
		activation ??= createAudioOutput({
			budget,
			workletUrl,
			activate: resume,
			change: (next) => {
				if (closed) return;
				snapshot = next;
				if (next.state === "failed") fail(next.error ?? "Audio output failed");
				// A prepared output is suspended until Play; only a wanted output can be suspended.
				else if (next.state === "suspended" && wanted)
					fail("Audio output suspended. Press Play to resume.", "suspended");
				else if (next.state === "buffering" && phase === "playing" && !end)
					recover("Audio output is buffering");
			},
		});
		return activation;
	}
	async function begin(position: number, speed: number, recovery: boolean) {
		if (closed || dead || disposing) return;
		wanted = true;
		waitingFor = undefined;
		rate = speed;
		cancel();
		const generation = epoch;
		state("priming");
		// Resume a prepared output inside the gesture; failure surfaces at the awaited resume below.
		if (primed) void primed.resume().catch(() => {});
		// Start activation synchronously before awaiting cancellation or worker replies.
		const activated = activate(true);
		try {
			const device = await activated;
			await deactivating;
			if (generation !== epoch || closed) {
				if (activated !== activation || !wanted || closed) await device.dispose();
				return;
			}
			output = device;
			primed = undefined;
			await device.resume();
			if (generation !== epoch || closed) return;
			await silence();
			await operation.catch(() => {});
			if (generation !== epoch || closed) return;
			client.pause(position);
			const ready = new Promise<void>((resolve, reject) => {
				configured = { resolve, reject };
			});
			post({
				type: "audio-configure",
				generation: client.generation,
				outputGeneration: generation,
				position,
				rate,
				sampleRate: device.sampleRate,
			});
			await ready;
			end = false;
			while (!end && device.queuedFrames < device.sampleRate * 0.25) {
				operation = queueBlock(generation);
				await operation;
			}
			if (generation !== epoch || closed) return;
			const accepted = new Promise<void>((resolve, reject) => {
				started = { resolve, reject };
			});
			client.audioPlay({ generation, position, sampleRate: device.sampleRate, rate });
			await accepted;
			if (generation !== epoch || closed) return;
			state("playing");
			device.play();
			schedule(generation);
		} catch (error) {
			if (generation !== epoch || closed) return;
			if (recovery) {
				state("buffering");
				if (attempts < 2) timer = setTimeout(() => retry(position), 1500);
				else fail(error instanceof Error ? error.message : "Audio recovery failed");
			} else fail(error instanceof Error ? error.message : "Audio activation failed");
		}
	}
	function retry(position: number) {
		if (!wanted || closed) return;
		if (position > lastRecoveryPosition + 1e-6) attempts = 0;
		lastRecoveryPosition = position;
		if (attempts >= 2) {
			fail("Audio recovery failed after two attempts");
			return;
		}
		attempts++;
		void begin(position, rate, true);
	}
	return {
		rate(speed: number) {
			if (wanted) void begin(preview?.position ?? 0, speed, true);
			else rate = speed;
		},
		seek(position: number, speed: number) {
			if (wanted) void begin(position, speed, true);
			else client.pause(position);
		},
		/** Open the device and load the worklet before Play, suspended. Never resumes or plays. */
		prepare() {
			if (closed || dead || disposing || deactivating || activation) return;
			const pending = activate(false);
			pending.then(
				(device) => {
					if (activation === pending) primed = device;
				},
				() => {
					if (activation === pending) activation = undefined;
				},
			);
		},
		start(position: number, speed: number) {
			attempts = 0;
			void begin(position, speed, false);
		},
		async pause(position = preview?.position ?? 0) {
			wanted = false;
			waitingFor = undefined;
			cancel();
			client.pause(position);
			await silence();
			client.audioStop();
			state("paused");
		},
		deactivate(): Promise<void> {
			if (closed) return Promise.resolve();
			if (deactivating) return deactivating;
			wanted = false;
			waitingFor = undefined;
			cancel();
			client.pause(preview?.position ?? 0);
			const stopped = output ?? activation;
			output = undefined;
			activation = undefined;
			primed = undefined;
			deactivating = Promise.resolve(stopped)
				.then((device) => device?.dispose())
				.finally(() => {
					if (!dead) client.audioStop();
					if (!wanted) state("paused");
					deactivating = undefined;
				});
			return deactivating;
		},
		observe(next: PreviewState) {
			const previous = preview;
			preview = next;
			if (!wanted || closed) return;
			if (next.status === "failed" || !next.mediaReady) {
				void this.pause(next.position);
				return;
			}
			if (next.status === "stalled") {
				fail(next.message ?? "Local media recovery failed");
				return;
			}
			if (next.status === "device-lost") {
				if (waitingFor !== "gpu") {
					cancel();
					waitingFor = "gpu";
					state("buffering");
					void silence();
				}
				return;
			}
			if (waitingFor === "gpu") {
				if (next.status === "buffering") {
					waitingFor = "video";
					return;
				}
				waitingFor = undefined;
				retry(next.position);
				return;
			}
			if (next.status === "buffering" && phase === "playing" && !waitingFor) {
				cancel();
				waitingFor = "video";
				state("buffering");
				void silence();
				return;
			}
			if (waitingFor === "video" && next.status === "playing") {
				waitingFor = undefined;
				retry(next.position);
				return;
			}
			if (waitingFor === "buffering" && next.status === "buffering") {
				waitingFor = undefined;
				retry(next.position);
				return;
			}
			if (phase === "playing" && previous && previous.generation !== next.generation) {
				void begin(next.position, rate, true);
				return;
			}
			if (phase === "playing" && next.status === "paused") void this.pause(next.position);
		},
		handle(event: PreviewMediaEvent): boolean {
			if (event.type === "pcm-reserved") {
				const waiting = reservations.get(event.requestId);
				reservations.delete(event.requestId);
				if (waiting && event.lease !== null) waiting.resolve(event.lease);
				else if (waiting) waiting.reject(new Error(event.message ?? "PCM reservation failed"));
				else if (event.lease !== null) release(event.lease);
				return true;
			}
			if (event.type === "audio-block") {
				const waiting = pulls.get(event.requestId);
				pulls.delete(event.requestId);
				if (waiting && event.generation === client.generation && event.outputGeneration === epoch)
					waiting.resolve(event.block);
				else {
					discard(event.block);
					waiting?.reject(new DOMException("Audio input changed", "AbortError"));
				}
				return true;
			}
			if (event.type === "audio-started") {
				if (event.generation === client.generation && event.outputGeneration === epoch) {
					started?.resolve();
					started = undefined;
				}
				return true;
			}
			if (event.type === "audio-ready" || event.type === "audio-failed") {
				if (event.generation !== client.generation || event.outputGeneration !== epoch) return true;
				const ready = configured;
				configured = undefined;
				if (event.type === "audio-ready") ready?.resolve();
				else {
					ready?.reject(new Error(event.message));
					started?.reject(new Error(event.message));
					started = undefined;
					for (const waiting of pulls.values()) waiting.reject(new Error(event.message));
					pulls.clear();
				}
				return true;
			}
			return false;
		},
		/** Worker termination must reject budget waits before closing the output node. */
		terminated() {
			if (terminated) return terminated;
			dead = true;
			wanted = false;
			cancel();
			for (const waiting of reservations.values())
				waiting.reject(new Error("Preview worker terminated"));
			reservations.clear();
			state("failed", "Preview worker terminated");
			terminated = Promise.all([
				deactivating,
				Promise.resolve(output ?? activation).then((device) => device?.dispose()),
			]).then(() => {});
			return terminated;
		},
		dispose(): Promise<void> {
			if (disposing) return disposing;
			wanted = false;
			cancel();
			disposing = (async () => {
				try {
					const device = output ?? (await activation?.catch(() => undefined));
					await Promise.all([deactivating, device?.dispose()]);
				} finally {
					if (!dead) client.audioStop();
					closed = true;
					URL.revokeObjectURL(workletUrl);
				}
			})();
			return disposing;
		},
	};
}
