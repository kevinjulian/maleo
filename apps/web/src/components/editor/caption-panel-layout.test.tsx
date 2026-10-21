// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { DEFAULT_CAPTIONS, type TimelineDoc } from "@maleo/shared";
import { provideEditorEngine } from "@maleo/shared/editor";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createDocumentWriters } from "@stores/document-writers.ts";
import { createSelectionStore } from "@stores/selection-store.ts";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { importSrtCaptions, parseSrt } from "@models/captions/srt.ts";
import type { CaptionJobControls } from "@hooks/editor/use-caption-jobs.ts";

vi.mock("@api/caption-jobs.ts", async (original) => ({
	...(await original<typeof import("@api/caption-jobs.ts")>()),
	captionReadiness: vi.fn(async () => ({ available: true })),
}));
const { CaptionTranscriptPanel } = await import("./caption-transcript.tsx");

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
provideEditorEngine(testEngine);

const MEDIA = "/api/media/00000000-0000-4000-8000-000000000001";
const empty: TimelineDoc = {
	schemaVersion: 2,
	markers: [],
	clips: [
		{
			id: "audio:1792255103569",
			type: "audio",
			startSec: 0,
			durationSec: 12.01,
			track: 1,
			audio: {
				id: 1,
				kind: "voiceover",
				content: "Speech",
				url: MEDIA,
				start: 0,
				dur: 12.01,
				volume: 1,
			},
		},
	],
};
const srt = (body: string): TimelineDoc => importSrtCaptions(empty, parseSrt(body), "layout");

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
	await cleanup?.();
	cleanup = undefined;
});

async function mount(doc: TimelineDoc, jobs: Partial<CaptionJobControls> = {}) {
	const store = createTimelineDocumentStore();
	store.setDoc(doc);
	const selectionStore = createSelectionStore();
	const playhead = createPlayheadHandle();
	let commits = 0;
	const writers = createDocumentWriters({
		store,
		commit: (next) => {
			commits++;
			store.setDoc(next);
		},
	});
	const generate = vi.fn(async () => {});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () =>
		root.render(
			<CaptionTranscriptPanel
				store={store}
				writers={writers}
				selectionStore={selectionStore}
				playhead={playhead}
				seek={(sec) => playhead.set(sec)}
				mediaAssets={[
					{ id: "a", label: "interview.mp4", url: MEDIA, kind: "audio", source: "upload" },
				]}
				projectId="project"
				value={{ ...DEFAULT_CAPTIONS, enabled: true }}
				onChange={() => {}}
				onClose={() => {}}
				onImportSrt={() => ({ ok: true, message: "" })}
				onExportSrt={() => {}}
				cueCount={doc.clips.filter((clip) => clip.type === "caption").length}
				jobs={{
					key: "proof",
					id: null,
					job: null,
					status: "",
					error: null,
					busy: false,
					generate,
					cancel: async () => {},
					apply: () => {},
					resume: () => {},
					...jobs,
				}}
			/>,
		),
	);
	await act(async () => {});
	cleanup = async () => {
		await act(async () => root.unmount());
		host.remove();
	};
	return { host, store, generate, selectionStore, commits: () => commits };
}

const button = (host: HTMLElement, name: string) =>
	[...host.querySelectorAll<HTMLButtonElement>("button")].find(
		(item) => item.textContent?.trim() === name,
	);

test("no cues: the generate card leads, with named sources, clock range and SRT import beside Generate", async () => {
	const { host, generate } = await mount(empty);
	const panel = host.querySelector('[role="tabpanel"]')!;
	expect(panel.querySelector("[data-caption-row]")).toBeNull();
	expect(panel.textContent).toContain("Generate captions");
	expect(panel.textContent).toContain("Range 0:00 – 0:12");
	expect(panel.textContent).not.toMatch(/(video|audio):\d+/);
	expect(panel.textContent).not.toContain("Preserve edited captions");
	const generateButton = button(host, "Generate captions")!;
	expect(generateButton.dataset.variant).toBe("primary");
	expect(generateButton.disabled).toBe(false);
	expect(button(host, "Import SRT")).toBeDefined();
	await act(async () => generateButton.click());
	expect(generate).toHaveBeenCalledWith(
		expect.objectContaining({ replaceEdited: false, source: "all" }),
	);
});

test("cues: the caption list leads and generation moves to the header menu", async () => {
	const { host } = await mount(srt("1\n00:00:00,000 --> 00:00:02,000\nHello world"));
	const panel = host.querySelector('[role="tabpanel"]')!;
	expect(panel.querySelector("[data-caption-row]")).not.toBeNull();
	expect(panel.querySelector('[aria-label="Caption source"]')).toBeNull();
	expect(button(host, "Generate captions")).toBeUndefined();
	expect(host.querySelector('[aria-label="Caption actions"]')).not.toBeNull();
});

test("no cues with prior deletions: regeneration exposes replacement and submits the choice", async () => {
	const doc = srt("1\n00:00:00,000 --> 00:00:02,000\nHello world");
	const { caption } = doc.clips.find((clip) => clip.caption)!;
	const { host, generate } = await mount({
		...doc,
		clips: doc.clips.filter((clip) => clip.type !== "caption"),
		captionSet: {
			...doc.captionSet!,
			deletedRanges: [
				{ id: "deleted", groupId: caption!.groupId, startSec: 0, endSec: 2, sources: [] },
			],
		},
	});
	expect(host.querySelector('[aria-label="Edited captions"]')).not.toBeNull();
	await act(async () => button(host, "Replace edited captions in this range")!.click());
	await act(async () => button(host, "Regenerate")!.click());
	expect(generate).toHaveBeenCalledWith(expect.objectContaining({ replaceEdited: true }));
});

test("job state shows above the caption list", async () => {
	const { host } = await mount(srt("1\n00:00:00,000 --> 00:00:02,000\nHello world"), {
		status: "Recognizing speech…",
		busy: true,
		id: "job",
	});
	const panel = host.querySelector('[role="tabpanel"]')!;
	const card = panel.querySelector('[data-slot="generation-card"]')!;
	const row = panel.querySelector("[data-caption-row]")!;
	expect(card.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("only the selected row shows timing and actions; stale rows show a badge either way", async () => {
	const doc = srt(
		"1\n00:00:00,000 --> 00:00:02,000\nHello world\n\n2\n00:00:02,000 --> 00:00:04,000\nSecond cue",
	);
	const stale = {
		...doc,
		clips: doc.clips.map((clip) =>
			clip.caption?.text === "Second cue"
				? { ...clip, caption: { ...clip.caption, status: "needs-refresh" as const } }
				: clip,
		),
	};
	const { host } = await mount(stale);
	const rows = () => [...host.querySelectorAll<HTMLElement>("[data-caption-row]")];
	expect(host.querySelector('[aria-label="Caption start seconds"]')).toBeNull();
	expect(rows()[1]!.textContent).toContain("Needs refresh");
	await act(async () => rows()[0]!.querySelector("textarea")!.focus());
	expect(rows()[0]!.querySelector('[aria-label="Caption start seconds"]')).not.toBeNull();
	expect(rows()[1]!.querySelector('[aria-label="Caption start seconds"]')).toBeNull();
	expect(rows()[1]!.textContent).toContain("Needs refresh");
});

async function key(field: HTMLTextAreaElement, init: KeyboardEventInit, caret: number) {
	field.focus();
	field.setSelectionRange(caret, caret);
	const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
	await act(async () => field.dispatchEvent(event));
	return event;
}

test("Enter splits at the caret's word boundary through the engine; Shift+Enter and composition do not", async () => {
	const { host, store } = await mount(
		srt("1\n00:00:00,000 --> 00:00:02,000\nhello wonderful world"),
	);
	const texts = () =>
		store
			.getDoc()
			.clips.filter((clip) => clip.type === "caption")
			.map((clip) => clip.caption!.text);
	const field = () => host.querySelector<HTMLTextAreaElement>("[data-caption-row] textarea")!;
	expect((await key(field(), { key: "Enter", shiftKey: true }, 5)).defaultPrevented).toBe(false);
	await key(field(), { key: "Enter", isComposing: true }, 5);
	expect(texts()).toEqual(["hello wonderful world"]);
	await key(field(), { key: "Enter" }, 9);
	expect(texts()).toEqual(["hello", "wonderful world"]);
});

test("Backspace at the start merges into the previous cue as one step", async () => {
	const { host, store } = await mount(
		srt("1\n00:00:00,000 --> 00:00:02,000\nHello\n\n2\n00:00:02,000 --> 00:00:04,000\nworld"),
	);
	const second = [...host.querySelectorAll<HTMLTextAreaElement>("[data-caption-row] textarea")][1]!;
	await key(second, { key: "Backspace" }, 0);
	const captions = store.getDoc().clips.filter((clip) => clip.type === "caption");
	expect(captions.map((clip) => clip.caption!.text)).toEqual(["Hello\nworld"]);
});

test("dense recognized words split on the boundary the caret names", async () => {
	const doc = srt("1\n00:00:00,000 --> 00:00:00,400\na b c d");
	const dense = {
		...doc,
		clips: doc.clips.map((clip) =>
			clip.caption
				? {
						...clip,
						caption: {
							...clip.caption,
							words: ["a", "b", "c", "d"].map((text, index) => ({
								text,
								startSec: index * 0.1,
								endSec: (index + 1) * 0.1,
							})),
						},
					}
				: clip,
		),
	};
	const { host, store } = await mount(dense);
	await key(
		host.querySelector<HTMLTextAreaElement>("[data-caption-row] textarea")!,
		{ key: "Enter" },
		4,
	);
	const texts = store
		.getDoc()
		.clips.filter((clip) => clip.type === "caption")
		.map((clip) => clip.caption!.text);
	expect(texts).toEqual(["a b", "c d"]);
});

test("replace all changes every unlocked match in one step and counts locked skips", async () => {
	const doc = srt(
		"1\n00:00:00,000 --> 00:00:02,000\nJon is here\n\n2\n00:00:02,000 --> 00:00:04,000\nAsk Jon",
	);
	const { host, store, commits } = await mount(doc);
	const setValue = (input: HTMLInputElement, value: string) => {
		Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
		input.dispatchEvent(new Event("input", { bubbles: true }));
	};
	await act(async () =>
		setValue(host.querySelector<HTMLInputElement>('input[aria-label="Find in captions"]')!, "Jon"),
	);
	expect(host.textContent).toContain("2 captions match");
	await act(async () =>
		setValue(host.querySelector<HTMLInputElement>('input[aria-label="Replace with"]')!, "John"),
	);
	const before = commits();
	await act(async () => button(host, "Replace all")!.click());
	expect(commits() - before).toBe(1);
	expect(
		store
			.getDoc()
			.clips.filter((clip) => clip.type === "caption")
			.map((clip) => clip.caption!.text),
	).toEqual(["John is here", "Ask John"]);
	expect(host.textContent).toContain("Replaced text in 2 captions.");
});

test("an unconfigured worker keeps Generate visible but disabled, with the reason and setup link beside it", async () => {
	const { captionReadiness } = await import("@api/caption-jobs.ts");
	vi.mocked(captionReadiness).mockResolvedValueOnce({
		available: false,
		reason: "Whisper model is not installed on the media worker.",
	} as Awaited<ReturnType<typeof captionReadiness>>);
	const { host } = await mount(empty);
	const generate = button(host, "Generate captions")!;
	expect(generate.disabled).toBe(true);
	const reason = host.querySelector<HTMLElement>("[data-caption-availability]")!;
	expect(reason.textContent).toContain("Whisper model is not installed on the media worker.");
	expect(reason.querySelector('a[href="/settings"]')?.textContent).toBe("Caption setup");
	expect(generate.closest('[data-slot="inspector-section"]')!.contains(reason)).toBe(true);
});
