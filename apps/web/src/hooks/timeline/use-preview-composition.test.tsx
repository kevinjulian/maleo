// @vitest-environment happy-dom
import { afterAll, afterEach, expect, test } from "vite-plus/test";
import {
	mediaUrl,
	mintMediaId,
	toTimelineDoc,
	type ReadyImportedMedia,
	type VideoOverlay,
} from "@maleo/shared";
import type { PreviewComposition } from "./use-preview-composition.ts";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
const { act, createElement } = await import("react");
const { createRoot } = await import("react-dom/client");
const { usePreviewComposition } = await import("./use-preview-composition.ts");
const { clearPendingSources, setPendingLocalUrl, setPendingReady } =
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
function Harness() {
	composition = usePreviewComposition({
		config: { format: "16:9" },
		refs,
		getDoc: () => doc,
		settings: { aspectRatio: "16:9" } as never,
		trackFlags: {},
		captions: { enabled: false } as never,
		pacingDevices: {} as never,
		infographicStyle: {} as never,
		deps: [],
	});
	return null;
}
const root = createRoot(document.createElement("div"));
afterEach(() => {
	clearPendingSources();
});
afterAll(async () => {
	await act(async () => root.unmount());
});

test("the preview plays a pending clip from its local copy, then the managed media, with the document unchanged", async () => {
	setPendingLocalUrl(k1, "blob:http://local/1");
	await act(async () => root.render(createElement(Harness)));
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.url).toBe("blob:http://local/1");
	await act(async () => {
		setPendingReady(k1, { url: managed } as ReadyImportedMedia);
	});
	expect(composition!.previewStoryboard.videoOverlays?.[0]?.url).toBe(managed);
	expect(doc.clips[0]!.video!.url).toBe(managed);
});
