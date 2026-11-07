import { describe, expect, test, vi } from "vite-plus/test";
import type { ExportRequest } from "@models/render/export-protocol.ts";
import {
	ExportCancelled,
	exportBitrate,
	startBrowserExport,
	type BrowserExportDeps,
	type ExportWorkerLike,
} from "./browser-export.ts";

const file = new File([new Uint8Array([1])], "a.mp4");
const source = { id: "s", revision: "r", file, video: null, audio: null };

function harness() {
	const sent: ExportRequest[] = [];
	const released: string[] = [];
	const revokers = new Map<string, () => Promise<void>>();
	const owner = { request: vi.fn(async () => 7), release: vi.fn(), close: vi.fn() };
	const worker: ExportWorkerLike = {
		postMessage: (message) => sent.push(message),
		terminate: vi.fn(),
		onmessage: null,
		onerror: null,
	};
	const deps: BrowserExportDeps = {
		createWorker: () => worker,
		// SAFETY: the test owner implements the members the client calls.
		openDecoders: (() => owner) as unknown as BrowserExportDeps["openDecoders"],
		borrow: (url, dispose) => {
			revokers.set(url, dispose);
			return { source, release: () => released.push(url) > 0 };
		},
	};
	const emit = (data: unknown) => worker.onmessage?.(new MessageEvent("message", { data }));
	return { sent, released, revokers, owner, worker, deps, emit };
}

const input = {
	storyboard: { scenes: [], videoOverlays: [{ url: "blob:local-a", kind: "video" }] },
	fps: 30,
	frames: 60,
	width: 320,
	height: 192,
	bitrate: 1_000_000,
};

describe("startBrowserExport", () => {
	test("starts the worker with the captured storyboard and borrowed local sources", async () => {
		const h = harness();
		const progress = vi.fn();
		const run = startBrowserExport({ ...input, onProgress: progress }, h.deps);
		const start = h.sent[0];
		expect(start?.type).toBe("start");
		if (start?.type !== "start") return;
		expect(JSON.parse(start.json)).toEqual(input.storyboard);
		expect(start.media).toEqual([{ url: "blob:local-a", ...source }]);
		h.emit({ type: "progress", phase: "rendering", frame: 3, frames: 60 });
		expect(progress).toHaveBeenCalledWith("rendering", 3, 60);
		const bytes = new Uint8Array([0, 0, 0, 1]).buffer;
		h.emit({ type: "done", bytes });
		const blob = await run.done;
		expect(blob.type).toBe("video/mp4");
		expect(blob.size).toBe(4);
		expect(h.released).toEqual(["blob:local-a"]);
		expect(h.worker.terminate).toHaveBeenCalled();
	});

	test("routes decoder requests to editor grants and closes owners at the end", async () => {
		const h = harness();
		const run = startBrowserExport(input, h.deps);
		h.emit({ type: "decoder-request", owner: 1, request: 2, kind: "video", slots: 1 });
		await vi.waitFor(() =>
			expect(h.sent).toContainEqual({ type: "decoder-grant", owner: 1, request: 2, lease: 7 }),
		);
		h.emit({ type: "decoder-return", owner: 1, lease: 7 });
		expect(h.owner.release).toHaveBeenCalledWith(7);
		h.emit({ type: "failed", message: "Frame 3 cannot be exported: missing media" });
		await expect(run.done).rejects.toThrow("Frame 3 cannot be exported");
		expect(h.owner.close).toHaveBeenCalled();
	});

	test("cancel asks the worker to stop and settles as cancelled", async () => {
		const h = harness();
		const run = startBrowserExport(input, h.deps);
		run.cancel();
		expect(h.sent.at(-1)).toEqual({ type: "cancel" });
		h.emit({ type: "cancelled" });
		await expect(run.done).rejects.toBeInstanceOf(ExportCancelled);
		expect(h.released).toEqual(["blob:local-a"]);
	});

	test("a source revoked by the preview ends the export", async () => {
		const h = harness();
		const run = startBrowserExport(input, h.deps);
		await h.revokers.get("blob:local-a")?.();
		await expect(run.done).rejects.toThrow("A media source changed during export");
		expect(h.worker.terminate).toHaveBeenCalled();
	});

	test("a missing local source fails before a worker starts", async () => {
		const h = harness();
		const create = vi.fn(h.deps.createWorker);
		const run = startBrowserExport(input, {
			...h.deps,
			createWorker: create,
			borrow: () => {
				throw new Error("Complete local preview source is unavailable");
			},
		});
		await expect(run.done).rejects.toThrow("Complete local preview source is unavailable");
		expect(create).not.toHaveBeenCalled();
	});

	test("an invalid worker message fails the export", async () => {
		const h = harness();
		const run = startBrowserExport(input, h.deps);
		h.emit({ type: "done" });
		await expect(run.done).rejects.toThrow("Invalid export worker message");
	});

	test("bitrate scales by pixel count from 8 Mbit/s at 1080p", () => {
		expect(exportBitrate(1920, 1080)).toBe(8_000_000);
		expect(exportBitrate(1080, 1920)).toBe(8_000_000);
		expect(exportBitrate(160, 90)).toBe(500_000);
	});
});
