/* Compare mode's Rust preview (OpenSpec p2-render-foundation D8,
 * p2-preview-runtime D7).
 *
 * With `?renderer=compare`, this checks for a WebGPU adapter, starts the
 * preview worker from `/renderer/` (`app/renderer-routes.ts`), transfers the
 * panel's canvas to it, and drives the engine's preview session there from the
 * Remotion Player: a paused seek seeks the session, a play plays it from the
 * same position on its own clock, a pause pauses it, and while playing the
 * Remotion position goes over about four times a second so the session can
 * report drift. The worker draws and decodes local image/video Files. The main
 * thread routes shared native decoder grants; frame decoding stays in workers.
 * Without the parameter it does nothing at all, and neither
 * the worker nor the module is requested. No pixels are compared here; the
 * golden corpus does that. */
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from "react";
import type { PlayerRef } from "@remotion/player";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import {
	createPreviewClient,
	type PreviewClient,
	type PreviewWorkerLike,
} from "@models/timeline/preview-client.ts";
import type { PreviewState, PreviewReadiness } from "@models/timeline/preview-protocol.ts";
import { storyboardImageUrls, storyboardMediaUrls } from "@models/timeline/rust-compare.ts";
import { previewNow } from "@models/timeline/preview-protocol.ts";
import { createCompareMediaBridge } from "@services/preview-media/compare-bridge.ts";
import {
	createCompareAudio,
	type CompareAudioState,
} from "@services/preview-media/compare-audio.ts";
import { usePlayheadEffect } from "./use-playhead.ts";

/** What the hook needs from the Remotion Player. */
export interface PlayerSignals {
	frame: () => number;
	playing: () => boolean;
	muted: () => boolean;
	setMuted: (muted: boolean) => void;
	play: (event?: SyntheticEvent) => void;
	/** Returns the unsubscribe. */
	subscribe: (handlers: {
		play: () => void;
		pause: () => void;
		seeked: (frame: number) => void;
		rate: (rate: number) => void;
		mute: (muted: boolean) => void;
	}) => () => void;
}

/** The signals of the Player behind `ref`, read when the hook subscribes. */
export function playerSignals(ref: { current: PlayerRef | null }): PlayerSignals {
	return {
		frame: () => ref.current?.getCurrentFrame() ?? 0,
		playing: () => ref.current?.isPlaying() ?? false,
		muted: () => ref.current?.isMuted() ?? false,
		setMuted: (muted) => {
			if (muted) ref.current?.mute();
			else ref.current?.unmute();
		},
		play: (event) => ref.current?.play(event),
		subscribe: (handlers) => {
			const player = ref.current;
			if (!player) return () => {};
			const play = (): void => handlers.play();
			const pause = (): void => handlers.pause();
			const seeked = (event: { detail: { frame: number } }): void =>
				handlers.seeked(event.detail.frame);
			const rate = (event: { detail: { playbackRate: number } }): void =>
				handlers.rate(event.detail.playbackRate);
			const mute = (event: { detail: { isMuted: boolean } }): void =>
				handlers.mute(event.detail.isMuted);
			player.addEventListener("play", play);
			player.addEventListener("pause", pause);
			player.addEventListener("seeked", seeked);
			player.addEventListener("ratechange", rate);
			player.addEventListener("mutechange", mute);
			return () => {
				player.removeEventListener("play", play);
				player.removeEventListener("pause", pause);
				player.removeEventListener("seeked", seeked);
				player.removeEventListener("ratechange", rate);
				player.removeEventListener("mutechange", mute);
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
	prepareAudio?: typeof createCompareAudio;
}

export type RustCompareState =
	| { status: "off" }
	| { status: "loading" }
	| { status: "unavailable" }
	| { status: "error"; message: string }
	| { status: "ready"; preview: PreviewState };

export type RustCompareResult = RustCompareState & {
	audio?: {
		owner: "reference" | "rust";
		state: CompareAudioState;
		busy: boolean;
		select(owner: "reference" | "rust"): void;
		retry(event?: SyntheticEvent): void;
	};
};

const WORKER_URL = "/renderer/preview-worker.js";
/** How often the Remotion position goes to the session while playing. */
const REMOTION_REPORT_MS = 250;

export const BROWSER_ENV: RustCompareEnv = {
	prepareAudio: createCompareAudio,
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
	readiness: PreviewReadiness;
	playhead: PlayheadHandle;
	player: PlayerSignals;
	fps: number;
	durationFrames: number;
	width: number;
	height: number;
	playbackRate?: number;
	env?: RustCompareEnv;
}): RustCompareResult {
	const { enabled, canvas, storyboard, playhead, player, fps, durationFrames, width, height } =
		args;
	const env = args.env ?? BROWSER_ENV;
	const [state, setState] = useState<RustCompareState>({ status: enabled ? "loading" : "off" });
	const [client, setClient] = useState<PreviewClient | null>(null);
	const [media, setMedia] = useState<ReturnType<typeof createCompareMediaBridge> | null>(null);
	const [audio, setAudio] = useState<Awaited<ReturnType<typeof createCompareAudio>> | null>(null);
	const audioRef = useRef<typeof audio>(null);
	const [audioState, setAudioState] = useState<CompareAudioState>({ status: "paused" });
	const [owner, setOwner] = useState<"reference" | "rust">("reference");
	const ownerRef = useRef(owner);
	const originalMute = useRef<boolean | undefined>(undefined);
	const rateRef = useRef(args.playbackRate ?? 1);
	const previewRef = useRef<PreviewState | undefined>(undefined);
	const [audioBusy, setAudioBusy] = useState(false);
	const switching = useRef(false);
	const restoreReference = useCallback(() => {
		ownerRef.current = "reference";
		setOwner("reference");
		if (originalMute.current !== undefined) player.setMuted(originalMute.current);
		originalMute.current = undefined;
	}, [player]);
	const json = useMemo(() => JSON.stringify(storyboard), [storyboard]);
	const images = useMemo(() => storyboardImageUrls(storyboard), [storyboard]);
	const mediaUrls = useMemo(() => storyboardMediaUrls(storyboard), [storyboard]);

	useEffect(() => {
		if (!enabled || !canvas) return;
		let live = true;
		let broken = false;
		let started: PreviewClient | null = null;
		let prepared: typeof audio = null;
		let preparing: Promise<NonNullable<typeof audio>> | undefined;
		void (async () => {
			try {
				if (!(await env.hasAdapter())) {
					if (live) setState({ status: "unavailable" });
					return;
				}
				if (!live) return;
				const worker = env.createWorker();
				const failed = (message: string) => {
					if (broken) return;
					broken = true;
					worker.terminate();
					bridge.terminated();
					void prepared
						?.terminated()
						.catch((error) => console.error("Compare audio shutdown failed", error))
						.finally(restoreReference);
					if (live) setState({ status: "error", message });
				};
				const bridge = createCompareMediaBridge(worker, failed, async () => {
					await prepared?.deactivate();
				});
				worker.onerror = () => failed("Rust preview worker failed");
				started = createPreviewClient(
					worker,
					(preview) => {
						previewRef.current = preview;
						prepared?.observe(preview);
						if (live) setState(stateOf(preview));
						if (preview.status === "failed" && ownerRef.current === "rust") {
							ownerRef.current = "reference";
							setOwner("reference");
							void prepared
								?.deactivate()
								.catch((error) => console.error("Compare audio shutdown failed", error))
								.finally(restoreReference);
						}
					},
					failed,
					previewNow,
					(event) => {
						if (!prepared?.handle(event)) bridge.handle(event);
					},
					bridge.dispose,
				);
				started.init(canvas.transferControlToOffscreen());
				setClient(started);
				setMedia(bridge);
				if (env.prepareAudio) {
					preparing = env.prepareAudio(worker, started, (next) => {
						if (live) setAudioState(next);
					});
					prepared = await preparing;
					if (live && !broken) {
						audioRef.current = prepared;
						setAudio(prepared);
					}
				}
			} catch (error) {
				started?.dispose();
				if (live)
					setState({
						status: "error",
						message: error instanceof Error ? error.message : String(error),
					});
			}
		})();
		return () => {
			live = false;
			audioRef.current = null;
			void (async () => {
				try {
					const output = prepared ?? (await preparing);
					await output?.dispose();
				} finally {
					restoreReference();
					started?.dispose();
				}
			})().catch((error) => console.error("Compare preview cleanup failed", error));
		};
	}, [enabled, canvas, env, restoreReference]);

	useEffect(() => {
		client?.storyboard(
			json,
			fps,
			durationFrames,
			images,
			args.readiness,
			media?.bindings(mediaUrls),
		);
		client?.readiness(args.readiness);
	}, [client, media, json, fps, durationFrames, images, mediaUrls, args.readiness]);

	useEffect(() => {
		client?.resize(width, height);
	}, [client, width, height]);

	useEffect(() => {
		if (!client) return;
		const position = (): number => player.frame() / fps;
		client.seek(Math.round(playhead.get() * fps));
		if (player.playing()) client.play(position(), rateRef.current);
		const unsubscribe = player.subscribe({
			play: () => {
				if (ownerRef.current === "rust") audioRef.current?.start(position(), rateRef.current);
				else client.play(position(), rateRef.current);
			},
			pause: () => {
				if (ownerRef.current === "rust") void audioRef.current?.pause();
				else client.pause(position());
			},
			// A seek while playing re-anchors the session's clock; a paused one
			// arrives through the playhead.
			seeked: (frame) => {
				if (!player.playing()) return;
				if (ownerRef.current === "rust") audioRef.current?.seek(frame / fps, rateRef.current);
				else client.play(frame / fps, rateRef.current);
			},
			rate: (next) => {
				rateRef.current = next;
				if (ownerRef.current === "rust") audioRef.current?.rate(next);
				else if (player.playing()) client.play(position(), next);
			},
			mute: (muted) => {
				if (ownerRef.current === "rust" && !muted) player.setMuted(true);
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
		if (client && !player.playing()) {
			if (ownerRef.current === "rust") audioRef.current?.seek(sec, rateRef.current);
			else client.seek(Math.round(sec * fps));
		}
	});

	useEffect(() => {
		if (args.playbackRate === undefined || args.playbackRate === rateRef.current) return;
		rateRef.current = args.playbackRate;
		if (ownerRef.current === "rust") audioRef.current?.rate(args.playbackRate);
		else if (player.playing()) client?.play(player.frame() / fps, args.playbackRate);
	}, [args.playbackRate, client, player, fps]);

	const selectAudio = (next: "reference" | "rust") => {
		if (!audio || switching.current || ownerRef.current === next) return;
		switching.current = true;
		setAudioBusy(true);
		if (next === "rust") {
			originalMute.current = player.muted();
			ownerRef.current = "rust";
			setOwner("rust");
			player.setMuted(true);
			if (player.playing()) audio.start(player.frame() / fps, rateRef.current);
			switching.current = false;
			setAudioBusy(false);
		} else {
			ownerRef.current = "reference";
			setOwner("reference");
			void audio
				.deactivate()
				.catch((error) =>
					setAudioState({
						status: "failed",
						message: error instanceof Error ? error.message : "Audio shutdown failed",
					}),
				)
				.finally(() => {
					restoreReference();
					if (player.playing()) client?.play(player.frame() / fps, rateRef.current);
					switching.current = false;
					setAudioBusy(false);
				});
		}
	};

	if (!enabled) return { status: "off" };
	return audio
		? {
				...state,
				audio: {
					owner,
					state: audioState,
					busy: audioBusy,
					select: selectAudio,
					retry: (event) => {
						if (player.playing())
							audio.start(previewRef.current?.position ?? playhead.get(), rateRef.current);
						else player.play(event);
					},
				},
			}
		: state;
}
