import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createVideoFrameClient } from "./video-client.ts";
import type { VideoLease } from "@models/timeline/preview-video-protocol.ts";
const workers: FakeWorker[] = [],
	clients: ReturnType<typeof createVideoFrameClient>[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	sent: Array<{ type: string }> = [];
	constructor(url: string) {
		expect(url).toBe("/preview-video-worker.js");
		workers.push(this);
	}
	postMessage(message: { type: string }) {
		this.sent.push(message);
		if (message.type === "init") queueMicrotask(() => this.metadata());
		if (message.type === "dispose") queueMicrotask(() => this.emit({ type: "disposed" }));
	}
	terminate = vi.fn();
	emit(message: unknown) {
		this.onmessage?.(new MessageEvent("message", { data: message }));
	}
	metadata() {
		this.emit({ type: "metadata", metadata: { width: 2, height: 2, slots: 1, firstTimestamp: 0 } });
	}
	frame(requestId: number, lease: number, time = 0, pixels: unknown = new Uint8Array(16)) {
		this.emit({
			type: "frame",
			requestId,
			lease,
			identity: {
				sourceId: "source",
				revision: "r1",
				width: 2,
				height: 2,
				start: Math.floor(time),
				end: Math.floor(time) + 1,
				presentation: [Math.floor(time), Math.floor(time) + 1],
			},
			pixels,
		});
	}
}
const source = {
	id: "source",
	revision: "r1",
	file: new File(["complete local bytes"], "video.mp4"),
	metadata: { width: 2, height: 2, slots: 1 as const, firstTimestamp: 0 },
};
const lease = (id: number, generation = 1, time = 0): VideoLease => ({
	id,
	bytes: 16,
	request: {
		consumer: "clip",
		sourceId: "source",
		revision: "r1",
		generation,
		sequence: id,
		time,
		width: 2,
		height: 2,
		kind: "video",
	},
});
function client(reserve: Parameters<typeof createVideoFrameClient>[1]["reserve"] = () => {}) {
	const value = createVideoFrameClient(source, { reserve });
	clients.push(value);
	return value;
}
beforeEach(() => {
	workers.length = 0;
	clients.length = 0;
	vi.stubGlobal("Worker", FakeWorker);
});
afterEach(async () => {
	await Promise.all(clients.map((client) => client.dispose()));
	vi.unstubAllGlobals();
});

test("sequential requests reuse their worker/codec grant and reserve RGBA before returning output", async () => {
	const reserve = vi.fn(),
		video = client(reserve);
	await video.metadata;
	const a = video.request(lease(1));
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 1 }),
		),
	);
	workers[0]!.emit({ type: "reserve", requestId: 1, width: 2, height: 2, bytes: 32 });
	await vi.waitFor(() => expect(reserve).toHaveBeenCalledExactlyOnceWith(lease(1), 2, 2, 32));
	expect(workers[0]!.sent).toContainEqual({ type: "reservation", requestId: 1, accepted: true });
	workers[0]!.frame(1, 1);
	expect(((await a).pixels as Uint8Array).byteLength).toBe(16);
	const b = video.request(lease(2, 1, 0.5));
	workers[0]!.frame(2, 2, 0.5);
	expect((await b).identity.start).toBe(0);
	expect(workers).toHaveLength(1);
	expect(workers[0]!.sent.filter((message) => message.type === "grant")).toHaveLength(1);
	expect(await source.file.text()).toBe("complete local bytes");
});

test("a yield arriving before its grant callback is honored after the first frame", async () => {
	const release = vi.fn(() => expect(workers[0]!.terminate).toHaveBeenCalledOnce());
	const video = createVideoFrameClient(source, {
		reserve: () => {},
		openDecoders: (onYield) => ({
			request: () => {
				onYield?.(42);
				return Promise.resolve(42);
			},
			release,
			close: vi.fn(),
		}),
	});
	clients.push(video);
	const pending = video.request(lease(1));
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(expect.objectContaining({ type: "frame" })),
	);
	workers[0]!.frame(1, 1);
	await expect(pending).resolves.toMatchObject({ lease: 1 });
	await vi.waitFor(() => expect(release).toHaveBeenCalledExactlyOnceWith(42));
});

test("100 rapid seeks keep only active plus latest and late replies cannot resolve the replacement", async () => {
	const video = client();
	await video.metadata;
	const results: Array<Promise<{ ok: boolean }>> = [];
	results.push(
		video.request(lease(1)).then(
			() => ({ ok: true }),
			() => ({ ok: false }),
		),
	);
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 1 }),
		),
	);
	for (let i = 2; i <= 100; i++)
		results.push(
			video.request(lease(i, i, (i % 10) / 10)).then(
				() => ({ ok: true }),
				() => ({ ok: false }),
			),
		);
	workers[0]!.emit({ type: "failed", requestId: 1, message: "cancelled", cancelled: true });
	workers[0]!.frame(1, 1);
	workers[0]!.frame(100, 100);
	const settled = await Promise.all(results);
	expect(settled.filter((result) => result.ok)).toHaveLength(1);
	expect(settled[99]?.ok).toBe(true);
	const frameMessages = workers[0]!.sent.filter((message) => message.type === "frame");
	expect(frameMessages).toHaveLength(2);
	await expect(video.request(lease(101, 1))).rejects.toMatchObject({ name: "AbortError" });
});

test("reservation rejection remains named and decoder disposal preserves borrowed source bytes", async () => {
	const video = client(() => {
		throw new Error("256 MiB visual budget exceeded");
	});
	await video.metadata;
	const pending = video.request(lease(1));
	const rejected = expect(pending).rejects.toThrow("256 MiB");
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(expect.objectContaining({ type: "frame" })),
	);
	workers[0]!.emit({ type: "reserve", requestId: 1, width: 2, height: 2, bytes: 32 });
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual({
			type: "reservation",
			requestId: 1,
			accepted: false,
			message: "256 MiB visual budget exceeded",
		}),
	);
	workers[0]!.emit({
		type: "failed",
		requestId: 1,
		message: "256 MiB visual budget exceeded",
		cancelled: false,
	});
	await rejected;
	await video.dispose();
	expect(workers[0]!.terminate).toHaveBeenCalledOnce();
	expect(await source.file.text()).toBe("complete local bytes");
});

test("worker construction failure rejects the request and returns its native decoder grant", async () => {
	vi.stubGlobal(
		"Worker",
		class {
			constructor() {
				throw new DOMException("Worker blocked", "SecurityError");
			}
		},
	);
	const failed = client();
	await expect(failed.request(lease(1))).rejects.toThrow("Worker blocked");
	vi.stubGlobal("Worker", FakeWorker);
	const next = client(),
		sibling = client(),
		pending = next.request(lease(1)),
		other = sibling.request(lease(2));
	await vi.waitFor(() => {
		expect(workers).toHaveLength(2);
		for (const worker of workers)
			expect(worker.sent).toContainEqual(expect.objectContaining({ type: "frame" }));
	});
	workers[0]!.frame(1, 1);
	workers[1]!.frame(1, 2);
	await expect(pending).resolves.toMatchObject({ lease: 1 });
	await expect(other).resolves.toMatchObject({ lease: 2 });
});

test("a transferred VideoFrame is returned when current and closed when stale or mis-sized", async () => {
	class FakeVideoFrame {
		close = vi.fn();
		constructor(
			readonly displayWidth = 2,
			readonly displayHeight = 2,
		) {}
	}
	vi.stubGlobal("VideoFrame", FakeVideoFrame);
	const video = client();
	await video.metadata;
	const first = video.request(lease(1));
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 1 }),
		),
	);
	const latest = video.request(lease(2, 2));
	const stale = new FakeVideoFrame();
	workers[0]!.frame(1, 1, 0, stale);
	await expect(first).rejects.toMatchObject({ name: "AbortError" });
	expect(stale.close).toHaveBeenCalledOnce();
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 2 }),
		),
	);
	const wrong = new FakeVideoFrame(4, 2);
	workers[0]!.frame(2, 2, 0, wrong);
	await expect(latest).rejects.toThrow("Decoded video does not match its lease");
	expect(wrong.close).toHaveBeenCalledOnce();
	const next = video.request(lease(3, 3));
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 3 }),
		),
	);
	const kept = new FakeVideoFrame();
	workers[0]!.frame(3, 3, 0, kept);
	expect((await next).pixels).toBe(kept);
	expect(kept.close).not.toHaveBeenCalled();
});

test("a placement and its prefetch share one decoder, earliest time first, and cancel spares the sibling", async () => {
	const video = client();
	await video.metadata;
	const as = (id: number, consumer: string, time: number): VideoLease => {
		const value = lease(id, 1, time);
		return { ...value, request: { ...value.request, consumer } };
	};
	const settle = (promise: Promise<unknown>) =>
		promise.then(
			() => "resolved",
			(error: unknown) => (error instanceof DOMException ? error.name : "failed"),
		);
	const frames = () => workers[0]!.sent.filter((message) => message.type === "frame");
	const ahead = settle(video.request(as(1, "prefetch:clip", 0.5)));
	await vi.waitFor(() => expect(frames()).toHaveLength(1));
	const later = settle(video.request(as(2, "prefetch:clip", 0.7)));
	const onScreen = video.request(as(3, "clip", 0.1));
	// The on-screen request is earlier than the busy prefetch, so the worker drops the prefetch.
	expect(workers[0]!.sent).toContainEqual({ type: "cancel" });
	workers[0]!.emit({ type: "failed", requestId: 1, message: "cancelled", cancelled: true });
	expect(await ahead).toBe("AbortError");
	await vi.waitFor(() => expect(frames()).toHaveLength(2));
	expect(frames()[1]).toMatchObject({ requestId: 3 });
	workers[0]!.frame(3, 3, 0.1);
	expect((await onScreen).lease).toBe(3);
	// The remaining prefetch is now busy; cancelling it asks the worker to stop, which it acknowledges.
	await vi.waitFor(() => expect(frames()).toHaveLength(3));
	video.cancel("prefetch:clip");
	expect(workers[0]!.sent.filter((message) => message.type === "cancel")).toHaveLength(2);
	workers[0]!.emit({ type: "failed", requestId: 2, message: "cancelled", cancelled: true });
	expect(await later).toBe("AbortError");
	expect(workers).toHaveLength(1);
	expect(workers[0]!.terminate).not.toHaveBeenCalled();
});

test("a reservation for a superseded request is refused as cancelled, not as a budget failure", async () => {
	let finish!: () => void;
	const reserve = vi.fn(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const video = client(reserve);
	await video.metadata;
	const first = video.request(lease(1)).catch((error: unknown) => error);
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual(
			expect.objectContaining({ type: "frame", requestId: 1 }),
		),
	);
	workers[0]!.emit({ type: "reserve", requestId: 1, width: 2, height: 2, bytes: 32 });
	await vi.waitFor(() => expect(reserve).toHaveBeenCalledOnce());
	const replacement = video.request(lease(2, 2));
	finish();
	await vi.waitFor(() =>
		expect(workers[0]!.sent).toContainEqual({
			type: "reservation",
			requestId: 1,
			accepted: false,
			cancelled: true,
		}),
	);
	workers[0]!.emit({
		type: "failed",
		requestId: 1,
		message: "Video request cancelled",
		cancelled: true,
	});
	expect(await first).toMatchObject({ name: "AbortError" });
	void replacement.catch(() => {});
});
