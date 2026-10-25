/* What the canvas draws over the selection, from the engine (`p2-preview-editing`).
 *
 * While idle the box comes from `canvas_overlay` at the playhead, and follows
 * the playhead only when a selected element is animated. While a gesture runs
 * it comes from the gesture's own results. */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { JSX, RefObject } from "react";
import type { CanvasBox } from "@maleo/shared/editor";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { Selection } from "@models/timeline/selection-model.ts";
import { usePlayheadSelector } from "@hooks/timeline/use-playhead.ts";
import type { CanvasEngine } from "@hooks/timeline/use-canvas-engine.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import { ClipBox, MemberOutline, SnapGuides } from "./clip-box.tsx";

const SUBJECT: Record<NonNullable<CanvasBox["kind"]>, string> = {
	element: "selected clip",
	mask: "clip mask",
	group: "selection",
};

/** The canvas size, so a box in pixel space (a group, a mask) is redrawn when it changes. */
function useCanvasSize(canvasRef: RefObject<HTMLElement | null>): string {
	const [size, setSize] = useState("");
	useEffect(() => {
		const el = canvasRef.current;
		if (!el) return;
		const read = (): void => {
			const rect = el.getBoundingClientRect();
			setSize(`${rect.width}x${rect.height}`);
		};
		read();
		if (typeof ResizeObserver !== "function") return;
		const observer = new ResizeObserver(read);
		observer.observe(el);
		return () => observer.disconnect();
	}, [canvasRef]);
	return size;
}

export function AnimatedClipBox({
	canvas,
	canvasRef,
	store,
	playhead,
	chromeStore,
	selection,
	onActivateText,
}: {
	canvas: CanvasEngine;
	canvasRef: RefObject<HTMLElement | null>;
	store: TimelineDocumentStore;
	playhead: PlayheadHandle;
	chromeStore: EditorChromeStore;
	selection: Selection;
	/** Double-click on a selected text element. */
	onActivateText?: (id: number) => void;
}): JSX.Element | null {
	const gesture = useSyncExternalStore(
		canvas.subscribe,
		canvas.gestureOverlay,
		canvas.gestureOverlay,
	);
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [visual] = useChromeField(chromeStore, "clipKeyVisual");
	const [mask] = useChromeField(chromeStore, "clipMaskEditing");
	const size = useCanvasSize(canvasRef);
	const [animated, setAnimated] = useState(false);
	const selectTime = useCallback((time: number) => (animated ? time : 0), [animated]);
	const time = usePlayheadSelector(playhead, selectTime);
	const idle = useMemo(
		() => (size ? canvas.overlayAt(animated ? time : playhead.get()) : null),
		[canvas, doc, selection, visual, mask, size, animated, time, playhead],
	);
	useEffect(() => setAnimated(Boolean(idle?.animated)), [idle]);
	const overlay = gesture ?? idle;
	const box = overlay?.box;
	if (!overlay || !box) return null;
	const activate =
		box.kind === "element" && box.source === "text" && box.id !== undefined && onActivateText
			? () => onActivateText(box.id!)
			: undefined;
	return (
		<>
			<SnapGuides guides={overlay.guides} />
			{overlay.members.map((member) => (
				<MemberOutline key={`${member.source}:${member.id}`} box={member} />
			))}
			<ClipBox
				box={box}
				subject={SUBJECT[box.kind ?? "element"]}
				onKey={canvas.key}
				onActivate={activate}
			/>
		</>
	);
}
