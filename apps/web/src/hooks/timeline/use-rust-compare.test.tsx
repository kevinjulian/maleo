// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { PreviewWorkerLike } from "@models/timeline/preview-client.ts";
import { EMPTY_PREVIEW_STATE, type PreviewRequest } from "@models/timeline/preview-protocol.ts";
import type { PlayerSignals, RustCompareEnv, RustCompareResult } from "./use-rust-compare.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRustCompare } = await import("./use-rust-compare.ts");

const storyboard = { scenes: [{ image: "/a.png" }] };
const READY = { revision: "fixture", sourceGeneration: 0, sequence: 0, ready: true, blockers: [] };
const OFFSCREEN = { offscreen: true };
// SAFETY: the hook calls only `transferControlToOffscreen` on the canvas.
const CANVAS = { transferControlToOffscreen: () => OFFSCREEN } as unknown as HTMLCanvasElement;

function fakePlayer() {
	let handlers: Parameters<PlayerSignals["subscribe"]>[0] | null = null;
	const player = { frame: 0, playing: false, muted: false };
	const signals: PlayerSignals = {
		frame: () => player.frame,
		playing: () => player.playing,
		muted: () => player.muted,
		setMuted: (muted) => {
			player.muted = muted;
			handlers?.mute(muted);
		},
		play: () => {
			player.playing = true;
			handlers?.play();
		},
		subscribe: (next) => {
			handlers = next;
			return () => {
				handlers = null;
			};
		},
	};
	return { player, signals, emit: () => handlers! };
}

function fakeEnv(adapter = true) {
	const sent: PreviewRequest[] = [];
	const worker: PreviewWorkerLike = {
		postMessage: (message) => {
			sent.push(message);
			if (message.type === "dispose")
				queueMicrotask(() =>
					worker.onmessage?.(new MessageEvent("message", { data: { type: "disposed" } })),
				);
		},
		onmessage: null,
		terminate: vi.fn(),
	};
	const timers: Array<() => void> = [];
	const env: RustCompareEnv = {
		hasAdapter: vi.fn(async () => adapter),
		createWorker: vi.fn(() => worker),
		every: (_ms, run) => {
			timers.push(run);
			return () => timers.splice(timers.indexOf(run), 1);
		},
	};
	return { env, worker, sent, timers };
}

let state: RustCompareResult | undefined;
const playhead = createPlayheadHandle(0);
let player = fakePlayer();
function Harness({ enabled, env }: { enabled: boolean; env: RustCompareEnv }) {
	state = useRustCompare({
		enabled,
		canvas: CANVAS,
		storyboard,
		readiness: READY,
		playhead,
		player: player.signals,
		fps: 30,
		durationFrames: 300,
		width: 1080,
		height: 1920,
		env,
	});
	return null;
}
let root: ReturnType<typeof createRoot> | undefined;

async function mount(enabled: boolean, env: RustCompareEnv): Promise<void> {
	root = createRoot(document.createElement("div"));
	await act(async () => root!.render(createElement(Harness, { enabled, env })));
}

afterEach(async () => {
	await act(async () => root?.unmount());
	playhead.set(0);
	player = fakePlayer();
});

describe("compare mode", () => {
	test("Rust selection mutes reference first and reference selection waits for output shutdown", async () => {
		const { env, sent } = fakeEnv();
		let close!: () => void;
		const sound = {
			start: vi.fn(),
			prepare: vi.fn(),
			seek: vi.fn(),
			rate: vi.fn(),
			pause: vi.fn(async () => {}),
			deactivate: vi.fn(
				() =>
					new Promise<void>((resolve) => {
						close = resolve;
					}),
			),
			observe: vi.fn(),
			handle: vi.fn(() => false),
			terminated: vi.fn(async () => {}),
			dispose: vi.fn(async () => {}),
		};
		env.prepareAudio = vi.fn(async () => sound);
		await mount(true, env);
		expect(state?.audio?.owner).toBe("reference");
		expect(sound.start).not.toHaveBeenCalled();
		player.player.playing = true;
		player.player.frame = 60;
		await act(async () => state?.audio?.select("rust"));
		expect(player.player.muted).toBe(true);
		expect(sound.start).toHaveBeenCalledWith(2, 1);
		await act(async () => player.signals.setMuted(false));
		expect(player.player.muted).toBe(true);
		await act(async () => player.emit().rate(2));
		expect(sound.rate).toHaveBeenCalledWith(2);
		await act(async () => state?.audio?.select("reference"));
		expect(player.player.muted).toBe(true);
		expect(sound.deactivate).toHaveBeenCalledOnce();
		await act(async () => close());
		expect(player.player.muted).toBe(false);
		expect(sent.at(-1)).toMatchObject({ type: "play", position: 2, rate: 2 });
	});

	test.each([false, true])(
		"unmount closes Rust audio before restoring original mute=%s",
		async (muted) => {
			const { env, worker } = fakeEnv();
			let close!: () => void;
			const sound = {
				start: vi.fn(),
				prepare: vi.fn(),
				seek: vi.fn(),
				rate: vi.fn(),
				pause: vi.fn(async () => {}),
				deactivate: vi.fn(async () => {}),
				observe: vi.fn(),
				handle: vi.fn(() => false),
				terminated: vi.fn(async () => {}),
				dispose: vi.fn(
					() =>
						new Promise<void>((resolve) => {
							close = resolve;
						}),
				),
			};
			env.prepareAudio = vi.fn(async () => sound);
			player.player.muted = muted;
			await mount(true, env);
			await act(async () => state?.audio?.select("rust"));
			expect(sound.start).not.toHaveBeenCalled();
			// Paused: the output opens its device ahead of Play, suspended.
			expect(sound.prepare).toHaveBeenCalled();
			await act(async () => {
				root?.unmount();
				root = undefined;
			});
			expect(player.player.muted).toBe(true);
			expect(worker.terminate).not.toHaveBeenCalled();
			await act(async () => close());
			await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
			expect(player.player.muted).toBe(muted);
		},
	);
	test("without the parameter nothing is checked or started", async () => {
		const { env } = fakeEnv();
		await mount(false, env);
		expect(state).toEqual({ status: "off" });
		expect(env.hasAdapter).not.toHaveBeenCalled();
		expect(env.createWorker).not.toHaveBeenCalled();
	});

	test("without a WebGPU adapter it says so and starts no worker", async () => {
		const { env } = fakeEnv(false);
		await mount(true, env);
		expect(state).toEqual({ status: "unavailable" });
		expect(env.createWorker).not.toHaveBeenCalled();
	});

	test("transfers the canvas, sends the storyboard once and seeks to the playhead", async () => {
		const { env, sent } = fakeEnv();
		playhead.set(4);
		await mount(true, env);
		expect(sent.filter((message) => message.type !== "media-readiness").slice(0, 3)).toEqual([
			{ type: "init", canvas: OFFSCREEN },
			{
				type: "storyboard",
				generation: 1,
				readiness: READY,
				json: JSON.stringify(storyboard),
				fps: 30,
				durationFrames: 300,
				images: ["/a.png"],
				media: [],
			},
			{ type: "resize", generation: 1, width: 1080, height: 1920 },
		]);
		expect(sent).toContainEqual({ type: "media-readiness", generation: 1, readiness: READY });
		expect(sent).toContainEqual({ type: "seek", generation: 1, frame: 120 });
		await act(async () => playhead.set(5));
		expect(sent.at(-1)).toEqual({ type: "seek", generation: 1, frame: 150 });
		expect(sent.filter((message) => message.type === "storyboard")).toHaveLength(1);
	});

	test("maps the Remotion Player's play, pause and playing seeks, and reports its position while playing", async () => {
		const { env, sent, timers } = fakeEnv();
		await mount(true, env);
		const before = sent.length;
		player.player.frame = 60;
		player.player.playing = true;
		await act(async () => player.emit().play());
		// Playback moves the playhead; that is not a seek.
		await act(async () => playhead.set(2.5));
		player.player.frame = 90;
		for (const run of timers) run();
		await act(async () => player.emit().seeked(240));
		player.player.frame = 250;
		player.player.playing = false;
		await act(async () => player.emit().pause());
		for (const run of timers) run();
		const messages = sent.slice(before).map(({ type, ...rest }) => ({
			type,
			...("position" in rest ? { position: rest.position } : {}),
		}));
		expect(messages).toEqual([
			{ type: "play", position: 2 },
			{ type: "remotion", position: 3 },
			{ type: "play", position: 8 },
			{ type: "pause", position: 250 / 30 },
		]);
	});

	test("shows the session's state and its failure", async () => {
		const { env, worker } = fakeEnv();
		await mount(true, env);
		expect(state).toEqual({ status: "loading" });
		const preview = {
			...EMPTY_PREVIEW_STATE,
			status: "paused",
			generation: 1,
			mediaReady: true,
			dropped: 2,
			drift: 0.4,
			coverage: [],
		};
		await act(async () =>
			worker.onmessage?.(
				new MessageEvent("message", {
					data: { type: "state", state: preview, requestGeneration: 1 },
				}),
			),
		);
		expect(state).toMatchObject({
			status: "ready",
			preview: { status: "paused", dropped: 2, drift: 0.4 },
		});
		await act(async () =>
			worker.onmessage?.(
				new MessageEvent("message", {
					data: {
						type: "state",
						requestGeneration: 1,
						state: {
							...EMPTY_PREVIEW_STATE,
							generation: 1,
							status: "failed",
							message: "no WebGPU device",
						},
					},
				}),
			),
		);
		expect(state).toEqual({ status: "error", message: "no WebGPU device" });
	});

	test("unmounting terminates the worker", async () => {
		const { env, worker } = fakeEnv();
		await mount(true, env);
		await act(async () => root?.unmount());
		root = undefined;
		expect(worker.terminate).toHaveBeenCalled();
	});
});
