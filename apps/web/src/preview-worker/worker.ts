/* The preview worker (OpenSpec p2-preview-runtime D5): the engine's preview
 * session (`crates/renderer-wasm`) on the canvas the page transferred here, so a
 * slow frame never blocks the editor. It loads the renderer module from
 * `/renderer/`, runs the protocol in `models/timeline/preview-protocol.ts`,
 * decodes session-owned Files through the native visual pool, and ticks the session
 * from its own `requestAnimationFrame` only while playing or while a draw is
 * pending. It posts one state message per drawn frame, plus one for a play,
 * a pause, a refused request or a device change, none of which draw.
 *
 * Not part of the app bundle: `scripts/build-renderer-wasm.ts` bundles it to
 * `target/renderer-wasm/preview-worker.js`, served at `/renderer/` and loaded
 * only in compare mode. */
import type { PreviewRequest, PreviewState } from "@models/timeline/preview-protocol.ts";
import {
	previewNow,
	previewRequestSchema,
	previewRequestGeneration,
	EMPTY_PREVIEW_STATE,
} from "@models/timeline/preview-protocol.ts";
import { createWorkerDecoderRouter } from "./decoder-router.ts";
import { createVisualMedia, type VisualMediaHost } from "./visual-media.ts";
import { createDeviceRecovery } from "./device-recovery.ts";
import { createAudioMedia, type AudioMediaHost } from "./audio-media.ts";

/** The session exports of `crates/renderer-wasm` (wasm-bindgen glue). */
interface SessionModule extends VisualMediaHost, AudioMediaHost {
	default: () => Promise<unknown>;
	init: (canvas: OffscreenCanvas, onChange: () => void) => Promise<void>;
	set_storyboard_context: (
		json: string,
		fps: number,
		durationFrames: number,
		context: string,
		now: number,
	) => void;
	media_dispatch: (json: string, now: number) => boolean;
	seek: (position: number, now: number) => void;
	play: (position: number, at: number, rate: number) => void;
	pause: (position: number) => void;
	resize: (width: number, height: number) => void;
	put_image: (url: string, width: number, height: number, rgba: Uint8Array) => void;
	report_remotion: (position: number, at: number) => void;
	tick: (now: number) => Promise<boolean>;
	wants_tick: (now: number) => boolean;
	state: (now: number) => string;
	lose_device: () => void;
	recover_device: () => Promise<boolean>;
	fail_device: (message: string, now: number) => void;
}

/** The worker global this module runs in; the app's DOM lib has no worker scope. */
interface WorkerScope {
	onmessage: ((event: MessageEvent<unknown>) => void) | null;
	postMessage: (message: unknown, transfer?: Transferable[]) => void;
	requestAnimationFrame: (run: () => void) => number;
	loseDevice?: () => void;
}

// SAFETY: this module runs only as a dedicated worker's entry, whose global has these members.
const scope = globalThis as WorkerScope;
const MODULE_URL = "/renderer/maleo_renderer_wasm.js";

let session: SessionModule | null = null;
let fps = 30;
let looping = false;
let error: string | null = null;
let generation = 0,
	errorAt: number | undefined,
	initialized = false;
let media: ReturnType<typeof createVisualMedia> | null = null;
const decoders = createWorkerDecoderRouter((event) => scope.postMessage(event));
let deviceRecovery: ReturnType<typeof createDeviceRecovery> | undefined;
let audioMedia: Awaited<ReturnType<typeof createAudioMedia>> | undefined;
let audioGeneration = 0;
let storyboard: Extract<PreviewRequest, { type: "storyboard" }> | undefined;
let visualWaiting = false,
	visualAttempts = 0,
	visualAt = 0;
let visualProblem: string | undefined;

function message(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function post(state?: Partial<PreviewState>): void {
	// SAFETY: `state()` returns the session report `PreviewState` describes, less `error`.
	const report = session
		? (JSON.parse(session.state(previewNow())) as PreviewState)
		: EMPTY_PREVIEW_STATE;
	scope.postMessage({
		type: "state",
		state: { ...report, ...state, error },
		requestGeneration: errorAt ?? report.generation,
	});
}

function kick(): void {
	if (looping || !session) return;
	looping = true;
	scope.requestAnimationFrame(loop);
}

function updateMedia(live: SessionModule): void {
	try {
		const now = previewNow();
		const ready = media?.update(now) ?? true;
		// SAFETY: the WASM session emits the complete protocol state.
		const report = JSON.parse(live.state(now)) as PreviewState;
		if (visualWaiting && ready) {
			visualWaiting = false;
			visualAttempts = 0;
			visualProblem = undefined;
			live.media_dispatch(
				JSON.stringify({ type: "playback", generation, playback: { state: "ready" } }),
				now,
			);
			post();
		} else if (!ready && report.status === "playing") {
			visualWaiting = true;
			visualAttempts = 0;
			visualAt = now;
			live.media_dispatch(
				JSON.stringify({ type: "playback", generation, playback: { state: "buffering" } }),
				now,
			);
			queue = queue.then(async () => {
				await audioMedia?.reset();
			});
			post();
		} else if (visualWaiting && now - visualAt >= 1.5) {
			if (visualAttempts === 2) {
				visualWaiting = false;
				live.media_dispatch(
					JSON.stringify({
						type: "playback",
						generation,
						playback: {
							state: "stalled",
							message: visualProblem ?? "Local visual media stalled after two attempts",
						},
					}),
					now,
				);
				post();
			} else {
				visualAttempts++;
				visualAt = now;
				media?.invalidate();
			}
		}
	} catch (cause) {
		error = message(cause);
		errorAt = generation;
		post();
	}
}

function loop(): void {
	const live = session;
	if (!live) return;
	updateMedia(live);
	live
		.tick(previewNow())
		.then((drawn) => {
			if (drawn) post();
		})
		.catch((cause: unknown) => {
			error = message(cause);
			errorAt = generation;
			post();
		});
	if (live.wants_tick(previewNow())) scope.requestAnimationFrame(loop);
	else looping = false;
}

async function start(canvas: OffscreenCanvas): Promise<void> {
	try {
		// A variable, not a literal: the bundler must leave this import to the browser.
		// SAFETY: the module at MODULE_URL is crates/renderer-wasm's glue, whose exports `SessionModule` lists.
		const loaded = (await import(/* @vite-ignore */ MODULE_URL)) as SessionModule;
		await loaded.default();
		audioMedia = await createAudioMedia(loaded, decoders.open);
		deviceRecovery = createDeviceRecovery({
			retry: () => loaded.recover_device(),
			failed: (problem) => {
				loaded.fail_device(problem, previewNow());
				post();
			},
			changed: () => {
				media?.deviceReplaced();
				if (session) updateMedia(session);
				post();
				kick();
			},
			after: (ms, run) => {
				const id = setTimeout(run, ms);
				return () => clearTimeout(id);
			},
		});
		await loaded.init(canvas, () => {
			post();
			queue = queue.then(async () => {
				await audioMedia?.reset();
			});
			deviceRecovery?.start();
			kick();
		});
		session = loaded;
		media = createVisualMedia(loaded, decoders.open, kick, (path, problem) => {
			error = `${path}: ${problem}`;
			visualProblem = error;
			errorAt = generation;
			post();
		});
		// Later clips must not need a network request after source readiness.
		await media.prepare();
		// Debug: `loseDevice()` from the worker's console exercises recovery (D6).
		scope.loseDevice = () => loaded.lose_device();
		post();
	} catch (cause) {
		post({ status: "failed", message: message(cause) });
	}
}

/** Paused and ready: decode the first audio block at the playhead so Play starts from PCM (D2). */
function warmAudio(live: SessionModule): void {
	if (!audioMedia) return;
	// SAFETY: the WASM session emits the complete PreviewState shape.
	const report = JSON.parse(live.state(previewNow())) as PreviewState;
	const paused = report.status === "paused" || report.status === "ready";
	if (!storyboard || !report.mediaReady || !paused) {
		audioMedia.discardWarm();
		return;
	}
	try {
		// A failed warm costs nothing but the head start: Play decodes the block and reports errors.
		void audioMedia
			.warm(
				storyboard.json,
				storyboard.fps,
				storyboard.durationFrames,
				storyboard.media ?? [],
				report.position,
			)
			.catch(() => {});
	} catch {
		audioMedia.discardWarm();
	}
}

async function handle(request: PreviewRequest, live: SessionModule): Promise<void> {
	const now = previewNow();
	switch (request.type) {
		case "init":
			return;
		case "storyboard":
			live.set_storyboard_context(
				request.json,
				request.fps,
				request.durationFrames,
				JSON.stringify({ generation: request.generation, revision: request.readiness.revision }),
				now,
			);
			generation = request.generation;
			storyboard = request;
			visualWaiting = false;
			visualProblem = undefined;
			await audioMedia?.reset();
			live.media_dispatch(
				JSON.stringify({ type: "readiness", generation, readiness: request.readiness }),
				now,
			);
			fps = request.fps;
			media?.setSources(request.media ?? []);
			warmAudio(live);
			return;
		case "seek":
			media?.invalidate();
			visualAttempts = 0;
			visualAt = now;
			live.seek(request.frame / fps, now);
			await audioMedia?.reset();
			warmAudio(live);
			return;
		case "play":
			media?.invalidate();
			live.play(request.position, request.at, request.rate);
			visualWaiting = false;
			return;
		case "pause":
			visualWaiting = false;
			live.pause(request.position);
			await audioMedia?.reset();
			warmAudio(live);
			return;
		case "remotion":
			return live.report_remotion(request.position, request.at);
		case "resize":
			return live.resize(request.width, request.height);
		case "media-readiness":
			live.media_dispatch(
				JSON.stringify({ type: "readiness", generation, readiness: request.readiness }),
				now,
			);
			if (!request.readiness.ready) await audioMedia?.reset();
			warmAudio(live);
			return;
		case "media-playback":
			live.media_dispatch(
				JSON.stringify({ type: "playback", generation, playback: request.playback }),
				now,
			);
			return;
		case "audio-play":
			live.media_dispatch(
				JSON.stringify({ type: "audio-play", generation, anchor: request.anchor, at: request.at }),
				now,
			);
			scope.postMessage({
				type: "audio-started",
				generation,
				outputGeneration: request.anchor.generation,
			});
			return;
		case "audio-position":
			live.media_dispatch(
				JSON.stringify({ type: "audio-position", generation, observation: request.observation }),
				now,
			);
			return;
		case "audio-stop":
			await audioMedia?.reset();
			live.media_dispatch(JSON.stringify({ type: "audio-stop", generation }), now);
			return;
		case "audio-configure": {
			if (!storyboard || !audioMedia) throw new Error("Audio storyboard is unavailable");
			// SAFETY: the loaded WASM session emits the complete PreviewState shape.
			const report = JSON.parse(live.state(now)) as PreviewState;
			if (!report.mediaReady) throw new Error("Preview media is still loading");
			audioGeneration = request.outputGeneration;
			await audioMedia.configure(
				storyboard.json,
				storyboard.fps,
				storyboard.durationFrames,
				storyboard.media ?? [],
				request.position,
				request.rate,
				request.sampleRate,
			);
			scope.postMessage({ type: "audio-ready", generation, outputGeneration: audioGeneration });
			return;
		}
		case "audio-pull":
			if (request.outputGeneration !== audioGeneration || !audioMedia) return;
			// Decode must not block Pause, source invalidation, or decoder/budget replies.
			void audioMedia.pull(request.availableFrames).then(
				(block) => {
					scope.postMessage(
						{
							type: "audio-block",
							generation: request.generation,
							outputGeneration: request.outputGeneration,
							requestId: request.requestId,
							block,
						},
						block ? [block.pcm.buffer] : [],
					);
				},
				(cause: unknown) => {
					if (cause instanceof DOMException && cause.name === "AbortError") return;
					scope.postMessage({
						type: "audio-failed",
						generation: request.generation,
						outputGeneration: request.outputGeneration,
						message: message(cause),
					});
				},
			);
			return;
		case "pcm-reserve":
		case "pcm-release":
			return;
		case "source-release":
			// Removed bytes cannot be reborrowed by a later audio configure on the old input.
			if (storyboard)
				storyboard = {
					...storyboard,
					media: storyboard.media?.filter((source) => source.url !== request.url),
				};
			// SAFETY: the WASM session emits its accepted position as part of PreviewState.
			live.pause((JSON.parse(live.state(now)) as PreviewState).position);
			post();
			await audioMedia?.reset();
			warmAudio(live);
			await media?.releaseSource(request.url);
			scope.postMessage({ type: "source-released", requestId: request.requestId });
			return;
		case "decoder-grant":
		case "decoder-reject":
		case "decoder-yield":
		case "dispose":
			return;
	}
}

/* Requests run in order: those that arrive while the module loads wait for it. */
let queue = Promise.resolve();
scope.onmessage = (event) => {
	const parsed = previewRequestSchema.safeParse(event.data);
	if (!parsed.success) {
		error = "Invalid preview worker request";
		errorAt = previewRequestGeneration(event.data) ?? generation;
		post();
		return;
	}
	const data = parsed.data;
	if (decoders.handle(data)) return;
	if (data.type === "pcm-release") {
		audioMedia?.release(data.lease);
		audioMedia?.budget.release(data.lease);
		return;
	}
	if (data.type === "pcm-reserve") {
		try {
			if (!audioMedia) throw new Error("Audio mixer is unavailable");
			scope.postMessage({
				type: "pcm-reserved",
				requestId: data.requestId,
				lease: audioMedia.budget.reserve(data.bytes),
				message: null,
			});
		} catch (cause) {
			scope.postMessage({
				type: "pcm-reserved",
				requestId: data.requestId,
				lease: null,
				message: message(cause),
			});
		}
		return;
	}
	queue = queue.then(async () => {
		if (data.type === "init") {
			if (initialized) {
				error = "Preview worker is already initialized";
				errorAt = generation;
				post();
				return;
			}
			initialized = true;
			return start(data.canvas);
		}
		if (data.type === "dispose") {
			deviceRecovery?.dispose();
			await audioMedia?.dispose();
			await media?.dispose();
			media = null;
			session = null;
			scope.postMessage({ type: "disposed" });
			return;
		}
		if (data.type === "source-release" && !session) {
			scope.postMessage({ type: "source-released", requestId: data.requestId });
			return;
		}
		if (!session) return;
		if (
			"generation" in data &&
			(data.type === "storyboard" ? data.generation <= generation : data.generation !== generation)
		)
			return;
		const before = error;
		try {
			await handle(data, session);
			error = null;
			errorAt = undefined;
		} catch (cause) {
			// A refused request (a storyboard that does not parse) keeps the previous input.
			error = message(cause);
			errorAt = "generation" in data ? data.generation : generation;
			if (data.type === "audio-play")
				scope.postMessage({
					type: "audio-failed",
					generation: data.generation,
					outputGeneration: data.anchor.generation,
					message: error,
				});
			if (data.type === "audio-configure")
				scope.postMessage({
					type: "audio-failed",
					generation: data.generation,
					outputGeneration: data.outputGeneration,
					message: error,
				});
		}
		// Play and pause change the status without drawing; the rest report with their frame.
		if (
			[
				"play",
				"pause",
				"storyboard",
				"media-readiness",
				"media-playback",
				"audio-play",
				"audio-stop",
			].includes(data.type) ||
			error !== before
		)
			post();
		kick();
	});
};
