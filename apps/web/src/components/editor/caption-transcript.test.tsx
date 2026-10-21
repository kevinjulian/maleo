// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vite-plus/test";
import { DEFAULT_CAPTIONS } from "@maleo/shared";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createDocumentWriters } from "@stores/document-writers.ts";
import { createSelectionStore } from "@stores/selection-store.ts";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { importSrtCaptions, parseSrt } from "@models/captions/srt.ts";
import { CaptionTranscriptPanel } from "./caption-transcript.tsx";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);

test("playback follow preserves composing input, selection and browsing; locked cues refuse editing", async () => {
	const store = createTimelineDocumentStore();
	store.setDoc(
		importSrtCaptions(
			{ schemaVersion: 2, clips: [], markers: [] },
			parseSrt(
				"1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nWorld",
			),
			"follow",
		),
	);
	const selectionStore = createSelectionStore();
	const playhead = createPlayheadHandle();
	const seek = vi.fn((sec: number) => playhead.set(sec));
	const writers = createDocumentWriters({ store, commit: (doc) => store.setDoc(doc) });
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await act(async () =>
			root.render(
				<CaptionTranscriptPanel
					store={store}
					writers={writers}
					selectionStore={selectionStore}
					playhead={playhead}
					seek={seek}
					mediaAssets={[]}
					projectId={null}
					value={{ ...DEFAULT_CAPTIONS, enabled: true }}
					onChange={() => {}}
					onClose={() => {}}
					jobs={{
						key: "proof",
						id: null,
						job: null,
						status: "",
						error: null,
						busy: false,
						generate: async () => {},
						cancel: async () => {},
						apply: () => {},
						resume: () => {},
					}}
				/>,
			),
		);
		const rows = [...host.querySelectorAll<HTMLElement>("[data-caption-row]")];
		expect(rows[0]!.textContent).not.toContain("Estimated word timing");
		const scroll = vi.fn();
		for (const row of rows) row.scrollIntoView = scroll;
		const follow = host.querySelector<HTMLButtonElement>('[aria-label="Follow caption playback"]')!;
		await act(async () => follow.click());
		await act(async () => rows[0]!.querySelector<HTMLButtonElement>("button")!.click());
		const selection = selectionStore.get();
		expect(seek).toHaveBeenCalledTimes(1);
		expect(rows[0]!.textContent).toContain("Estimated word timing");
		const input = rows[0]!.querySelector<HTMLTextAreaElement>("textarea")!;
		input.focus();
		input.setSelectionRange(1, 3);
		input.dispatchEvent(new CompositionEvent("compositionstart", { data: "字", bubbles: true }));
		await act(async () => playhead.set(2.5));
		expect(document.activeElement).toBe(input);
		expect([input.selectionStart, input.selectionEnd]).toEqual([1, 3]);
		expect(selectionStore.get()).toBe(selection);
		expect(seek).toHaveBeenCalledTimes(1);
		expect(scroll).not.toHaveBeenCalled();
		input.dispatchEvent(new CompositionEvent("compositionend", { data: "字", bubbles: true }));
		rows[0]!.parentElement!.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 40 }));
		await act(async () => input.blur());
		await act(async () => {
			playhead.set(0);
			playhead.set(2.5);
		});
		expect(scroll).not.toHaveBeenCalled();
		await act(async () => {
			follow.click();
		});
		await act(async () => {
			follow.click();
		});
		await act(async () => playhead.set(0));
		expect(scroll).toHaveBeenCalledTimes(1);
		const doc = store.getDoc();
		const track = doc.clips[0]!.track;
		await act(async () =>
			store.setDoc({
				...doc,
				trackFlags: { ...doc.trackFlags, [track]: { group: "caption", locked: true } },
			}),
		);
		expect(input.disabled).toBe(true);
		expect(
			rows[0]!.querySelector<HTMLInputElement>('[aria-label="Caption start seconds"]')!.disabled,
		).toBe(true);
	} finally {
		await act(async () => root.unmount());
		host.remove();
	}
});
