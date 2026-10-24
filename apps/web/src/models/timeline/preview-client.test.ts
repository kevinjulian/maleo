import { describe, expect, test, vi } from "vite-plus/test";
import { createPreviewClient, type PreviewWorkerLike } from "./preview-client.ts";
import type { PreviewRequest, PreviewState } from "./preview-protocol.ts";

function fakeWorker() {
	const sent: Array<{ message: PreviewRequest; transfer?: Transferable[] }> = [];
	const worker: PreviewWorkerLike = {
		postMessage: (message, transfer) => void sent.push({ message, transfer }),
		onmessage: null,
		terminate: vi.fn(),
	};
	return { worker, sent, messages: () => sent.map((entry) => entry.message) };
}

const STATE: PreviewState = {
	status: "paused",
	message: null,
	position: 4,
	frame: 120,
	dropped: 3,
	times: { last: 20, p50: 18, p95: 25, count: 12 },
	drift: -0.5,
	coverage: [{ kind: "effect", path: "effects[0]", reason: "`flash` effect" }],
	error: null,
};

describe("preview client", () => {
	test("maps seek, play, pause and the Remotion playhead to messages on the shared clock", () => {
		const { worker, messages } = fakeWorker();
		const client = createPreviewClient(worker, vi.fn(), vi.fn(), () => 1000);
		client.seek(120);
		client.play(4, 1);
		client.remotion(4.2);
		client.pause(5);
		client.resize(540, 960);
		expect(messages()).toEqual([
			{ type: "seek", frame: 120 },
			{ type: "play", position: 4, at: 1000, rate: 1 },
			{ type: "remotion", position: 4.2, at: 1000 },
			{ type: "pause", position: 5 },
			{ type: "resize", width: 540, height: 960 },
		]);
	});

	test("transfers the canvas with init", () => {
		const { worker, sent } = fakeWorker();
		const canvas = {} as OffscreenCanvas;
		createPreviewClient(worker, vi.fn(), vi.fn()).init(canvas);
		expect(sent).toEqual([{ message: { type: "init", canvas }, transfer: [canvas] }]);
	});

	test("sends the storyboard only when it changes", () => {
		const { worker, messages } = fakeWorker();
		const client = createPreviewClient(worker, vi.fn(), vi.fn());
		client.storyboard('{"scenes":[]}', 30, 300, []);
		client.storyboard('{"scenes":[]}', 30, 300, []);
		client.seek(10);
		client.storyboard('{"scenes":[]}', 30, 300, []);
		client.storyboard('{"scenes":[1]}', 30, 300, []);
		client.storyboard('{"scenes":[1]}', 30, 330, []);
		expect(messages().filter((message) => message.type === "storyboard")).toHaveLength(3);
	});

	test("parses state messages and reports anything else", () => {
		const { worker } = fakeWorker();
		const onState = vi.fn();
		const onError = vi.fn();
		createPreviewClient(worker, onState, onError);
		worker.onmessage?.(new MessageEvent("message", { data: { type: "state", state: STATE } }));
		worker.onmessage?.(
			new MessageEvent("message", { data: { type: "state", state: { status: "loading" } } }),
		);
		worker.onmessage?.(new MessageEvent("message", { data: { type: "nonsense" } }));
		expect(onState).toHaveBeenNthCalledWith(1, STATE);
		expect(onState).toHaveBeenNthCalledWith(2, {
			status: "loading",
			message: null,
			position: 0,
			frame: 0,
			dropped: 0,
			times: null,
			drift: null,
			coverage: [],
			error: null,
		});
		expect(onError).toHaveBeenCalledWith(expect.stringContaining("unexpected message"));
	});

	test("dispose stops listening and terminates the worker", () => {
		const { worker } = fakeWorker();
		createPreviewClient(worker, vi.fn(), vi.fn()).dispose();
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).toHaveBeenCalled();
	});
});
