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
} from "./preview-protocol.ts";

/** The part of a `Worker` the client uses. */
export interface PreviewWorkerLike {
	postMessage: (message: PreviewRequest, transfer: Transferable[]) => void;
	onmessage: ((event: MessageEvent) => void) | null;
	terminate: () => void;
}

export interface PreviewClient {
	init: (canvas: OffscreenCanvas) => void;
	/** Sends the storyboard, with the image URLs it draws, when it differs
	 *  from the last one sent. */
	storyboard: (json: string, fps: number, durationFrames: number, images: string[]) => void;
	seek: (frame: number) => void;
	play: (position: number, rate: number) => void;
	pause: (position: number) => void;
	/** The reference (Remotion) playhead now, for drift. */
	remotion: (position: number) => void;
	resize: (width: number, height: number) => void;
	dispose: () => void;
}

export function createPreviewClient(
	worker: PreviewWorkerLike,
	onState: (state: PreviewState) => void,
	onError: (message: string) => void,
	now: () => number = previewNow,
): PreviewClient {
	let sent: string | null = null;
	const post = (message: PreviewRequest, transfer: Transferable[] = []): void =>
		worker.postMessage(message, transfer);
	worker.onmessage = (event) => {
		try {
			onState(parsePreviewEvent(event.data).state);
		} catch (error) {
			onError(error instanceof Error ? error.message : String(error));
		}
	};
	return {
		init: (canvas) => post({ type: "init", canvas }, [canvas]),
		storyboard: (json, fps, durationFrames, images) => {
			const key = `${fps}:${durationFrames}:${json}`;
			if (key === sent) return;
			sent = key;
			post({ type: "storyboard", json, fps, durationFrames, images });
		},
		seek: (frame) => post({ type: "seek", frame }),
		play: (position, rate) => post({ type: "play", position, at: now(), rate }),
		pause: (position) => post({ type: "pause", position }),
		remotion: (position) => post({ type: "remotion", position, at: now() }),
		resize: (width, height) => post({ type: "resize", width, height }),
		dispose: () => {
			worker.onmessage = null;
			worker.terminate();
		},
	};
}
