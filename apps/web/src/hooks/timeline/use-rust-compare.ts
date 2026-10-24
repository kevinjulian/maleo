/* Compare mode's Rust preview (OpenSpec p2-render-foundation D8,
 * p2-preview-runtime D7).
 *
 * With `?renderer=compare`, this checks for a WebGPU adapter, starts the
 * preview worker from `/renderer/` (`app/renderer-routes.ts`), transfers the
 * panel's canvas to it, and drives the engine's preview session there from the
 * Remotion Player: a paused seek seeks the session, a play plays it from the
 * same position on its own clock, a pause pauses it, and while playing the
 * Remotion position goes over about four times a second so the session can
 * report drift. The worker draws, schedules and decodes images; nothing here
 * runs per frame. Without the parameter it does nothing at all, and neither
 * the worker nor the module is requested. No pixels are compared here; the
 * golden corpus does that. */
import { useEffect, useMemo, useState } from "react";
import type { PlayerRef } from "@remotion/player";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import {
	createPreviewClient,
	type PreviewClient,
	type PreviewWorkerLike,
} from "@models/timeline/preview-client.ts";
import type { PreviewState } from "@models/timeline/preview-protocol.ts";
import { storyboardImageUrls } from "@models/timeline/rust-compare.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

/** What the hook needs from the Remotion Player. */
export interface PlayerSignals {
	frame: () => number;
	playing: () => boolean;
	/** Returns the unsubscribe. */
	subscribe: (handlers: {
		play: () => void;
		pause: () => void;
		seeked: (frame: number) => void;
		rate: (rate: number) => void;
	}) => () => void;
}

/** The signals of the Player behind `ref`, read when the hook subscribes. */
export function playerSignals(ref: { current: PlayerRef | null }): PlayerSignals {
	return {
		frame: () => ref.current?.getCurrentFrame() ?? 0,
		playing: () => ref.current?.isPlaying() ?? false,
		subscribe: (handlers) => {
			const player = ref.current;
			if (!player) return () => {};
			const play = (): void => handlers.play();
			const pause = (): void => handlers.pause();
			const seeked = (event: { detail: { frame: number } }): void =>
				handlers.seeked(event.detail.frame);
			const rate = (event: { detail: { playbackRate: number } }): void =>
				handlers.rate(event.detail.playbackRate);
			player.addEventListener("play", play);
			player.addEventListener("pause", pause);
			player.addEventListener("seeked", seeked);
			player.addEventListener("ratechange", rate);
			return () => {
				player.removeEventListener("play", play);
				player.removeEventListener("pause", pause);
				player.removeEventListener("seeked", seeked);
				player.removeEventListener("ratechange", rate);
			};
		},
	};
}

/** What the hook reaches outside React for; tests pass fakes. */
export interface RustCompareEnv {
	hasAdapter: () => Promise<boolean>;
	createWorker: () => PreviewWorkerLike;
	/** Runs `run` every `ms`; returns the stop. */
	every: (ms: number, run: () => void) => () => void;
}

export type RustCompareState =
	| { status: "off" }
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "error"; message: string }
	| { status: "ready"; preview: PreviewState };

const WORKER_URL = "/renderer/preview-worker.js";
/** How often the Remotion position goes to the session while playing. */
const REMOTION_REPORT_MS = 250;

export const BROWSER_ENV: RustCompareEnv = {
	hasAdapter: async () => {
		// SAFETY: `navigator.gpu` is absent from this DOM lib; it is read as optional.
		const gpu = (navigator as Navigator & { gpu?: { requestAdapter: () => Promise<unknown> } }).gpu;
		return Boolean(await gpu?.requestAdapter());
	},
	createWorker: () => new Worker(WORKER_URL, { type: "module" }),
	every: (ms, run) => {
		const id = setInterval(run, ms);
		return () => clearInterval(id);
	},
};

function stateOf(preview: PreviewState): RustCompareState {
	return preview.status === "failed"
		? { status: "error", message: preview.message ?? "the preview session failed" }
		: { status: "ready", preview };
}

export function useRustCompare(args: {
	enabled: boolean;
	canvas: HTMLCanvasElement | null;
	storyboard: object;
	playhead: PlayheadHandle;
	player: PlayerSignals;
	fps: number;
	durationFrames: number;
	width: number;
	height: number;
	env?: RustCompareEnv;
}): RustCompareState {
	const { enabled, canvas, storyboard, playhead, player, fps, durationFrames, width, height } =
		args;
	const env = args.env ?? BROWSER_ENV;
	const [state, setState] = useState<RustCompareState>({ status: enabled ? "loading" : "off" });
	const [client, setClient] = useState<PreviewClient | null>(null);
	const json = useMemo(() => JSON.stringify(storyboard), [storyboard]);
	const images = useMemo(() => storyboardImageUrls(storyboard), [storyboard]);

	useEffect(() => {
		if (!enabled || !canvas) return;
		let live = true;
		let started: PreviewClient | null = null;
		void (async () => {
			try {
				if (!(await env.hasAdapter())) {
					if (live) setState({ status: "unavailable" });
					return;
				}
				if (!live) return;
				started = createPreviewClient(
					env.createWorker(),
					(preview) => setState(stateOf(preview)),
					(message) => setState({ status: "error", message }),
				);
				started.init(canvas.transferControlToOffscreen());
				setClient(started);
			} catch (error) {
				if (live)
					setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
			}
		})();
		return () => {
			live = false;
			started?.dispose();
		};
	}, [enabled, canvas, env]);

	useEffect(() => {
		client?.storyboard(json, fps, durationFrames, images);
	}, [client, json, fps, durationFrames, images]);

	useEffect(() => {
		client?.resize(width, height);
	}, [client, width, height]);

	useEffect(() => {
		if (!client) return;
		let rate = 1;
		const position = (): number => player.frame() / fps;
		client.seek(Math.round(playhead.get() * fps));
		if (player.playing()) client.play(position(), rate);
		const unsubscribe = player.subscribe({
			play: () => client.play(position(), rate),
			pause: () => client.pause(position()),
			// A seek while playing re-anchors the session's clock; a paused one
			// arrives through the playhead.
			seeked: (frame) => {
				if (player.playing()) client.play(frame / fps, rate);
			},
			rate: (next) => {
				rate = next;
				if (player.playing()) client.play(position(), rate);
			},
		});
		const stop = env.every(REMOTION_REPORT_MS, () => {
			if (player.playing()) client.remotion(position());
		});
		return () => {
			unsubscribe();
			stop();
		};
	}, [client, player, playhead, fps, env]);

	usePlayheadEffect(playhead, (sec) => {
		if (client && !player.playing()) client.seek(Math.round(sec * fps));
	});

	return enabled ? state : { status: "off" };
}
