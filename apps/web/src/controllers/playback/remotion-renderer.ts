/* Remotion, spoken as a renderer adapter.
 *
 * This is the repository's own integration, and it is held to the same standard
 * a consumer's is: it is tested by the shipped conformance suite rather than by
 * a private test. A private test is free to assert what the adapter happens to
 * do; the suite asserts what the contract says, which is what a second
 * implementation has to satisfy.
 *
 * Remotion counts in whole frames and the contract counts in ticks, so every
 * crossing goes through the timebase. That conversion is the whole adapter, and
 * it is why the contract carries a timebase rather than seconds: converting
 * frames to seconds and back is where 29.97 stops round-tripping.
 */
import {
	framesToProject,
	projectTime,
	timeToFrames,
	type ProjectTime,
} from "@models/timeline-view/tick.ts";
import {
	RENDERER_CONTRACT_VERSION,
	type RendererAdapter,
	type RendererSnapshot,
} from "@controllers/playback/renderer-contract.ts";
import { type Timebase } from "@models/timeline-view/timebase.ts";

/**
 * An event as this adapter is willing to receive one.
 *
 * `detail` is `unknown` on purpose. Remotion's real `PlayerRef` declares a UNION
 * of payloads across every event it emits — a seek, a rate change, a scale
 * change — and several of them share no property with a frame update at all, so
 * any narrower declaration makes the real player fail to satisfy this interface.
 * The one field this adapter reads is checked where it is read, which is where
 * the check belongs anyway: the event arrives from outside the library.
 */
export interface RemotionPlayerEvent {
	readonly detail?: unknown;
}

/** The part of a Remotion player this adapter drives. */
export interface RemotionPlayerLike {
	addEventListener(name: string, listener: (event: RemotionPlayerEvent) => void): void;
	removeEventListener(name: string, listener: (event: RemotionPlayerEvent) => void): void;
	seekTo(frame: number): void;
	play(): void;
	pause(): void;
}

export interface RemotionRendererOptions {
	readonly widthPx: number;
	readonly heightPx: number;
	readonly durationInFrames: number;
	/** The project's timebase. Its frame rate must be the composition's. */
	readonly timebase: Timebase;
}

/** Clamp a frame into the composition, which is what the contract requires of a seek. */
export function clampFrameTo(frame: number, durationInFrames: number): number {
	return Math.max(0, Math.min(Math.max(0, durationInFrames - 1), Math.round(frame)));
}

export function createRemotionRenderer(
	player: RemotionPlayerLike,
	options: RemotionRendererOptions,
): RendererAdapter & { dispose(): void } {
	const { timebase } = options;
	const listeners = new Set<() => void>();
	let snapshot: RendererSnapshot = {
		widthPx: options.widthPx,
		heightPx: options.heightPx,
		duration: framesToProject(options.durationInFrames, timebase),
		timebase,
		/* Not ready until the player has reported a frame. A renderer that claimed
		 * readiness before it could seek would have the timeline issuing commands
		 * into nothing and reporting them as applied. */
		ready: false,
		currentTime: projectTime(0),
		playing: false,
	};

	function publish(next: RendererSnapshot): void {
		snapshot = next;
		for (const listener of [...listeners]) listener();
	}

	const onFrameUpdate = (event: RemotionPlayerEvent): void => {
		/* A frameupdate without a frame is not one. Ignoring it rather than
		 * clamping `undefined` to zero keeps a malformed event from seeking the
		 * player back to its start. */
		const detail = event.detail;
		if (typeof detail !== "object" || detail === null || !("frame" in detail)) return;
		/* SAFETY: the two checks above established that `detail` is a non-null
		 * object carrying a `frame` key. Reading it is all this does, and the
		 * value's type is checked on the next line rather than assumed. */
		const reported = (detail as { frame: unknown }).frame;
		if (typeof reported !== "number") return;
		const frame = clampFrameTo(reported, options.durationInFrames);
		publish({ ...snapshot, ready: true, currentTime: framesToProject(frame, timebase) });
	};
	const onPlay = (): void => publish({ ...snapshot, playing: true });
	const onPause = (): void => publish({ ...snapshot, playing: false });
	const onEnded = (): void => publish({ ...snapshot, playing: false });

	player.addEventListener("frameupdate", onFrameUpdate);
	player.addEventListener("play", onPlay);
	player.addEventListener("pause", onPause);
	player.addEventListener("ended", onEnded);

	let disposed = false;
	return {
		contractVersion: RENDERER_CONTRACT_VERSION,
		getSnapshot: () => snapshot,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		seek(to: ProjectTime) {
			if (disposed) return;
			const frame = clampFrameTo(timeToFrames(to, timebase).value, options.durationInFrames);
			player.seekTo(frame);
			/* Reported immediately as well as on the player's own event: Remotion
			 * reports a seek asynchronously, and a timeline that had to wait a frame
			 * for its own scrub to register would feel like it was lagging behind
			 * the pointer. The player's event confirms the same position later. */
			publish({ ...snapshot, ready: true, currentTime: framesToProject(frame, timebase) });
		},
		play() {
			if (!disposed) player.play();
		},
		pause() {
			if (!disposed) player.pause();
		},
		dispose() {
			disposed = true;
			player.removeEventListener("frameupdate", onFrameUpdate);
			player.removeEventListener("play", onPlay);
			player.removeEventListener("pause", onPause);
			player.removeEventListener("ended", onEnded);
			listeners.clear();
		},
	};
}
