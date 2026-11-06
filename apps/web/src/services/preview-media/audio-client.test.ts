import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createAudioSourceClient } from "./audio-client.ts";
import type { openDecoderLeases } from "./decoder-leases.ts";
const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	sent: Array<Record<string, unknown>> = [];
	terminated = false;
	constructor() {
		workers.push(this);
	}
	postMessage(message: Record<string, unknown>) {
		this.sent.push(message);
	}
	terminate = vi.fn(() => {
		this.terminated = true;
	});
	emit(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
	/** Reply to the newest window request with a reservation, then its PCM. */
	window(id = "source", revision = "r1") {
		const request = this.sent.filter((message) => "start" in message).at(-1)!;
		const metadata = {
			...meta,
			sourceId: id,
			revision,
			start: Math.round(Number(request.start) * 48000),
		};
		this.emit({ type: "reserve", metadata });
		this.emit({ type: "decoded", metadata, pcm: new Float32Array(meta.count) });
	}
}
const meta = {
	sourceId: "source",
	revision: "r1",
	sampleRate: 48000,
	channels: 1,
	firstTimestamp: 0,
	frames: 480000,
	start: 0,
	count: 12001,
};
const source = (id = "source") => ({
	id,
	revision: "r1",
	file: new File(["complete"], `${id}.wav`),
});
let reservations = 0n;
const makeBudget = () => {
	const live = new Set<bigint>();
	return {
		live,
		reserve: vi.fn(() => {
			const lease = ++reservations;
			live.add(lease);
			return lease;
		}),
		release: vi.fn((lease: bigint) => live.delete(lease)),
	};
};
/** Two audio slots. A waiting owner asks every holder to yield, like the Rust broker. */
function fakeBroker() {
	let next = 0;
	const holders = new Map<number, (lease: number) => void>();
	const waiting: Array<{ onYield: (lease: number) => void; grant: (lease: number) => void }> = [];
	const stats = { max: 0 };
	function deliver() {
		while (holders.size < 2 && waiting.length) {
			const { onYield, grant } = waiting.shift()!;
			const lease = ++next;
			holders.set(lease, onYield);
			stats.max = Math.max(stats.max, holders.size);
			grant(lease);
		}
		if (waiting.length) for (const [lease, onYield] of holders) onYield(lease);
	}
	const open = ((onYield: (lease: number) => void = () => {}) => {
		const own = new Set<number>();
		return {
			request: () =>
				new Promise<number>((resolve) => {
					waiting.push({
						onYield,
						grant: (lease) => {
							own.add(lease);
							resolve(lease);
						},
					});
					queueMicrotask(deliver);
				}),
			release(lease: number) {
				if (own.delete(lease)) holders.delete(lease);
				queueMicrotask(deliver);
			},
			close() {
				for (const lease of own) holders.delete(lease);
				own.clear();
			},
		};
	}) as unknown as typeof openDecoderLeases;
	return { open, stats, holders };
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
beforeEach(() => {
	workers.length = 0;
	vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

test("consecutive windows reuse one worker and one grant, and release PCM only after the consumer", async () => {
	const budget = makeBudget(),
		broker = fakeBroker();
	const client = createAudioSourceClient(source(), budget, { openDecoders: broker.open });
	const results = [];
	for (const start of [0, 0.25, 0.5]) {
		const pending = client.decode(start, start + 0.25);
		await vi.waitFor(() => expect(workers[0]?.sent.length).toBe(1 + results.length * 2));
		workers[0]!.window();
		results.push(await pending);
	}
	expect(workers).toHaveLength(1);
	expect(workers[0]!.terminate).not.toHaveBeenCalled();
	const requests = workers[0]!.sent.filter((message) => "start" in message);
	expect(requests.map((message) => message.start)).toEqual([0, 0.25, 0.5]);
	expect(budget.reserve).toHaveBeenCalledTimes(3);
	expect(budget.reserve).toHaveBeenCalledWith(12001 * 4 * 3);
	expect(budget.live.size).toBe(3);
	for (const result of results) {
		result.release();
		result.release();
		expect(result.pcm.byteLength).toBe(0);
	}
	expect(budget.live.size).toBe(0);
	client.dispose();
	expect(workers[0]!.terminate).toHaveBeenCalledOnce();
	expect(broker.holders.size).toBe(0);
});

test("three sources share two decoders: an idle holder yields after its window in flight", async () => {
	const broker = fakeBroker(),
		budget = makeBudget();
	const clients = ["a", "b", "c"].map((id) =>
		createAudioSourceClient(source(id), budget, { openDecoders: broker.open }),
	);
	const a = clients[0]!.decode(0, 0.25),
		b = clients[1]!.decode(0, 0.25);
	await vi.waitFor(() => expect(workers).toHaveLength(2));
	const c = clients[2]!.decode(0, 0.25);
	await flush();
	// Both holders are mid-window: the third source waits, and nothing is terminated yet.
	expect(workers).toHaveLength(2);
	expect(workers.some((worker) => worker.terminated)).toBe(false);
	workers[0]!.window("a");
	(await a).release();
	await vi.waitFor(() => expect(workers).toHaveLength(3));
	expect(workers[0]!.terminated).toBe(true);
	expect(workers[1]!.terminated).toBe(false);
	workers[1]!.window("b");
	workers[2]!.window("c");
	(await b).release();
	(await c).release();
	expect(broker.stats.max).toBe(2);
	for (const client of clients) client.dispose();
	expect(budget.live.size).toBe(0);
	expect(broker.holders.size).toBe(0);
});

test("abort releases reservations, keeps the held worker, and drops the late reply", async () => {
	const budget = makeBudget(),
		broker = fakeBroker();
	const client = createAudioSourceClient(source(), budget, { openDecoders: broker.open });
	const controller = new AbortController();
	const pending = client.decode(0, 0.25, controller.signal);
	const rejected = expect(pending).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	const worker = workers[0]!;
	worker.emit({ type: "reserve", metadata: meta });
	expect(budget.live.size).toBe(1);
	controller.abort();
	await rejected;
	expect(budget.live.size).toBe(0);
	worker.emit({ type: "decoded", metadata: meta, pcm: new Float32Array(meta.count) });
	expect(budget.live.size).toBe(0);
	// A window cancelled before its reservation is refused; the worker stays held.
	const second = new AbortController();
	const refused = client.decode(0.25, 0.5, second.signal);
	const secondRejected = expect(refused).rejects.toMatchObject({ name: "AbortError" });
	second.abort();
	await secondRejected;
	await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ start: 0.25 }));
	worker.emit({ type: "reserve", metadata: { ...meta, start: 12000 } });
	expect(worker.sent.at(-1)).toEqual({ accepted: false });
	worker.emit({ type: "failed", message: "PCM working set cannot fit the audio budget" });
	const next = client.decode(0.5, 0.75);
	await vi.waitFor(() => expect(worker.sent.at(-1)).toMatchObject({ start: 0.5 }));
	worker.window();
	(await next).release();
	expect(workers).toHaveLength(1);
	expect(worker.terminate).not.toHaveBeenCalled();
	client.dispose();
	expect(budget.live.size).toBe(0);
});

test("idle stop terminates the worker and returns its grant; the next window starts fresh", async () => {
	vi.useFakeTimers();
	const budget = makeBudget(),
		broker = fakeBroker();
	const client = createAudioSourceClient(source(), budget, {
		openDecoders: broker.open,
		idleMs: 2000,
	});
	const first = client.decode(0, 0.25);
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	workers[0]!.window();
	(await first).release();
	vi.advanceTimersByTime(1999);
	expect(workers[0]!.terminate).not.toHaveBeenCalled();
	vi.advanceTimersByTime(1);
	expect(workers[0]!.terminate).toHaveBeenCalledOnce();
	await vi.runAllTimersAsync();
	expect(broker.holders.size).toBe(0);
	const second = client.decode(0.25, 0.5);
	await vi.waitFor(() => expect(workers).toHaveLength(2));
	workers[1]!.window();
	(await second).release();
	client.dispose();
});

test("revision mismatch, worker failure and disposal reject without leaking PCM or grants", async () => {
	const budget = makeBudget(),
		broker = fakeBroker();
	const client = createAudioSourceClient(source(), budget, { openDecoders: broker.open });
	const mismatch = client.decode(0, 0.25);
	const rejected = expect(mismatch).rejects.toThrow("revision mismatch");
	await vi.waitFor(() => expect(workers).toHaveLength(1));
	workers[0]!.emit({ type: "reserve", metadata: meta });
	workers[0]!.emit({
		type: "decoded",
		metadata: { ...meta, revision: "r2" },
		pcm: new Float32Array(meta.count),
	});
	await rejected;
	expect(workers[0]!.terminate).toHaveBeenCalledOnce();
	expect(budget.live.size).toBe(0);
	const refused = client.decode(0, 0.25);
	const refusal = expect(refused).rejects.toThrow("Audio source revision mismatch");
	await vi.waitFor(() => expect(workers).toHaveLength(2));
	workers[1]!.emit({ type: "failed", message: "Audio source revision mismatch" });
	await refusal;
	const pending = client.decode(0, 0.25);
	const disposed = expect(pending).rejects.toMatchObject({ name: "AbortError" });
	await vi.waitFor(() => expect(workers).toHaveLength(3));
	workers[2]!.emit({ type: "reserve", metadata: meta });
	client.dispose();
	await disposed;
	expect(workers[2]!.terminate).toHaveBeenCalledOnce();
	expect(budget.live.size).toBe(0);
	await flush();
	expect(broker.holders.size).toBe(0);
	await expect(client.decode(0, 0.25)).rejects.toMatchObject({ name: "AbortError" });
	await expect(createAudioSourceClient(source(), budget).decode(0, 3)).rejects.toThrow(
		"Invalid audio window",
	);
});
