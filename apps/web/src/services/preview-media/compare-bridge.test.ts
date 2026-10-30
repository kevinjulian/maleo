import { afterEach, expect, test, vi } from "vite-plus/test";
import { createCompareMediaBridge } from "./compare-bridge.ts";
import { registerLocalPreviewSource } from "./local-sources.ts";
import type { PreviewWorkerLike } from "@models/timeline/preview-client.ts";
import type { PreviewRequest } from "@models/timeline/preview-protocol.ts";

const live: ReturnType<typeof createCompareMediaBridge>[] = [];
const removeSources: Array<() => Promise<void>> = [];
function setup(beforeRelease?: () => Promise<void>) {
	const messages: PreviewRequest[] = [];
	const worker: PreviewWorkerLike = {
		onmessage: null,
		terminate: vi.fn(),
		postMessage: (message) => {
			messages.push(message);
		},
	};
	const error = vi.fn();
	const bridge = createCompareMediaBridge(worker, error, beforeRelease);
	live.push(bridge);
	return { bridge, worker, messages, error };
}
function source(url: string) {
	const file = new File(["complete"], "media");
	const remove = registerLocalPreviewSource(url, {
		id: "source",
		revision: "r1",
		file,
		video: null,
		audio: null,
	});
	removeSources.push(remove);
	return { file, remove };
}
afterEach(async () => {
	for (const bridge of live) bridge.terminated();
	await Promise.all(removeSources.map((remove) => remove()));
	live.length = removeSources.length = 0;
});

test("source cleanup waits for renderer acknowledgement before returning borrowed Files", async () => {
	const { bridge, messages } = setup();
	const { file, remove } = source("blob:compare-source");
	expect(bridge.bindings(["blob:compare-source", "/remote.mp4"])).toEqual([
		{ url: "blob:compare-source", id: "source", revision: "r1", file, video: null, audio: null },
	]);
	const removed = vi.fn();
	const pending = remove();
	void pending.then(removed);
	expect(messages).toEqual([{ type: "source-release", url: "blob:compare-source", requestId: 1 }]);
	await Promise.resolve();
	expect(removed).not.toHaveBeenCalled();
	bridge.handle({ type: "source-released", requestId: 1 });
	await pending;
	expect(await file.text()).toBe("complete");
	const stopped = bridge.dispose();
	expect(messages.at(-1)).toEqual({ type: "dispose" });
	bridge.handle({ type: "disposed" });
	await stopped;
});

test("source removal waits for audio shutdown before asking the worker to return its File", async () => {
	let silenced!: () => void;
	const { bridge, messages } = setup(
		() =>
			new Promise((resolve) => {
				silenced = resolve;
			}),
	);
	const { remove } = source("blob:audible-source");
	bridge.bindings(["blob:audible-source"]);
	const pending = remove();
	await Promise.resolve();
	expect(messages).toEqual([]);
	silenced();
	await vi.waitFor(() =>
		expect(messages).toContainEqual({
			type: "source-release",
			url: "blob:audible-source",
			requestId: 1,
		}),
	);
	bridge.handle({ type: "source-released", requestId: 1 });
	await pending;
});

test("logical worker owners route through the shared native broker", async () => {
	const { bridge, messages } = setup();
	bridge.handle({ type: "decoder-request", owner: 1, request: 1, kind: "video", slots: 2 });
	await vi.waitFor(() =>
		expect(messages).toContainEqual(expect.objectContaining({ type: "decoder-grant", owner: 1 })),
	);
	const first = messages.find((message) => message.type === "decoder-grant");
	if (!first || first.type !== "decoder-grant") throw new Error("First native grant missing");
	bridge.handle({ type: "decoder-request", owner: 2, request: 1, kind: "video", slots: 1 });
	await Promise.resolve();
	expect(messages.filter((message) => message.type === "decoder-grant")).toHaveLength(1);
	bridge.handle({ type: "decoder-return", owner: 1, lease: first.lease });
	await vi.waitFor(() =>
		expect(messages).toContainEqual(expect.objectContaining({ type: "decoder-grant", owner: 2 })),
	);
	bridge.handle({ type: "decoder-close", owner: 1 });
	bridge.handle({ type: "decoder-close", owner: 2 });
});

test("message failure terminates the renderer before releasing source and decoder ownership", async () => {
	const { bridge, worker, error } = setup();
	const { remove } = source("blob:broken-bridge");
	bridge.bindings(["blob:broken-bridge"]);
	worker.postMessage = () => {
		throw new Error("Worker unavailable");
	};
	await remove();
	expect(worker.terminate).toHaveBeenCalledOnce();
	expect(error).toHaveBeenCalledExactlyOnceWith("Worker unavailable");
	await bridge.dispose();
});
