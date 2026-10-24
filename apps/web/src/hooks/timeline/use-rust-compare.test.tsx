// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { RendererModule, RustCompareEnv, RustCompareState } from "./use-rust-compare.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useRustCompare } = await import("./use-rust-compare.ts");

const storyboard = {
	scenes: [{ image: "/a.png" }],
	videoOverlays: [{ url: "/b.png", kind: "image" }],
};

function fakeEnv(adapter = true) {
	const frames: Array<() => void> = [];
	const module: RendererModule = {
		default: vi.fn(async () => undefined),
		init: vi.fn(async () => undefined),
		put_image: vi.fn(),
		render_to_canvas: vi.fn(() =>
			JSON.stringify([{ kind: "effect", path: "effects[0]", reason: "`flash` effect" }]),
		),
		work_done: vi.fn(async () => undefined),
	};
	let clock = 0;
	const env: RustCompareEnv = {
		loadModule: vi.fn(async () => module),
		hasAdapter: vi.fn(async () => adapter),
		decodeImage: vi.fn(async () => ({ width: 1, height: 1, rgba: new Uint8Array(4) })),
		requestFrame: (run) => void frames.push(run),
		now: () => (clock += 8),
	};
	/** Runs the scheduled animation frames, as the browser would, and settles. */
	const tick = async (): Promise<void> => {
		await act(async () => {
			for (const run of frames.splice(0)) run();
		});
	};
	return { env, module, frames, tick };
}

let state: RustCompareState | undefined;
const playhead = createPlayheadHandle(0);
function Harness({ enabled, env }: { enabled: boolean; env: RustCompareEnv }) {
	state = useRustCompare({
		enabled,
		canvas: CANVAS,
		storyboard,
		playhead,
		fps: 30,
		width: 1080,
		height: 1920,
		env,
	});
	return null;
}
const CANVAS = document.createElement("canvas");
let root: ReturnType<typeof createRoot> | undefined;

async function mount(enabled: boolean, env: RustCompareEnv): Promise<void> {
	root = createRoot(document.createElement("div"));
	await act(async () => root!.render(createElement(Harness, { enabled, env })));
}

afterEach(async () => {
	await act(async () => root?.unmount());
	playhead.set(0);
});

describe("compare mode", () => {
	test("without the parameter nothing is checked or imported", async () => {
		const { env } = fakeEnv();
		await mount(false, env);
		expect(state).toEqual({ status: "off" });
		expect(env.hasAdapter).not.toHaveBeenCalled();
		expect(env.loadModule).not.toHaveBeenCalled();
	});

	test("without a WebGPU adapter it says so and loads nothing", async () => {
		const { env } = fakeEnv(false);
		await mount(true, env);
		expect(state).toEqual({ status: "unavailable" });
		expect(env.loadModule).not.toHaveBeenCalled();
	});

	test("supplies every image, and rapid seeks draw once per animation frame at the latest frame", async () => {
		const { env, module, frames, tick } = fakeEnv();
		await mount(true, env);
		expect(module.init).toHaveBeenCalledWith(CANVAS);
		expect(module.put_image).toHaveBeenCalledTimes(2);
		await tick();
		const before = vi.mocked(module.render_to_canvas).mock.calls.length;
		await act(async () => {
			for (const sec of [1, 2, 3, 4]) playhead.set(sec);
		});
		expect(frames).toHaveLength(1);
		await tick();
		const calls = vi.mocked(module.render_to_canvas).mock.calls.slice(before);
		expect(calls).toHaveLength(1);
		expect(calls[0]!.slice(1)).toEqual([120, 1080, 1920]);
		expect(state).toMatchObject({
			status: "ready",
			coverage: [{ kind: "effect" }],
			times: { last: 8 },
		});
	});
});
