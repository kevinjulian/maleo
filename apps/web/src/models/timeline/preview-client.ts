/* The main thread's side of the preview worker protocol
 * (`preview-protocol.ts`, OpenSpec p2-preview-runtime D5). Typed messages in,
 * parsed state out, and the storyboard sent only when it changes: a frame
 * request never carries it. No React and no browser globals beyond the worker
 * handed in, so tests drive it with a fake. */
import {
	parsePreviewEvent,
	previewNow,
	type PreviewRequest,
	type PreviewState,
	type PreviewMediaEvent,
	type PreviewMediaBinding,
	type PreviewReadiness,
	type PreviewMediaPlayback,
	type PreviewAudioAnchor,
	type PreviewAudioObservation,
} from "./preview-protocol.ts";

/** The part of a `Worker` the client uses. */
export interface PreviewWorkerLike {
	postMessage: (message: PreviewRequest, transfer: Transferable[]) => void;
	onmessage: ((event: MessageEvent) => void) | null;
	onerror?: ((event: ErrorEvent) => void) | null;
	terminate: () => void;
}

export interface PreviewClient {
	init: (canvas: OffscreenCanvas) => void;
	/** Sends the storyboard, with the image URLs it draws, when it differs
	 *  from the last one sent. */
	storyboard: (
		json: string,
		fps: number,
		durationFrames: number,
		images: string[],
		readiness: PreviewReadiness,
		media?: PreviewMediaBinding[],
	) => void;
	seek: (frame: number) => void;
	play: (position: number, rate: number) => void;
	pause: (position: number) => void;
	/** The reference (Remotion) playhead now, for drift. */
	remotion: (position: number) => void;
	resize: (width: number, height: number) => void;
	readonly generation: number;
	readiness: (readiness: PreviewReadiness) => void;
	mediaPlayback: (playback: PreviewMediaPlayback) => void;
	audioPlay: (anchor: PreviewAudioAnchor) => void;
	audioPosition: (observation: PreviewAudioObservation) => void;
	audioStop: () => void;
	dispose: () => void;
}

export function createPreviewClient(
	worker: PreviewWorkerLike,
	onState: (state: PreviewState) => void,
	onError: (message: string) => void,
	now: () => number = previewNow,
	onMedia?: (event: PreviewMediaEvent) => void,
	disposeMedia?: () => Promise<void>,
): PreviewClient {
	let sent: string | null = null;
	let closing = false;
	let generation = 0,
		nextGeneration = 0;
	const post = (message: PreviewRequest, transfer: Transferable[] = []): boolean => {
		if (closing) return false;
		try {
			worker.postMessage(message, transfer);
			return true;
		} catch (error) {
			onError(error instanceof Error ? error.message : "Preview message failed");
			return false;
		}
	};
	worker.onmessage = (event) => {
		try {
			const parsed = parsePreviewEvent(event.data);
			if (parsed.type === "state") {
				if (
					!closing &&
					(parsed.requestGeneration === generation ||
						(parsed.state.generation === 0 && parsed.state.status === "failed"))
				) {
					if (parsed.state.error && parsed.state.generation !== generation) {
						generation = parsed.state.generation;
						sent = null;
					}
					onState(parsed.state);
				}
			} else if (onMedia) onMedia(parsed);
			else onError("Preview media bridge is unavailable");
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		}
	};
	return {
		init: (canvas) => {
			post({ type: "init", canvas }, [canvas]);
		},
		storyboard: (json, fps, durationFrames, images, readiness, media) => {
			const key = `${fps}:${durationFrames}:${readiness.revision}:${json}`;
			if (key === sent) return;
			const next = ++nextGeneration;
			if (
				post({
					type: "storyboard",
					generation: next,
					json,
					fps,
					durationFrames,
					images,
					readiness,
					...(media ? { media } : {}),
				})
			) {
				sent = key;
				generation = next;
			}
		},
		get generation() {
			return generation;
		},
		seek: (frame) => {
			post({ type: "seek", generation, frame });
		},
		play: (position, rate) => {
			post({ type: "play", generation, position, at: now(), rate });
		},
		pause: (position) => {
			post({ type: "pause", generation, position });
		},
		remotion: (position) => {
			post({ type: "remotion", generation, position, at: now() });
		},
		resize: (width, height) => {
			post({ type: "resize", generation, width, height });
		},
		readiness: (readiness) => {
			post({ type: "media-readiness", generation, readiness });
		},
		mediaPlayback: (playback) => {
			post({ type: "media-playback", generation, playback });
		},
		audioPlay: (anchor) => {
			post({ type: "audio-play", generation, anchor, at: now() });
		},
		audioPosition: (observation) => {
			post({ type: "audio-position", generation, observation });
		},
		audioStop: () => {
			post({ type: "audio-stop", generation });
		},
		dispose: () => {
			if (closing) return;
			closing = true;
			const finish = () => {
				worker.onmessage = null;
				worker.terminate();
			};
			if (!disposeMedia) {
				finish();
				return;
			}
			void Promise.resolve()
				.then(disposeMedia)
				.then(finish, (error: unknown) => {
					finish();
					onError(error instanceof Error ? error.message : "Preview media cleanup failed");
				});
		},
	};
}
