import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { decodeLocalAudio } from "./audio-client.ts";
const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	sent: unknown[] = [];
	constructor() {
		workers.push(this);
	}
	postMessage(message: unknown) {
		this.sent.push(message);
	}
	terminate = vi.fn();
	emit(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
}
const request = {
	sourceId: "source",
	revision: "r1",
	file: new File(["complete"], "audio.wav"),
	start: 0,
	end: 0.1,
};
const metadata = {
	sourceId: "source",
	revision: "r1",
	sampleRate: 48000,
	channels: 1,
	firstTimestamp: 0,
	frames: 48000,
	start: 0,
	count: 4801,
};
const makeBudget = () => ({ reserve: vi.fn(() => 1n), release: vi.fn() });
beforeEach(() => {
	workers.length = 0;
	vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());

test("reserve before copying and release only after consumer drops PCM", async () => {
	const budget = makeBudget();
	const pending = decodeLocalAudio(request, budget);
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	const worker = workers[0]!;
	worker.emit({ type: "reserve", metadata });
	expect(budget.reserve).toHaveBeenCalledExactlyOnceWith(4801 * 4 * 3);
	expect(worker.sent).toContainEqual({ accepted: true });
	worker.emit({ type: "decoded", metadata, pcm: new Float32Array(4801) });
	const result = await pending;
	expect(worker.terminate).toHaveBeenCalledOnce();
	expect(budget.release).not.toHaveBeenCalled();
	result.release();
	result.release();
	expect(result.pcm.byteLength).toBe(0);
	expect(budget.release).toHaveBeenCalledExactlyOnceWith(1n);
	expect(request.file.size).toBe(8);
	expect(worker.sent[0]).toBe(request);
});

test("changed revision or dimensions reject output and release reservations after termination", async () => {
	for (const change of [{ revision: "r2" }, { count: 4800 }]) {
		const budget = makeBudget();
		const pending = decodeLocalAudio(request, budget);
		const rejected = expect(pending).rejects.toThrow();
		await vi.waitFor(() => expect(workers.at(-1)?.sent).toContainEqual(request));
		const worker = workers.at(-1)!;
		worker.emit({ type: "reserve", metadata });
		worker.emit({
			type: "decoded",
			metadata: { ...metadata, ...change },
			pcm: new Float32Array(4801),
		});
		await rejected;
		expect(worker.terminate).toHaveBeenCalledOnce();
		expect(budget.release).toHaveBeenCalledExactlyOnceWith(1n);
	}
});

test("abort and allocation errors close workers and return native decoder slots", async () => {
	const controller = new AbortController(),
		budget = makeBudget();
	const pending = decodeLocalAudio(request, budget, { signal: controller.signal });
	const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	workers[0]!.emit({ type: "reserve", metadata });
	controller.abort();
	await rejected;
	expect(workers[0]!.terminate).toHaveBeenCalledOnce();
	expect(budget.release).toHaveBeenCalledOnce();
	const denied = makeBudget();
	denied.reserve.mockImplementation(() => {
		throw new Error("16 MiB PCM budget exceeded");
	});
	const next = decodeLocalAudio(request, denied),
		failed = expect(next).rejects.toThrow("16 MiB");
	await vi.waitFor(() => expect(workers).toHaveLength(2));
	workers[1]!.emit({ type: "reserve", metadata });
	await failed;
	expect(workers[1]!.terminate).toHaveBeenCalledOnce();
	expect(denied.release).not.toHaveBeenCalled();
});

test("invalid intervals and already-aborted jobs allocate no worker", async () => {
	await expect(decodeLocalAudio({ ...request, end: 3 }, makeBudget())).rejects.toThrow();
	const controller = new AbortController();
	controller.abort();
	await expect(
		decodeLocalAudio(request, makeBudget(), { signal: controller.signal }),
	).rejects.toMatchObject({ name: "AbortError" });
	expect(workers).toHaveLength(0);
});
