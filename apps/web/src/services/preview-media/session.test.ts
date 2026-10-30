import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createPreviewMediaSession, disposePreviewMediaSessions } from "./session.ts";
import type { PreviewMediaDependencies } from "@maleo/shared";
import { borrowLocalPreviewSource } from "./local-sources.ts";

const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror: (() => void) | null = null;
	loads: Array<{ id: string; revision: string; requestId: number }> = [];
	constructor() {
		workers.push(this);
	}
	postMessage(message: {
		type: string;
		source?: { id: string; revision: string; requestId: number };
	}) {
		if (message.type === "load" && message.source) this.loads.push(message.source);
		if (message.type === "dispose") queueMicrotask(() => this.emit({ type: "disposed" }));
	}
	emit(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
	terminate() {}
	complete(index: number) {
		this.emit({
			type: "complete",
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
			...this.loads[index],
			file: new File(["complete"], "source"),
		});
	}
}
const dependencies = (revision = "r1"): PreviewMediaDependencies => ({
	sources: [{ id: "one", revision, url: "/one.mp4", kinds: ["video"], clipIds: ["video:1"] }],
	clips: [{ id: "video:1", sourceIds: ["one"], blockers: [] }],
});
beforeEach(() => {
	workers.length = 0;
	vi.stubGlobal("Worker", FakeWorker);
	let next = 0;
	vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:preview-${++next}`);
	vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(async () => {
	await disposePreviewMediaSessions();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("Rust readiness releases replaced sources and ignores stale completions", async () => {
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.emit({ type: "progress", ...workers[0]!.loads[0], loaded: 2, total: 8 });
	expect(session.snapshot().sources.one).toEqual({ state: "loading", loaded: 2, total: 8 });
	expect(session.resolve("/one.mp4")).toBeUndefined();
	session.update(dependencies("r2"));
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(2));
	workers[0]!.complete(0);
	await Promise.resolve();
	expect(session.snapshot().ready).toBe(false);
	workers[0]!.complete(1);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	expect(session.resolve("/one.mp4")).toBe("blob:preview-1");
	session.update({ sources: [], clips: [] });
	expect(session.snapshot().ready).toBe(true);
	expect(session.resolve("/one.mp4")).toBeUndefined();
	expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:preview-1");
	await session.dispose();
});

test("adding dependencies and retrying failed sources preserve ready siblings", async () => {
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.complete(0);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	const expanded = dependencies();
	expanded.sources.push({
		id: "two",
		revision: "r1",
		url: "/two.mp4",
		kinds: ["video"],
		clipIds: ["video:2"],
	});
	expanded.clips.push({ id: "video:2", sourceIds: ["two"], blockers: [] });
	session.update(expanded);
	expect(session.resolve("/one.mp4")).toBe("blob:preview-1");
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(2));
	workers[0]!.emit({
		type: "failed",
		...workers[0]!.loads[1],
		bytesComplete: false,
		message: "Download failed",
	});
	await vi.waitFor(() => expect(session.snapshot().sources.two).toMatchObject({ state: "failed" }));
	session.retry("two");
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(3));
	workers[0]!.complete(1);
	expect(session.snapshot().ready).toBe(false);
	workers[0]!.complete(2);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	expect(session.resolve("/one.mp4")).toBe("blob:preview-1");
	await session.dispose();
	expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

test("lost local bytes invalidate ready state and Retry creates a fresh local source", async () => {
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.complete(0);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	session.invalidate("one", "Local source lost");
	expect(session.snapshot().ready).toBe(false);
	expect(session.resolve("/one.mp4")).toBeUndefined();
	session.retry("one");
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(2));
	workers[0]!.complete(0);
	expect(session.snapshot().ready).toBe(false);
	workers[0]!.complete(1);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	expect(session.resolve("/one.mp4")).toBe("blob:preview-2");
	await session.dispose();
});

test("normal playback stops before URL removal and sign-out closes readiness", async () => {
	const stop = vi.fn();
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
		stop,
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.complete(0);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	vi.mocked(URL.revokeObjectURL).mockImplementation(() => expect(stop).toHaveBeenCalled());
	session.invalidate("one", "Local file unavailable");
	expect(stop).toHaveBeenCalledOnce();
	await disposePreviewMediaSessions();
	expect(session.isOpen()).toBe(false);
	expect(stop).toHaveBeenCalledTimes(2);
});

test("source removal and sign-out wait for borrowed decoders before cancelling stored bytes", async () => {
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.complete(0);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	let finish!: () => void;
	const closed = new Promise<void>((resolve) => {
		finish = resolve;
	});
	const decoder = vi.fn(() => closed);
	const held = borrowLocalPreviewSource(session.resolve("/one.mp4")!, decoder);
	expect(held.source.video).toMatchObject({ width: 2, height: 2 });
	const messages = vi.spyOn(workers[0]!, "postMessage");
	session.update({ sources: [], clips: [] });
	expect(decoder).toHaveBeenCalledOnce();
	expect(session.resolve("/one.mp4")).toBeUndefined();
	const disposed = session.dispose();
	await Promise.resolve();
	expect(messages).not.toHaveBeenCalled();
	finish();
	await disposed;
	expect(messages.mock.calls.map(([message]) => message.type)).toEqual(["cancel", "dispose"]);
	expect(await held.source.file.text()).toBe("complete");
	held.release();
});
test("a failed consumer release still disposes the source worker", async () => {
	const session = createPreviewMediaSession({
		resolve: async (source) => ({ url: source.url, credentials: "omit" }),
		changed: () => {},
	});
	session.update(dependencies());
	await vi.waitFor(() => expect(workers[0]!.loads).toHaveLength(1));
	workers[0]!.complete(0);
	await vi.waitFor(() => expect(session.snapshot().ready).toBe(true));
	const errors = vi.spyOn(console, "error").mockImplementation(() => {});
	const held = borrowLocalPreviewSource(session.resolve("/one.mp4")!, async () => {
		throw new Error("codec stuck");
	});
	const messages = vi.spyOn(workers[0]!, "postMessage");
	await session.dispose();
	expect(messages.mock.calls.map(([message]) => message.type)).toContain("dispose");
	expect(errors).toHaveBeenCalledWith("Preview source consumer cleanup failed", expect.any(Error));
	held.release();
});
