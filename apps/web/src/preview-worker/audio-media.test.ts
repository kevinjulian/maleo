import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createAudioMedia, type AudioMediaHost } from "./audio-media.ts";
import type { PreviewMediaBinding } from "@models/timeline/preview-protocol.ts";
import type { openDecoderLeases } from "@services/preview-media/decoder-leases.ts";

const RATE = 48000;
const windows: Array<{ start: number; end: number; revision: string }> = [];
/** Decodes any window at once: a mono 48 kHz source whose sample n holds n. */
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	private request: { sourceId: string; revision: string; start: number; end: number } | undefined;
	private metadata: Record<string, unknown> | undefined;
	postMessage(message: Record<string, unknown>) {
		if ("accepted" in message) {
			const metadata = this.metadata!;
			const pcm = Float32Array.from(
				{ length: Number(metadata.count) },
				(_, i) => Number(metadata.start) + i,
			);
			queueMicrotask(() => this.emit({ type: "decoded", metadata, pcm }));
			return;
		}
		const request = message as typeof this.request & object;
		this.request = request;
		windows.push({ start: request.start, end: request.end, revision: request.revision });
		const start = Math.floor(request.start * RATE),
			end = Math.ceil(request.end * RATE) + 1;
		this.metadata = {
			sourceId: request.sourceId,
			revision: request.revision,
			sampleRate: RATE,
			channels: 1,
			firstTimestamp: 0,
			frames: RATE * 10,
			start,
			count: end - start,
		};
		queueMicrotask(() => this.emit({ type: "reserve", metadata: this.metadata }));
	}
	terminate() {}
	private emit(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
}
class Budget {
	static live = new Map<bigint, number>();
	private next = 0n;
	reserve(bytes: number) {
		const lease = ++this.next;
		Budget.live.set(lease, bytes);
		return lease;
	}
	release(lease: bigint) {
		Budget.live.delete(lease);
	}
	used() {
		return [...Budget.live.values()].reduce((sum, bytes) => sum + bytes, 0);
	}
	free() {}
}
const mixed: Float32Array[] = [];
const native: AudioMediaHost = {
	PcmBudget: Budget,
	project_audio: () => JSON.stringify({ sources: [{ path: "a", url: "u", embedded: false }] }),
	audio_requests: (_mix, _metadata, sampleRate, start, frames) =>
		JSON.stringify([
			{ path: "a", url: "u", start: start / sampleRate, end: (start + frames) / sampleRate },
		]),
	mix_audio: (_mix, _inputs, samples, _rate, _channels, _start, frames) => {
		mixed.push(samples.slice());
		return new Float32Array(frames * 2);
	},
};
const broker = (() => {
	let next = 0;
	return {
		request: () => Promise.resolve(++next),
		release() {},
		close() {},
	};
}) as unknown as typeof openDecoderLeases;
const binding = (revision = "r1") =>
	({
		id: "source",
		revision,
		url: "u",
		file: new File(["complete"], "a.wav"),
		audio: { sampleRate: RATE, channels: 1, firstTimestamp: 0, frames: RATE * 10 },
	}) as unknown as PreviewMediaBinding;
const used = () => [...Budget.live.values()].reduce((sum, bytes) => sum + bytes, 0);
beforeEach(() => {
	windows.length = 0;
	mixed.length = 0;
	Budget.live.clear();
	vi.stubGlobal("Worker", FakeWorker);
	vi.stubGlobal("fetch", async () => new Response("worker"));
	vi.stubGlobal(
		"URL",
		Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL() {} }),
	);
});
afterEach(() => vi.unstubAllGlobals());

test("a warm block at the paused playhead serves Play without a new decode, inside the budget", async () => {
	const media = await createAudioMedia(native, broker);
	await media.warm("{}", 30, 300, [binding()], 2);
	expect(windows).toHaveLength(1);
	const warmBytes = used();
	expect(warmBytes).toBeGreaterThan(0);
	await media.configure("{}", 30, 300, [binding()], 2, 1, RATE);
	const block = await media.pull(RATE * 2);
	expect(block).not.toBeNull();
	// The first feed came from the warm window: no second decode, and the samples are exact.
	expect(windows).toHaveLength(1);
	expect(mixed[0]![0]).toBe(2 * RATE);
	expect(mixed[0]!.at(-1)).toBe(2 * RATE + mixed[0]!.length - 1);
	media.release(block!.lease);
	await media.reset();
	// The warm window returned its reservation after the first feed.
	expect(used()).toBe(0);
	await media.dispose();
});

test("a seek or a source change discards the warm block", async () => {
	const media = await createAudioMedia(native, broker);
	await media.warm("{}", 30, 300, [binding()], 2);
	const one = used();
	await media.warm("{}", 30, 300, [binding()], 5);
	// The seek replaced the block: the first block's PCM is released, not stacked.
	expect(used()).toBe(one);
	expect(windows.map((window) => window.start)).toEqual([
		expect.closeTo(1.98, 5),
		expect.closeTo(4.98, 5),
	]);
	// A new source revision cannot be served from the old revision's warm window.
	await media.configure("{}", 30, 300, [binding("r2")], 5, 1, RATE);
	const block = await media.pull(RATE * 2);
	expect(windows).toHaveLength(3);
	expect(windows[2]!.revision).toBe("r2");
	media.release(block!.lease);
	await media.reset();
	expect(used()).toBe(0);
	await media.warm("{}", 30, 300, [binding("r2")], 1);
	media.discardWarm();
	expect(used()).toBe(0);
	await media.dispose();
});
