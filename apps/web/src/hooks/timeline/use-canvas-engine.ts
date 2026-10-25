/* The preview canvas on the engine (`p2-preview-editing` D2, D3).
 *
 * The canvas surface forwards pointer and key input to one engine canvas
 * session and does what each result says: apply a selection action through
 * the selection rules, show `preview` as the Player's draft (the command run
 * on a copy of the document, never recorded), and apply `commit` through the
 * document writers as one undo step. The overlay a gesture produces is held
 * here as a small external store, so a pointer move repaints the box and not
 * the stage. */
import { useEffect, useMemo, useRef, type RefObject } from "react";
import {
	applyCommand,
	openCanvas,
	type CanvasContext,
	type CanvasEvent,
	type CanvasHandleId,
	type CanvasOverlay,
	type CanvasResult,
	type CanvasSession,
	type CanvasSelectAction,
} from "@maleo/shared/editor";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { toggleClip, type Selection } from "@models/timeline/selection-model.ts";
import { canvasDocument } from "@models/editor-engine/canvas-document.ts";
import { createTwoPointer } from "@controllers/canvas/two-pointer.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";
import type { EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";

/** The selection transitions the stage owns, with their side effects. */
export interface CanvasSelectionOps {
	selectScene: (sceneId: number) => void;
	selectFreeClip: (source: "video" | "text", refId: number, start: number) => void;
	clearSelection: () => void;
	setSelection: (update: (current: Selection) => Selection) => void;
}

export interface CanvasEngineInput {
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	canvasRef: RefObject<HTMLElement | null>;
	playhead: PlayheadHandle;
	selection: Selection;
	ops: CanvasSelectionOps;
	/** The document the Player shows while a gesture runs, or null. */
	onPreview: (doc: EditorDoc | null) => void;
}

export interface CanvasEngine {
	/** The overlay of the gesture in progress, or null when idle. */
	gestureOverlay: () => CanvasOverlay | null;
	subscribe: (listener: () => void) => () => void;
	/** The overlay at `time` with no event. Null before the canvas has a size. */
	overlayAt: (time: number) => CanvasOverlay | null;
	key: (handle: CanvasHandleId, event: React.KeyboardEvent) => void;
	/** Send one event (a pointer, a pinch or a twist); returns whether the engine used it. */
	send: (
		event: DistributiveOmit<CanvasEvent, keyof CanvasContext>,
		modifiers?: Modifiers,
	) => boolean;
	pointerDown: (event: React.PointerEvent<HTMLElement>) => void;
	pointerMove: (event: React.PointerEvent<HTMLElement>) => void;
	pointerUp: (event: React.PointerEvent<HTMLElement>) => void;
	pointerCancel: (event: React.PointerEvent<HTMLElement>) => void;
	close: () => void;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
interface Modifiers {
	shift?: boolean;
	alt?: boolean;
}

/** Device px are client px here: the view reports density 1 and the canvas rect in client px. */
const CSS_HANDLE = 24;
const COARSE_HANDLE = 44;
const coarse = (): boolean =>
	typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

function createCanvasEngine(input: { current: CanvasEngineInput }): CanvasEngine {
	let session: CanvasSession | null = null;
	let active = false;
	let pointer: number | null = null;
	/* Two touch pointers make a pinch and a twist (D7). */
	const touches = createTwoPointer();
	let pinching = false;
	let overlay: CanvasOverlay | null = null;
	const listeners = new Set<() => void>();
	const publish = (next: CanvasOverlay | null): void => {
		overlay = next;
		for (const listener of listeners) listener();
	};

	/* Open the session and give it the canvas rect; false when the canvas has no size. */
	const ready = (): CanvasSession | null => {
		const el = input.current.canvasRef.current;
		const rect = el?.getBoundingClientRect();
		if (!el || !rect?.width || !rect.height) return null;
		const { engine, handle } = canvasDocument(input.current.store.getDoc());
		session ??= openCanvas(engine, handle);
		/* CSS zoom on an ancestor scales the rect but not the stylesheet's handle size. */
		const zoom = el.offsetWidth ? rect.width / el.offsetWidth : 1;
		session.view({
			area: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
			aspect: rect.width / rect.height,
			handleSize: (coarse() ? COARSE_HANDLE : CSS_HANDLE) * zoom,
			handlesOutside: coarse(),
		});
		return session;
	};

	const context = (): CanvasContext => {
		const { store, chromeStore, playhead, selection } = input.current;
		const chrome = chromeStore.get();
		return {
			time: playhead.get(),
			// The multi-select set is a `Set`, which JSON would write as `{}`.
			selection: { ...selection, freeIds: [...selection.freeIds] },
			visual: chrome.clipKeyVisual ?? null,
			mask: Boolean(chrome.clipMaskEditing),
			doc: canvasDocument(store.getDoc()).handle,
		};
	};

	const select = (action: CanvasSelectAction): void => {
		const { ops, playhead } = input.current;
		if (action.type === "selectScene") ops.selectScene(action.sceneId);
		else if (action.type === "clear") ops.clearSelection();
		else if (action.type === "toggleClip")
			ops.setSelection((current) => toggleClip(current, action.source, action.refId));
		else if (action.source !== "scene")
			// The current time, so selecting from the preview never moves the playhead.
			ops.selectFreeClip(action.source, action.refId, playhead.get());
	};

	const land = (result: CanvasResult, ending: boolean): void => {
		const { store, writers, onPreview } = input.current;
		if (result.select) select(result.select);
		if (result.preview) {
			const scope = { doc: store.getDoc(), slides: [], posts: [], mediaAssets: [] };
			onPreview(applyCommand(scope, result.preview).doc);
		} else if (ending) onPreview(null);
		if (result.commit) writers.apply(result.commit);
		publish(active ? result.overlay : null);
	};

	const escape = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !active || !session) return;
		event.preventDefault();
		event.stopPropagation();
		finish(session.input({ ...context(), type: "key", key: "Escape" }));
	};

	const finish = (result: CanvasResult): void => {
		active = false;
		pointer = null;
		window.removeEventListener("keydown", escape, true);
		land(result, true);
	};

	const send: CanvasEngine["send"] = (event, modifiers = {}) => {
		const canvas = ready();
		if (!canvas) return false;
		// SAFETY: `event` is one variant of `CanvasEvent` minus its context; the context and modifiers complete it.
		const result = canvas.input({ ...context(), ...modifiers, ...event } as CanvasEvent);
		const starts =
			(event.type === "down" || event.type === "pinch" || event.type === "twist") && !active;
		if (starts && result.handled && !result.select) {
			active = true;
			window.addEventListener("keydown", escape, true);
		}
		if (event.type === "up" || event.type === "cancel") finish(result);
		else land(result, false);
		return result.handled;
	};

	const point = (e: React.PointerEvent) => ({ x: e.clientX, y: e.clientY });
	const modifiers = (e: React.PointerEvent | React.KeyboardEvent): Modifiers => ({
		shift: e.shiftKey,
		alt: e.altKey,
	});

	return {
		gestureOverlay: () => overlay,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		overlayAt(time) {
			const canvas = ready();
			return canvas ? canvas.overlay({ ...context(), time }) : null;
		},
		key(handle, e) {
			if (!e.key.startsWith("Arrow")) return;
			if (send({ type: "key", key: e.key, handle }, modifiers(e))) {
				e.preventDefault();
				e.stopPropagation();
			}
		},
		send,
		pointerDown(e) {
			if (e.pointerType === "mouse" && e.button !== 0) return;
			if (e.target instanceof Element && e.target.closest(".tl2-canvas-gen")) return;
			if (e.pointerType === "touch" && touches.down(e.pointerId, point(e))) {
				// A second finger turns a drag into a pinch.
				if (active && !pinching) send({ type: "cancel", ...point(e) });
				pinching = true;
				e.preventDefault();
				e.currentTarget.setPointerCapture?.(e.pointerId);
				return;
			}
			if (pointer !== null || pinching) return;
			if (!send({ type: "down", ...point(e) }, modifiers(e)) || !active) return;
			e.preventDefault();
			pointer = e.pointerId;
			e.currentTarget.setPointerCapture?.(e.pointerId);
		},
		pointerMove(e) {
			const sample = e.pointerType === "touch" ? touches.move(e.pointerId, point(e)) : null;
			if (pinching) {
				if (!sample) return;
				send({ type: "pinch", scale: sample.scale }, modifiers(e));
				send({ type: "twist", angle: sample.angle }, modifiers(e));
				return;
			}
			if (e.pointerId === pointer) send({ type: "move", ...point(e) }, modifiers(e));
		},
		pointerUp(e) {
			const ended = e.pointerType === "touch" && touches.up(e.pointerId);
			if (pinching && ended) {
				pinching = false;
				send({ type: "up", ...point(e) }, modifiers(e));
			} else if (!pinching && e.pointerId === pointer)
				send({ type: "up", ...point(e) }, modifiers(e));
			// After the release is sent: losing capture cancels whatever is still active.
			if (e.currentTarget.hasPointerCapture?.(e.pointerId))
				e.currentTarget.releasePointerCapture(e.pointerId);
		},
		pointerCancel(e) {
			const ended = e.pointerType === "touch" && touches.up(e.pointerId);
			if (pinching && ended) {
				pinching = false;
				send({ type: "cancel", ...point(e) });
			} else if (e.pointerId === pointer) send({ type: "cancel", ...point(e) });
		},
		close() {
			window.removeEventListener("keydown", escape, true);
			session?.close();
			session = null;
		},
	};
}

export function useCanvasEngine(input: CanvasEngineInput): CanvasEngine {
	const latest = useRef(input);
	latest.current = input;
	const engine = useMemo(() => createCanvasEngine(latest), []);
	useEffect(() => () => engine.close(), [engine]);
	return engine;
}
