// @vitest-environment happy-dom
import { afterAll, afterEach, expect, test, vi } from "vite-plus/test";
import { mediaUrl, mintMediaId, toTimelineDoc, type VideoOverlay } from "@maleo/shared";
import type { PreviewComposition } from "./use-preview-composition.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePreviewComposition } = await import("./use-preview-composition.ts");
const { clearPendingSources, setPendingLocalUrl } =
	await import("@models/core/pending-media-sources.ts");

const k1 = mintMediaId();
const managed = mediaUrl(k1);
const video: VideoOverlay = {
	id: 1,
	kind: "video",
	track: 0,
	url: managed,
	mediaAssetId: k1,
	start: 0,
	dur: 4,
};
const doc = toTimelineDoc([], [video]);
const refs = { images: [], speakers: [], notes: [], style: { tone: "", palette: "", music: "" } };
let composition: PreviewComposition | undefined;
const file = new File(["pending bytes"], "source.mp4");
const pendingFiles = new Map([[k1, file]]);
const loads: Array<{ source: { id: string; revision: string; requestId: number }; file?: File }> =
	[];
let receive: ((data: unknown) => void) | undefined;
const workers: FakeWorker[] = [];
class FakeWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
	onerror = null;
	constructor() {
		workers.push(this);
		receive = (data) => this.emit(data);
	}
	emit(data: unknown) {
		this.onmessage?.(new MessageEvent("message", { data }));
	}
	sent: unknown[] = [];
	postMessage(message: {
		type: string;
		source?: (typeof loads)[number]["source"] & { file?: File };
	}) {
		this.sent.push(message);
		if (message.type === "load" && message.source)
			loads.push({ source: message.source, file: message.source.file });
		if (message.type === "dispose") queueMicrotask(() => this.emit({ type: "disposed" }));
	}
	terminate = vi.fn();
}
vi.stubGlobal("Worker", FakeWorker);
vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:http://local/validated");
vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
function Harness({
	projectId = "p1",
	document = doc,
}: {
	projectId?: string;
	document?: typeof doc;
}) {
	composition = usePreviewComposition({
		pendingFiles,
		projectId,
		config: { format: "16:9" },
		refs,
		getDoc: () => document,
		settings: { aspectRatio: "16:9" } as never,
		trackFlags: {},
		captions: { enabled: false } as never,
		pacingDevices: {} as never,
	});
	return null;
}
const root = createRoot(document.createElement("div"));
afterEach(async () => {
	await act(async () => root.render(null));
	clearPendingSources();
	loads.length = 0;
	workers.length = 0;
});

test("clip Retry updates shared users and retains complete siblings without document writes", async () => {
	vi.mocked(URL.createObjectURL)
		.mockReturnValueOnce("blob:http://local/sibling")
		.mockReturnValueOnce("blob:http://local/shared");
	const document = toTimelineDoc(
		[],
		[
			video,
			{ ...video, id: 2, start: 4 },
			{ ...video, id: 3, start: 8, url: "/ready-sibling.mp4", mediaAssetId: undefined },
		],
	);
	const before = JSON.stringify(document);
	setPendingLocalUrl(k1, "blob:http://local/staging");
	await act(async () => root.render(createElement(Harness, { document })));
	expect(loads).toHaveLength(2);
	const shared = loads.find((load) => load.file)!;
	const sibling = loads.find((load) => !load.file)!;
	await act(async () => {
		receive?.({
			type: "failed",
			...shared.source,
			message: "Cannot decode source",
			bytesComplete: true,
		});
		receive?.({
			type: "complete",
			...sibling.source,
			file,
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		});
	});
	expect(composition!.previewMedia.snapshot?.clips.map((clip) => clip.state.state)).toEqual([
		"failed",
		"failed",
		"ready",
	]);
	await act(async () => composition!.previewMedia.retryClip("video:2"));
	expect(loads).toHaveLength(3);
	expect(loads[2]!.file).toBe(file);
	expect(loads[2]!.source.id).toBe(shared.source.id);
	await act(async () =>
		receive?.({
			type: "complete",
			...loads[2]!.source,
			file,
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		}),
	);
	expect(
		composition!.previewMedia.snapshot?.clips.every((clip) => clip.state.state === "ready"),
	).toBe(true);
	expect(composition!.previewMedia.readiness.ready).toBe(true);
	expect(JSON.stringify(document)).toBe(before);
});

test("replacement rejects old completion and removal stops the last loading blocker", async () => {
	const first = toTimelineDoc([], [{ ...video, url: "/first.mp4", mediaAssetId: undefined }]);
	const replacement = toTimelineDoc(
		[],
		[{ ...video, url: "/replacement.mp4", mediaAssetId: undefined }],
	);
	await act(async () => root.render(createElement(Harness, { document: first })));
	const old = loads[0]!;
	await act(async () => root.render(createElement(Harness, { document: replacement })));
	expect(composition!.previewMedia.readiness.ready).toBe(false);
	expect(loads).toHaveLength(2);
	await act(async () =>
		receive?.({
			type: "complete",
			...old.source,
			file,
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		}),
	);
	expect(composition!.previewMedia.readiness.ready).toBe(false);
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.url).toMatch(/^data:image/);
	await act(async () => root.render(createElement(Harness, { document: toTimelineDoc([]) })));
	expect(composition!.previewMedia.readiness.ready).toBe(true);
	await act(async () =>
		receive?.({
			type: "complete",
			...loads[1]!.source,
			file,
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
		}),
	);
	expect(composition!.previewMedia.snapshot?.clips).toEqual([]);
	expect(composition!.playing).toBe(false);
});
afterAll(async () => {
	await act(async () => root.unmount());
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

test("pending preview waits for validated local bytes while document and export keep authored URLs", async () => {
	setPendingLocalUrl(k1, "blob:http://local/staging");
	await act(async () => root.render(createElement(Harness)));
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.kind).toBe("image");
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.url).toMatch(/^data:image/);
	expect(loads).toHaveLength(1);
	await act(async () => {
		receive?.({
			type: "complete",
			probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
			...loads[0]!.source,
			file,
		});
	});
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.url).toBe(
		"blob:http://local/validated",
	);
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.kind).toBe("video");
	expect(doc.clips[0]!.video!.url).toBe(managed);
});

test("project/workspace changes and editor teardown dispose source ownership and reject late replies", async () => {
	const { setActiveWorkspace, getActiveWorkspace } =
		await import("@models/core/active-workspace.ts");
	const original = getActiveWorkspace();
	setPendingLocalUrl(k1, "blob:http://local/staging");
	try {
		await act(async () => root.render(createElement(Harness, { projectId: "p1" })));
		const first = workers[0]!;
		const oldLoad = loads[0]!;
		await act(async () =>
			first.emit({
				type: "complete",
				probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
				...oldLoad.source,
				file,
			}),
		);
		expect(composition!.previewStoryboard.videoOverlays?.[0]?.kind).toBe("video");
		await act(async () => root.render(createElement(Harness, { projectId: "p2" })));
		expect(first.sent).toContainEqual({ type: "dispose" });
		expect(first.terminate).toHaveBeenCalledOnce();
		await act(async () =>
			first.emit({
				type: "complete",
				probe: { video: { width: 2, height: 2, slots: 1, firstTimestamp: 0 }, audio: null },
				...oldLoad.source,
				file,
			}),
		);
		expect(composition!.previewStoryboard.videoOverlays?.[0]?.kind).toBe("image");
		const second = workers[1]!;
		await act(async () => setActiveWorkspace("preview-lifecycle-test"));
		expect(second.sent).toContainEqual({ type: "dispose" });
		expect(composition!.previewStoryboard.videoOverlays?.[0]?.kind).toBe("image");
		const third = workers[2]!;
		await act(async () => root.render(null));
		expect(third.sent).toContainEqual({ type: "dispose" });
		expect(third.terminate).toHaveBeenCalledOnce();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://local/validated");
	} finally {
		setActiveWorkspace(original);
	}
});
