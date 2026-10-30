import { afterEach, expect, test, vi } from "vite-plus/test";
interface Processor {
	port: {
		onmessage: ((event: MessageEvent<unknown>) => void) | null;
		postMessage: ReturnType<typeof vi.fn>;
	};
	process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean;
}
afterEach(() => vi.unstubAllGlobals());
test("worklet advances only consumed PCM, holds underrun position and flushes obsolete generations", async () => {
	let Constructor: (new () => Processor) | undefined;
	vi.stubGlobal("sampleRate", 48000);
	vi.stubGlobal("currentFrame", 0);
	vi.stubGlobal(
		"AudioWorkletProcessor",
		class {
			port = { onmessage: null, postMessage: vi.fn() };
		},
	);
	vi.stubGlobal("registerProcessor", (_name: string, processor: new () => Processor) => {
		Constructor = processor;
	});
	await import("./audio-worklet.ts");
	if (!Constructor) throw Error("Audio worklet was not registered");
	const processor = new Constructor(),
		send = (data: unknown) => processor.port.onmessage?.(new MessageEvent("message", { data }));
	const left = new Float32Array(128),
		right = new Float32Array(128),
		render = () => processor.process([], [[left, right]]);
	send({ type: "block", id: 1, generation: 0, pcm: new Float32Array([0.25, -0.25, 0.5, -0.5]) });
	render();
	expect(left.every((value) => value === 0)).toBe(true);
	send({ type: "play", generation: 0 });
	render();
	expect(Array.from(left.slice(0, 4))).toEqual([0.25, 0.5, 0, 0]);
	expect(Array.from(right.slice(0, 4))).toEqual([-0.25, -0.5, 0, 0]);
	expect(processor.port.postMessage).toHaveBeenCalledWith({
		type: "position",
		generation: 0,
		frames: 2,
		renderFrame: 2,
		state: "buffering",
	});
	processor.port.postMessage.mockClear();
	render();
	expect(processor.port.postMessage).not.toHaveBeenCalled();
	send({ type: "block", id: 2, generation: 0, pcm: new Float32Array(512).fill(0.75) });
	send({ type: "flush", generation: 1 });
	expect(processor.port.postMessage).toHaveBeenCalledWith({
		type: "flushed",
		generation: 1,
		ids: [2],
	});
	send({ type: "block", id: 3, generation: 0, pcm: new Float32Array(128).fill(0.9) });
	expect(processor.port.postMessage).toHaveBeenCalledWith({ type: "released", ids: [3] });
	send({ type: "block", id: 4, generation: 1, pcm: new Float32Array(256) });
	send({ type: "play", generation: 1 });
	render();
	expect(left.every((value) => value === 0)).toBe(true);
	expect(processor.port.postMessage).toHaveBeenCalledWith({
		type: "position",
		generation: 1,
		frames: 128,
		renderFrame: 128,
		state: "playing",
	});
	send({ type: "block", id: 5, generation: 1, pcm: new Float32Array(96001 * 2) });
	expect(processor.port.postMessage).toHaveBeenCalledWith({
		type: "failed",
		message: "Invalid or oversized audio output block",
	});
	expect(render()).toBe(false);
	expect(left.every((value) => value === 0)).toBe(true);
});
test("steady playback reports position once per four quanta and on state change", async () => {
	vi.resetModules();
	let Constructor: (new () => Processor) | undefined;
	vi.stubGlobal("sampleRate", 48000);
	vi.stubGlobal("currentFrame", 0);
	vi.stubGlobal(
		"AudioWorkletProcessor",
		class {
			port = { onmessage: null, postMessage: vi.fn() };
		},
	);
	vi.stubGlobal("registerProcessor", (_name: string, processor: new () => Processor) => {
		Constructor = processor;
	});
	await import("./audio-worklet.ts");
	if (!Constructor) throw Error("Audio worklet was not registered");
	const processor = new Constructor(),
		send = (data: unknown) => processor.port.onmessage?.(new MessageEvent("message", { data }));
	const render = () => processor.process([], [[new Float32Array(128), new Float32Array(128)]]);
	const positions = () =>
		processor.port.postMessage.mock.calls.filter(([message]) => message.type === "position");
	send({ type: "block", id: 1, generation: 0, pcm: new Float32Array(128 * 9 * 2) });
	send({ type: "play", generation: 0 });
	render();
	expect(positions()).toHaveLength(1);
	for (let quantum = 0; quantum < 7; quantum++) render();
	expect(positions()).toHaveLength(2);
	render();
	render();
	expect(positions().at(-1)?.[0]).toMatchObject({ state: "buffering", frames: 128 * 9 });
});
