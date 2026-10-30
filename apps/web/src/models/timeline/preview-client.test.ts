import { describe, expect, test, vi } from "vite-plus/test";
import { createPreviewClient, type PreviewWorkerLike } from "./preview-client.ts";
import { EMPTY_PREVIEW_STATE, type PreviewRequest, type PreviewState } from "./preview-protocol.ts";

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
	...EMPTY_PREVIEW_STATE,
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
const READY = { revision: "fixture", sourceGeneration: 0, sequence: 0, ready: true, blockers: [] };

describe("preview client", () => {
	test("readiness revisions invalidate the input even when the render JSON is unchanged", () => {
		const { worker, messages } = fakeWorker(),
			client = createPreviewClient(worker, vi.fn(), vi.fn());
		client.storyboard('{"scenes":[]}', 30, 30, [], READY);
		client.storyboard('{"scenes":[]}', 30, 30, [], {
			...READY,
			revision: "new-source",
			ready: false,
		});
		expect(
			messages()
				.filter((message) => message.type === "storyboard")
				.map((message) => message.generation),
		).toEqual([1, 2]);
		client.play(0, 1);
		expect(messages().at(-1)).toMatchObject({ type: "play", generation: 2 });
	});
	test("obsolete replies cannot replace current state and a refused input restores accepted command generation", () => {
		const { worker, messages } = fakeWorker(),
			changed = vi.fn(),
			client = createPreviewClient(worker, changed, vi.fn());
		const report = (requestGeneration: number, generation: number, error: string | null = null) =>
			worker.onmessage?.(
				new MessageEvent("message", {
					data: { type: "state", requestGeneration, state: { ...STATE, generation, error } },
				}),
			);
		client.storyboard('{"scenes":[]}', 30, 30, [], READY);
		client.storyboard('{"scenes":[1]}', 30, 30, [], READY);
		report(1, 1, "Old refusal");
		expect(changed).not.toHaveBeenCalled();
		expect(client.generation).toBe(2);
		report(2, 1, "Invalid storyboard");
		expect(client.generation).toBe(1);
		expect(changed).toHaveBeenCalledOnce();
		client.pause(4);
		expect(messages().at(-1)).toEqual({ type: "pause", generation: 1, position: 4 });
		client.storyboard('{"scenes":[]}', 30, 30, [], READY);
		expect(client.generation).toBe(3);
		report(2, 1, "Late failure");
		expect(client.generation).toBe(3);
		expect(changed).toHaveBeenCalledOnce();
	});
	test("malformed state never replaces an accepted position", () => {
		const { worker } = fakeWorker(),
			changed = vi.fn(),
			error = vi.fn();
		createPreviewClient(worker, changed, error);
		for (const state of [
			{ ...STATE, position: NaN },
			{ ...STATE, frame: -1 },
			{ ...STATE, clockOwner: "unknown" },
			{ status: "playing" },
		])
			worker.onmessage?.(
				new MessageEvent("message", { data: { type: "state", requestGeneration: 0, state } }),
			);
		expect(changed).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledTimes(4);
	});
	test("maps seek, play, pause and the Remotion playhead to messages on the shared clock", () => {
		const { worker, messages } = fakeWorker();
		const client = createPreviewClient(worker, vi.fn(), vi.fn(), () => 1000);
		client.seek(120);
		client.play(4, 1);
		client.remotion(4.2);
		client.pause(5);
		client.resize(540, 960);
		expect(messages()).toEqual([
			{ type: "seek", generation: 0, frame: 120 },
			{ type: "play", generation: 0, position: 4, at: 1000, rate: 1 },
			{ type: "remotion", generation: 0, position: 4.2, at: 1000 },
			{ type: "pause", generation: 0, position: 5 },
			{ type: "resize", generation: 0, width: 540, height: 960 },
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
		client.storyboard('{"scenes":[]}', 30, 300, [], READY);
		client.storyboard('{"scenes":[]}', 30, 300, [], READY);
		client.seek(10);
		client.storyboard('{"scenes":[]}', 30, 300, [], READY);
		client.storyboard('{"scenes":[1]}', 30, 300, [], READY);
		client.storyboard('{"scenes":[1]}', 30, 330, [], READY);
		expect(messages().filter((message) => message.type === "storyboard")).toHaveLength(3);
	});

	test("parses state messages and reports anything else", () => {
		const { worker } = fakeWorker();
		const onState = vi.fn();
		const onError = vi.fn();
		createPreviewClient(worker, onState, onError);
		worker.onmessage?.(
			new MessageEvent("message", { data: { type: "state", state: STATE, requestGeneration: 0 } }),
		);
		worker.onmessage?.(
			new MessageEvent("message", {
				data: { type: "state", state: { status: "loading" }, requestGeneration: 0 },
			}),
		);
		worker.onmessage?.(new MessageEvent("message", { data: { type: "nonsense" } }));
		expect(onState).toHaveBeenNthCalledWith(1, STATE);
		expect(onState).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(expect.stringContaining("unexpected message"));
	});

	test("dispose stops listening and terminates the worker", () => {
		const { worker } = fakeWorker();
		createPreviewClient(worker, vi.fn(), vi.fn()).dispose();
		expect(worker.onmessage).toBeNull();
		expect(worker.terminate).toHaveBeenCalled();
	});

	test("routes validated media events separately and rejects malformed decoder leases", () => {
		const { worker } = fakeWorker();
		const onState = vi.fn(),
			onError = vi.fn(),
			onMedia = vi.fn();
		createPreviewClient(worker, onState, onError, () => 0, onMedia);
		const event = { type: "decoder-request", owner: 1, request: 1, kind: "video", slots: 2 };
		worker.onmessage?.(new MessageEvent("message", { data: event }));
		expect(onMedia).toHaveBeenCalledExactlyOnceWith(event);
		expect(onState).not.toHaveBeenCalled();
		worker.onmessage?.(new MessageEvent("message", { data: { ...event, slots: 3 } }));
		expect(onMedia).toHaveBeenCalledTimes(1);
		expect(onError).toHaveBeenCalledWith(expect.stringContaining("unexpected message"));
	});

	test("disposal keeps media routing alive until codecs close, then terminates the worker", async () => {
		const { worker } = fakeWorker();
		let close!: () => void;
		const stopped = new Promise<void>((resolve) => {
			close = resolve;
		});
		const state = vi.fn(),
			media = vi.fn();
		const client = createPreviewClient(
			worker,
			state,
			vi.fn(),
			() => 0,
			media,
			() => stopped,
		);
		client.dispose();
		await Promise.resolve();
		expect(worker.terminate).not.toHaveBeenCalled();
		worker.onmessage?.(
			new MessageEvent("message", { data: { type: "state", state: STATE, requestGeneration: 0 } }),
		);
		worker.onmessage?.(new MessageEvent("message", { data: { type: "disposed" } }));
		expect(state).not.toHaveBeenCalled();
		expect(media).toHaveBeenCalledExactlyOnceWith({ type: "disposed" });
		close();
		await vi.waitFor(() => expect(worker.terminate).toHaveBeenCalledOnce());
	});
});
