// @vitest-environment happy-dom
/* Source processing waits for a pending upload, and works on it once it is ready. */
import { afterEach, expect, test } from "vite-plus/test";
import type { ReadyImportedMedia } from "@maleo/shared";
import type { MediaAsset } from "@models/timeline/editor-media.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { toTimelineDoc } = await import("@maleo/shared");
const { createTimelineDocumentStore } = await import("@stores/timeline-document-store.ts");
const { createDocumentWriters } = await import("@stores/document-writers.ts");
const { clearPendingSources, setPendingReady, resolvePendingAsset, trackPendingSource } =
	await import("@models/core/pending-media-sources.ts");
const { SourcePlaybackControl, PENDING_SOURCE_REASON } =
	await import("./source-playback-control.tsx");

const { mediaUrl, mintMediaId } = await import("@maleo/shared");
const k1 = mintMediaId();
const managed = mediaUrl(k1);
const asset: MediaAsset = {
	id: k1,
	label: "clip.mp4",
	url: managed,
	kind: "video",
	source: "upload",
	dur: 4,
	metadata: {
		originalFilename: "clip.mp4",
		byteSize: 1,
		kind: "video",
		duration: 4,
		hasAudio: true,
	},
};
const ready = {
	id: "row",
	label: "clip.mp4",
	url: managed,
	kind: "video",
	source: "upload",
	dur: 4,
	metadata: {
		originalFilename: "clip.mp4",
		byteSize: 1,
		kind: "video",
		duration: 4,
		hasAudio: true,
	},
	compatibility: { preview: { status: "supported" }, render: { status: "supported" } },
	importedSource: {
		revision: "r1",
		fingerprint: "a".repeat(64),
		originalMediaId: "11111111-1111-4111-8111-111111111111",
	},
} as ReadyImportedMedia;

let unmount: (() => void) | undefined;
afterEach(() => {
	unmount?.();
	unmount = undefined;
	clearPendingSources();
});

function mount() {
	trackPendingSource(k1);
	const store = createTimelineDocumentStore(
		toTimelineDoc([], [{ id: 2, kind: "video", url: managed, mediaAssetId: k1, start: 0, dur: 4 }]),
	);
	const writers = createDocumentWriters({ store, commit: (next) => store.setDoc(next) });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const render = (assets: MediaAsset[]) =>
		act(() =>
			root.render(
				<SourcePlaybackControl
					projectId="p"
					target={{ source: "video", id: 2 }}
					store={store}
					writers={writers}
					library={{ mediaAssets: assets, getMediaAssets: () => [asset] } as never}
				/>,
			),
		);
	render([asset]);
	unmount = () =>
		act(() => {
			root.unmount();
			host.remove();
		});
	const button = (name: string) =>
		[...host.querySelectorAll("button")].find(
			(b) => b.textContent === name || b.getAttribute("aria-label") === name,
		)!;
	return { host, button, render };
}

test("reverse, rate and extract audio wait for a pending upload and say why", () => {
	const { host, button } = mount();
	expect(host.textContent).toContain(PENDING_SOURCE_REASON);
	expect(button("Reverse").disabled).toBe(true);
	expect(button("Extract audio").disabled).toBe(true);
	expect(host.querySelector<HTMLInputElement>('input[aria-label="Rate (%)"]')!.disabled).toBe(true);
});

test("once the import is ready the same clip can be processed", () => {
	const { host, button, render } = mount();
	act(() => {
		setPendingReady(k1, ready);
	});
	render([resolvePendingAsset(asset)]);
	expect(host.textContent).not.toContain(PENDING_SOURCE_REASON);
	expect(button("Extract audio").disabled).toBe(false);
	expect(button("Reverse").disabled).toBe(false);
});
