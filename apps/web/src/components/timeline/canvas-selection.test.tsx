// @vitest-environment happy-dom
/* Canvas hit testing through the real engine (`p2-preview-editing` task 4.2):
 * a click picks an animated element where it is drawn at the playhead, and
 * shift-clicks build a two-element selection through the selection rules. */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, useRef, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { toTimelineDoc } from "@maleo/shared";
import { provideEditorEngine } from "@maleo/shared/editor";
import { testEngine } from "@models/editor-engine/engine-fixture.ts";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createEditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { EMPTY_SELECTION, selectClip, type Selection } from "@models/timeline/selection-model.ts";
import { useCanvasEngine, type CanvasSelectionOps } from "@hooks/timeline/use-canvas-engine.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* video:2 moves from x 0 to 60 over 4 s, so at 2 s its 20 × 20 box is centred at (40, 20). */
const doc = toTimelineDoc(
	[],
	[
		{
			id: 2,
			kind: "image",
			url: "a.png",
			start: 0,
			dur: 4,
			layout: {
				xPct: 0,
				yPct: 10,
				widthPct: 20,
				heightPct: 20,
				fit: "contain",
				animation: {
					tracks: {
						xPct: [
							{ t: 0, v: 0 },
							{ t: 4, v: 60 },
						],
					},
				},
			},
		},
	],
	[
		{
			id: 1,
			content: "T",
			start: 0,
			dur: 4,
			preset: "plain",
			layout: { xPct: 60, yPct: 60, widthPct: 20, heightPct: 20, fit: "contain" },
		},
	],
);

let selection: Selection;
let ops: CanvasSelectionOps;
let host: HTMLElement;
let unmount: () => void;
const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

function Harness(): JSX.Element {
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const [current, setCurrent] = useState(EMPTY_SELECTION);
	selection = current;
	const canvas = useCanvasEngine({
		store: storeRef,
		// SAFETY: a click makes no command, so no writer is called.
		writers: {} as DocumentWriters,
		chromeStore: createEditorChromeStore(),
		canvasRef,
		playhead: createPlayheadHandle(2),
		selection: current,
		ops: {
			...ops,
			selectFreeClip: (source, refId, start) => {
				ops.selectFreeClip(source, refId, start);
				setCurrent(selectClip(source, refId));
			},
			setSelection: (update) => setCurrent(update),
		},
		onPreview: () => {},
	});
	return <div ref={canvasRef} onPointerDown={canvas.pointerDown} />;
}

const storeRef = createTimelineDocumentStore();

beforeEach(async () => {
	provideEditorEngine(testEngine);
	storeRef.setDoc(doc);
	rect.mockReturnValue({
		left: 0,
		top: 0,
		width: 800,
		height: 450,
		x: 0,
		y: 0,
		right: 800,
		bottom: 450,
	} as DOMRect);
	ops = {
		selectScene: vi.fn(),
		selectFreeClip: vi.fn(),
		clearSelection: vi.fn(),
		setSelection: vi.fn(),
	};
	host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	await act(async () => root.render(<Harness />));
	unmount = () => act(() => root.unmount());
});
afterEach(() => {
	unmount();
	document.body.innerHTML = "";
});

const click = (xPct: number, yPct: number, shiftKey = false) =>
	act(() => {
		host.firstElementChild!.dispatchEvent(
			new PointerEvent("pointerdown", {
				bubbles: true,
				clientX: xPct * 8,
				clientY: yPct * 4.5,
				button: 0,
				pointerType: "mouse",
				shiftKey,
			}),
		);
	});

test("a click picks an animated element where it is drawn at the playhead", async () => {
	await click(10, 20); // where the element was authored: nothing is there at 2 s
	expect(ops.selectFreeClip).not.toHaveBeenCalled();
	expect(ops.clearSelection).toHaveBeenCalledTimes(1);
	await click(40, 20);
	expect(ops.selectFreeClip).toHaveBeenCalledWith("video", 2, 2);
});

test("shift-clicks build and shrink a two-element selection", async () => {
	await click(40, 20);
	await click(70, 70, true);
	expect(new Set(selection.freeIds)).toEqual(new Set(["video:2", "text:1"]));
	await click(70, 70, true);
	expect(selection.freeIds).toEqual(new Set(["video:2"]));
});
