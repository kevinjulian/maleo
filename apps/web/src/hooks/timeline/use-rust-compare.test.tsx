// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { PreviewWorkerLike } from "@models/timeline/preview-client.ts";
import type { PreviewRequest } from "@models/timeline/preview-protocol.ts";
import type { PlayerSignals, RustCompareEnv, RustCompareState } from "./use-rust-compare.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRustCompare } = await import("./use-rust-compare.ts");

const storyboard = { scenes: [{ image: "/a.png" }] };
const OFFSCREEN = { offscreen: true };
// SAFETY: the hook calls only `transferControlToOffscreen` on the canvas.
const CANVAS = { transferControlToOffscreen: () => OFFSCREEN } as unknown as HTMLCanvasElement;

function fakePlayer() {
	let handlers: Parameters<PlayerSignals["subscribe"]>[0] | null = null;
	const player = { frame: 0, playing: false };
	const signals: PlayerSignals = {
		frame: () => player.frame,
		playing: () => player.playing,
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
		postMessage: (message) => void sent.push(message),
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

let state: RustCompareState | undefined;
const playhead = createPlayheadHandle(0);
let player = fakePlayer();
function Harness({ enabled, env }: { enabled: boolean; env: RustCompareEnv }) {
	state = useRustCompare({
		enabled,
		canvas: CANVAS,
		storyboard,
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
		expect(sent.slice(0, 3)).toEqual([
			{ type: "init", canvas: OFFSCREEN },
			{
				type: "storyboard",
				json: JSON.stringify(storyboard),
				fps: 30,
				durationFrames: 300,
				images: ["/a.png"],
			},
			{ type: "resize", width: 1080, height: 1920 },
		]);
		expect(sent).toContainEqual({ type: "seek", frame: 120 });
		await act(async () => playhead.set(5));
		expect(sent.at(-1)).toEqual({ type: "seek", frame: 150 });
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
		const preview = { status: "paused", dropped: 2, drift: 0.4, coverage: [] };
		await act(async () =>
			worker.onmessage?.(new MessageEvent("message", { data: { type: "state", state: preview } })),
		);
		expect(state).toMatchObject({
			status: "ready",
			preview: { status: "paused", dropped: 2, drift: 0.4 },
		});
		await act(async () =>
			worker.onmessage?.(
				new MessageEvent("message", {
					data: { type: "state", state: { status: "failed", message: "no WebGPU device" } },
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
