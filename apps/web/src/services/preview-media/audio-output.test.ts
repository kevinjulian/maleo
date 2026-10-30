import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createAudioOutput } from "./audio-output.ts";
const contexts: FakeContext[] = [],
	nodes: FakeNode[] = [];
class FakeContext {
	state = "running";
	sampleRate = 48000;
	currentTime = 0;
	baseLatency = 0.01;
	outputLatency = 0.02;
	destination = {};
	onstatechange: (() => void) | null = null;
	audioWorklet = { addModule: vi.fn(async () => {}) };
	constructor() {
		contexts.push(this);
	}
	resume = vi.fn(async () => {
		this.state = "running";
	});
	close = vi.fn(async () => {
		this.state = "closed";
	});
	getOutputTimestamp() {
		return { contextTime: 0, performanceTime: 0 };
	}
}
class FakeNode {
	port = {
		onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
		postMessage: vi.fn(),
		close: vi.fn(),
	};
	onprocessorerror: (() => void) | null = null;
	connect = vi.fn();
	disconnect = vi.fn();
	constructor() {
		nodes.push(this);
	}
	emit(data: unknown) {
		this.port.onmessage?.(new MessageEvent("message", { data }));
	}
}
beforeEach(() => {
	contexts.length = nodes.length = 0;
	vi.stubGlobal("AudioContext", FakeContext);
	vi.stubGlobal("AudioWorkletNode", FakeNode);
});
afterEach(() => vi.unstubAllGlobals());
const budget = () => ({ reserve: vi.fn(() => 1n as bigint | Promise<bigint>), release: vi.fn() });

test("activation failure closes its context before any worklet allocation", async () => {
	vi.spyOn(FakeContext.prototype, "getOutputTimestamp");
	class Rejected extends FakeContext {
		override resume = vi.fn(async () => {
			throw new DOMException("Gesture rejected", "NotAllowedError");
		});
	}
	vi.stubGlobal("AudioContext", Rejected);
	await expect(createAudioOutput({ budget: budget(), change: () => {} })).rejects.toMatchObject({
		name: "NotAllowedError",
	});
	expect(contexts[0]!.close).toHaveBeenCalledOnce();
	expect(nodes).toHaveLength(0);
});
test("two-second output limit and seek acknowledgements preserve byte ownership", async () => {
	const account = budget(),
		output = await createAudioOutput({ budget: account, change: () => {} }),
		node = nodes[0]!;
	expect(await output.push(new Float32Array(96000 * 2), 0)).toBe(true);
	expect(await output.push(new Float32Array(2), 0)).toBe(false);
	expect(output.queuedFrames).toBe(96000);
	const flushed = output.flush();
	expect(output.generation).toBe(1);
	expect(account.release).not.toHaveBeenCalled();
	node.emit({ type: "flushed", generation: 1, ids: [1] });
	await flushed;
	expect(account.release).toHaveBeenCalledExactlyOnceWith(1n);
	expect(await output.push(new Float32Array(2), 0)).toBe(false);
	node.emit({ type: "position", generation: 0, frames: 900, renderFrame: 900, state: "playing" });
	expect(output.snapshot.frames).toBe(0);
	await output.dispose();
	expect(output.snapshot.state).toBe("closed");
});
test("disposal waits for an asynchronous reservation and rejects obsolete transfer", async () => {
	const account = budget();
	let grant: ((lease: bigint) => void) | undefined;
	account.reserve.mockImplementation(
		() =>
			new Promise<bigint>((resolve) => {
				grant = resolve;
			}),
	);
	const output = await createAudioOutput({ budget: account, change: () => {} });
	const pcm = new Float32Array(256),
		pending = output.push(pcm, 0),
		closed = output.dispose();
	grant?.(7n);
	expect(await pending).toBe(false);
	await closed;
	expect(pcm.byteLength).toBe(1024);
	expect(account.release).toHaveBeenCalledExactlyOnceWith(7n);
	expect(nodes[0]!.port.postMessage).not.toHaveBeenCalledWith(
		expect.objectContaining({ type: "block" }),
	);
});
test("suspension invalidates old sound and processor failures retain their named reason", async () => {
	const output = await createAudioOutput({ budget: budget(), change: () => {} }),
		node = nodes[0]!,
		context = contexts[0]!;
	context.state = "suspended";
	context.onstatechange?.();
	expect(output.generation).toBe(1);
	expect(output.snapshot.state).toBe("suspended");
	expect(() => output.play()).toThrow("suspended");
	node.emit({ type: "flushed", generation: 1, ids: [] });
	node.emit({ type: "failed", message: "Output device failed" });
	await output.dispose();
	expect(output.snapshot).toMatchObject({ state: "failed", error: "Output device failed" });
});

test("timestamp reports the platform pair or explicit missing values without guessing device delay", async () => {
	const output = await createAudioOutput({ budget: budget(), change: () => {} }),
		context = contexts[0]!;
	context.currentTime = 1;
	context.getOutputTimestamp = () => ({ contextTime: 0.97, performanceTime: performance.now() });
	expect(output.timestamp()).toMatchObject({
		contextTime: 1,
		output: { contextTime: 0.97 },
		baseLatency: 0.01,
		outputLatency: 0.02,
	});
	context.getOutputTimestamp = () => ({ contextTime: 0, performanceTime: 0 });
	expect(output.timestamp().output).toBeNull();
	Object.defineProperty(context, "getOutputTimestamp", { value: undefined });
	context.outputLatency = NaN;
	expect(output.timestamp()).toMatchObject({ output: null, outputLatency: null });
	await output.dispose();
});
