// @vitest-environment happy-dom
/* The canvas box over a fake engine (`p2-preview-editing` task 4.1): the
 * surface forwards a drag, Escape and a key nudge to `canvas_input`, draws the
 * box the engine returns, previews `preview` and applies `commit` once. */
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { act, useRef, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { provideEditorEngine, type CanvasBox, type Engine } from "@maleo/shared/editor";
import { createTimelineDocumentStore } from "@stores/timeline-document-store.ts";
import { createEditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { createPlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { EMPTY_SELECTION } from "@models/timeline/selection-model.ts";
import { useCanvasEngine, type CanvasEngineInput } from "@hooks/timeline/use-canvas-engine.ts";
import { AnimatedClipBox } from "./animated-clip-box.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (xPct: number): CanvasBox => ({
	xPct,
	yPct: 20,
	widthPct: 40,
	heightPct: 30,
	rotationDeg: 0,
	scale: 1,
	locked: false,
	source: "video",
	id: 2,
	kind: "element",
	handles: [],
});
const overlay = (xPct: number) => ({
	box: box(xPct),
	members: [],
	guides: { x: xPct === 30 ? 50 : null, y: null },
	animated: false,
});
const COMMIT = { type: "clip.replace", id: "video:2", clip: {} };
const PREVIEW = { type: "noop" };

/* A fake engine: documents open and execute to nothing; a canvas answers each
 * event the way the real session does, and records what it was sent. */
function fakeEngine(sent: Record<string, unknown>[]): Engine {
	let dragging = false;
	const ok = <T,>(value: T) => ({ ok: true as const, value });
	const result = (value: unknown) => ok(JSON.stringify(value));
	const fake: Partial<Engine> = {
		open: () => ok(1),
		close: () => ok(undefined),
		executeDelta: () => result({ inverse: { type: "noop" }, delta: {} }),
		canvasOpen: () => ok(7),
		canvasClose: () => ok(undefined),
		canvasView: () => ok(undefined),
		canvasOverlay: () => result(overlay(10)),
		canvasInput(_canvas, json) {
			const event = JSON.parse(json);
			sent.push(event);
			const empty = { select: null, preview: null, commit: null };
			if (event.type === "down") {
				dragging = true;
				return result({ ...empty, overlay: overlay(10), handled: true });
			}
			if (event.type === "move" && dragging)
				return result({ ...empty, overlay: overlay(30), preview: PREVIEW, handled: true });
			if (event.type === "key" && event.key === "Escape") {
				dragging = false;
				return result({ ...empty, overlay: overlay(10), handled: true });
			}
			if (event.type === "up") {
				const commit = dragging ? COMMIT : null;
				dragging = false;
				return result({ ...empty, overlay: overlay(10), commit, handled: true });
			}
			if (event.type === "key")
				return result({ ...empty, overlay: overlay(11), commit: COMMIT, handled: true });
			return result({ ...empty, overlay: overlay(10), handled: false });
		},
	};
	// SAFETY: the canvas host and the document follower call only the methods above.
	return fake as Engine;
}

function Harness(props: Omit<CanvasEngineInput, "canvasRef">): JSX.Element {
	const canvasRef = useRef<HTMLDivElement | null>(null);
	const canvas = useCanvasEngine({ ...props, canvasRef });
	return (
		<div
			ref={canvasRef}
			className="tl2-canvas"
			onPointerDown={canvas.pointerDown}
			onPointerMove={canvas.pointerMove}
			onPointerUp={canvas.pointerUp}
		>
			<AnimatedClipBox
				canvas={canvas}
				canvasRef={canvasRef}
				store={props.store}
				playhead={props.playhead}
				chromeStore={props.chromeStore}
				selection={props.selection}
			/>
		</div>
	);
}

let sent: Record<string, unknown>[];
let apply: ReturnType<typeof vi.fn>;
let previews: unknown[];
let host: HTMLElement;
let unmount: () => void;
const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect");

beforeEach(async () => {
	sent = [];
	previews = [];
	apply = vi.fn();
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
	provideEditorEngine(fakeEngine(sent));
	host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	const store = createTimelineDocumentStore();
	await act(async () => {
		root.render(
			<Harness
				store={store}
				// SAFETY: the canvas host calls only `apply`.
				writers={{ apply } as unknown as DocumentWriters}
				chromeStore={createEditorChromeStore()}
				playhead={createPlayheadHandle(1)}
				selection={EMPTY_SELECTION}
				ops={{
					selectScene: vi.fn(),
					selectFreeClip: vi.fn(),
					clearSelection: vi.fn(),
					setSelection: vi.fn(),
				}}
				onPreview={(doc) => previews.push(doc)}
			/>,
		);
	});
	unmount = () => act(() => root.unmount());
});
afterEach(() => {
	unmount();
	document.body.innerHTML = "";
});

const clipBox = () => host.querySelector<HTMLElement>(".tl2-clipbox")!;
const pointer = (type: string, x: number) =>
	act(() => {
		host.querySelector(".tl2-clipbox-move")!.dispatchEvent(
			new PointerEvent(type, {
				bubbles: true,
				clientX: x,
				clientY: 150,
				pointerId: 1,
				button: 0,
				pointerType: "mouse",
			}),
		);
	});

test("a drag previews the engine's box and commits once on release", async () => {
	expect(clipBox().style.left).toBe("10%");
	await pointer("pointerdown", 240);
	await pointer("pointermove", 380);
	expect(clipBox().style.left).toBe("30%");
	expect(host.querySelector(".tl2-snapguide.v")).not.toBeNull();
	expect(previews.length).toBe(1);
	await pointer("pointerup", 380);
	expect(sent.map((e) => e.type)).toEqual(["down", "move", "up"]);
	expect(sent[1]).toMatchObject({ x: 380, y: 150, time: 1 });
	expect(apply).toHaveBeenCalledTimes(1);
	expect(apply).toHaveBeenCalledWith(COMMIT);
	expect(previews.at(-1)).toBeNull();
	expect(clipBox().style.left).toBe("10%");
});

test("Escape cancels a drag and commits nothing", async () => {
	await pointer("pointerdown", 240);
	await pointer("pointermove", 380);
	await act(() => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
	});
	expect(sent.at(-1)).toMatchObject({ type: "key", key: "Escape" });
	expect(clipBox().style.left).toBe("10%");
	await pointer("pointerup", 380);
	expect(apply).not.toHaveBeenCalled();
});

test("an arrow key on a handle sends a nudge and applies its command", async () => {
	const move = host.querySelector<HTMLButtonElement>(".tl2-clipbox-move")!;
	await act(() => {
		move.dispatchEvent(
			new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }),
		);
	});
	expect(sent.at(-1)).toMatchObject({
		type: "key",
		key: "ArrowRight",
		handle: "move",
		shift: true,
	});
	expect(apply).toHaveBeenCalledWith(COMMIT);
});
