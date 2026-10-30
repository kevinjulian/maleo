import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createPreviewSourceClient } from "./source-client.ts";

const svg = vi.hoisted(() => ({
	probe: vi.fn<(file: File, signal: AbortSignal) => Promise<void>>(),
}));
vi.mock("./svg-probe.ts", () => ({ probeSvgSource: svg.probe }));

const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	sent: unknown[] = [];
	terminate = vi.fn();
	constructor(url: string) {
		expect(url).toBe("/preview-media-worker.js");
		workers.push(this);
	}
	postMessage(message: unknown) {
		this.sent.push(message);
	}
	emit(message: unknown) {
		this.onmessage?.(new MessageEvent("message", { data: message }));
	}
}
beforeEach(() => {
	svg.probe.mockReset();
	workers.length = 0;
	vi.stubGlobal("Worker", FakeWorker);
});
afterEach(() => vi.unstubAllGlobals());
const source = {
	id: "stable",
	revision: "r1",
	url: "/api/media/stable",
	kinds: ["video" as const],
};
const target = { url: "https://storage.invalid/temporary-signature", credentials: "omit" as const };

test("complete SVG bytes stay unready until DOM decode and disposal aborts a pending probe", async () => {
	const client = createPreviewSourceClient({
		resolve: async () => target,
		progress: () => {},
		validating: () => {},
	});
	const image = { ...source, kinds: ["image" as const] };
	const file = new File(["<svg/>"], "source.svg", { type: "image/svg+xml" });
	let finish!: () => void;
	svg.probe.mockImplementationOnce(
		() =>
			new Promise<void>((resolve) => {
				finish = resolve;
			}),
	);
	const first = client.load(image);
	let settled = false;
	void first.then(() => {
		settled = true;
	});
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
	workers[0]!.emit({
		type: "svg-bytes",
		id: source.id,
		revision: source.revision,
		requestId: 1,
		file,
	});
	await Promise.resolve();
	expect(settled).toBe(false);
	finish();
	expect(await first).toBe(file);
	svg.probe.mockImplementationOnce(
		(_file, signal) =>
			new Promise<void>((_resolve, reject) => {
				signal.addEventListener("abort", () => reject(signal.reason), { once: true });
			}),
	);
	const second = client.load({ ...image, id: "second" });
	const rejected = expect(second).rejects.toThrow("disposed");
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(2));
	workers[0]!.emit({
		type: "svg-bytes",
		id: "second",
		revision: source.revision,
		requestId: 2,
		file,
	});
	const closed = client.dispose();
	workers[0]!.emit({ type: "disposed" });
	await rejected;
	await closed;
	expect(svg.probe.mock.calls[1]![1].aborted).toBe(true);
});

test.each(["svg-bytes", "complete"] as const)(
	"%s cannot bypass SVG image requirements",
	async (type) => {
		const client = createPreviewSourceClient({
			resolve: async () => target,
			progress: () => {},
			validating: () => {},
		});
		const pending = client.load(source);
		const rejected = expect(pending).rejects.toThrow(/SVG/);
		await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
		workers[0]!.emit({
			type,
			id: source.id,
			revision: source.revision,
			requestId: 1,
			file: new File(["<svg/>"], "source.svg", { type: "image/svg+xml" }),
			probe: { video: null, audio: null },
		});
		await rejected;
		expect(svg.probe).not.toHaveBeenCalled();
		const closed = client.dispose();
		workers[0]!.emit({ type: "disposed" });
		await closed;
	},
);

test("resolves credentials once and shares completed local files", async () => {
	const resolve = vi.fn(async () => target);
	const progress = vi.fn();
	const client = createPreviewSourceClient({ resolve, progress, validating: () => {} });
	const promise = client.load(source);
	expect(client.load(source)).toBe(promise);
	const worker = workers[0]!;
	await vi.waitFor(() => expect(worker.sent).toHaveLength(1));
	expect(resolve).toHaveBeenCalledExactlyOnceWith(source);
	expect(worker.sent[0]).toEqual({
		type: "load",
		source: { id: source.id, revision: source.revision, requestId: 1, target, kinds: source.kinds },
	});
	worker.emit({
		type: "progress",
		id: source.id,
		revision: source.revision,
		requestId: 1,
		loaded: 2,
		total: null,
	});
	expect(progress).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({ id: source.id, revision: source.revision }),
		{ loaded: 2, total: null },
	);
	const file = new File(["local bytes"], "source.mp4");
	worker.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 1,
		file,
	});
	expect(await promise).toBe(file);
	const disposed = client.dispose();
	worker.emit({ type: "disposed" });
	await disposed;
	expect(worker.terminate).toHaveBeenCalledOnce();
});

test("old completion cannot resolve or reject a replacement attempt", async () => {
	const client = createPreviewSourceClient({
		resolve: async () => target,
		progress: () => {},
		validating: () => {},
	});
	const first = client.load(source);
	const released = expect(first).rejects.toThrow("released");
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
	client.release(source);
	await released;
	const second = client.load(source);
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(3));
	workers[0]!.emit({
		type: "failed",
		id: source.id,
		revision: source.revision,
		requestId: 1,
		message: "obsolete failure",
		bytesComplete: false,
	});
	const file = new File(["new attempt"], "source.mp4");
	workers[0]!.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 2,
		file,
	});
	expect(await second).toBe(file);
	const disposed = client.dispose();
	workers[0]!.emit({ type: "disposed" });
	await disposed;
});

test("disposal rejects pending authorization and never sends its late target", async () => {
	let authorize!: (value: typeof target) => void;
	const client = createPreviewSourceClient({
		resolve: () =>
			new Promise((resolve) => {
				authorize = resolve;
			}),
		progress: () => {},
		validating: () => {},
	});
	const pending = client.load(source);
	const rejected = expect(pending).rejects.toThrow("disposed");
	const disposed = client.dispose();
	authorize(target);
	workers[0]!.emit({ type: "disposed" });
	await Promise.all([rejected, disposed]);
	expect(workers[0]!.sent).toEqual([{ type: "dispose" }]);
});

test("changed required tracks revalidate held bytes without another authorization or download target", async () => {
	const resolve = vi.fn(async () => target);
	const client = createPreviewSourceClient({ resolve, progress: () => {}, validating: () => {} });
	const first = client.load(source);
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
	const file = new File(["local bytes"], "source.mp4");
	workers[0]!.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 1,
		file,
	});
	await first;
	const combined = client.load({ ...source, kinds: ["audio", "video"] });
	const rejected = expect(combined).rejects.toThrow("no audio track");
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(2));
	workers[0]!.emit({
		type: "failed",
		id: source.id,
		revision: source.revision,
		requestId: 2,
		bytesComplete: true,
		message: "Audio source has no audio track",
	});
	await rejected;
	const restored = client.load(source);
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(3));
	workers[0]!.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 3,
		file,
	});
	expect(await restored).toBe(file);
	expect(resolve).toHaveBeenCalledOnce();
	for (const message of workers[0]!.sent) expect(message).toMatchObject({ type: "load" });
	const disposed = client.dispose();
	workers[0]!.emit({ type: "disposed" });
	await disposed;
});

test("pending File bypasses authorization and is borrowed without mutation", async () => {
	const resolve = vi.fn(async () => target);
	const client = createPreviewSourceClient({ resolve, progress: () => {}, validating: () => {} });
	const file = new File(["pending bytes"], "pending.mp4");
	const result = client.load(source, file);
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
	expect(resolve).not.toHaveBeenCalled();
	expect(workers[0]!.sent[0]).toEqual({
		type: "load",
		source: { id: source.id, revision: source.revision, requestId: 1, kinds: source.kinds, file },
	});
	workers[0]!.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 1,
		file,
	});
	expect(await result).toBe(file);
	client.release(source);
	expect(await file.text()).toBe("pending bytes");
	const disposed = client.dispose();
	workers[0]!.emit({ type: "disposed" });
	await disposed;
});

test("workers share a tab-wide compressed-byte quota and disposal returns reservations", async () => {
	const options = { resolve: async () => target, progress: () => {}, validating: () => {} };
	const first = createPreviewSourceClient(options),
		second = createPreviewSourceClient(options);
	workers[0]!.emit({ type: "reserve-memory", reservation: 0, bytes: 40 * 1024 * 1024 });
	workers[1]!.emit({ type: "reserve-memory", reservation: 0, bytes: 25 * 1024 * 1024 });
	expect(workers[0]!.sent).toContainEqual({
		type: "memory-result",
		reservation: 0,
		accepted: true,
	});
	expect(workers[1]!.sent).toContainEqual({
		type: "memory-result",
		reservation: 0,
		accepted: false,
	});
	const closed = first.dispose();
	workers[0]!.emit({ type: "disposed" });
	await closed;
	workers[1]!.emit({ type: "reserve-memory", reservation: 1, bytes: 25 * 1024 * 1024 });
	expect(workers[1]!.sent).toContainEqual({
		type: "memory-result",
		reservation: 1,
		accepted: true,
	});
	const other = second.dispose();
	workers[1]!.emit({ type: "disposed" });
	await other;
});

test("track requirements changing during authorization reuse its pending target", async () => {
	let authorize!: (value: typeof target) => void;
	const resolve = vi.fn(
		() =>
			new Promise<typeof target>((yes) => {
				authorize = yes;
			}),
	);
	const client = createPreviewSourceClient({ resolve, progress: () => {}, validating: () => {} });
	const first = client.load(source);
	const old = expect(first).rejects.toThrow("requirements changed");
	await vi.waitFor(() => expect(resolve).toHaveBeenCalledOnce());
	const next = client.load({ ...source, kinds: ["audio", "video"] });
	authorize(target);
	await old;
	await vi.waitFor(() => expect(workers[0]!.sent).toHaveLength(1));
	expect(resolve).toHaveBeenCalledOnce();
	const file = new File(["complete"], "source.mp4");
	workers[0]!.emit({
		type: "complete",
		probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		id: source.id,
		revision: source.revision,
		requestId: 2,
		file,
	});
	expect(await next).toBe(file);
	const disposed = client.dispose();
	workers[0]!.emit({ type: "disposed" });
	await disposed;
});
