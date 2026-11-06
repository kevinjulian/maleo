/* The document the canvas engine reads (`p2-preview-editing`).
 *
 * Canvas and inspector calls name a document handle: the shared follower
 * (`documentHandle`), reopened only when the document changes, so a pointer
 * move does not admit the document again. */
import type { ClipLayout } from "@maleo/shared";
import {
	applyCommand,
	canvasEdit,
	canvasLayout,
	canvasSizePatch,
	documentHandle,
	documentScope,
	editorEngine,
	type CanvasLayout,
	type CanvasTarget,
	type EditorCommand,
	type Engine,
} from "@maleo/shared/editor";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";

/** The engine and a document handle holding `doc`. */
export interface CanvasDocument {
	engine: Engine;
	handle: number;
}

export function canvasDocument(doc: EditorDoc): CanvasDocument {
	const engine = editorEngine();
	return { engine, handle: documentHandle(doc, engine) };
}

/** The layout a target edits (`canvasClipLayout`). */
export function canvasLayoutOf(doc: EditorDoc, target: CanvasTarget): CanvasLayout | null {
	const { engine, handle } = canvasDocument(doc);
	return canvasLayout(engine, handle, target);
}

/** The command a layout change makes on `doc` (`canvasEditCommand`). */
export function canvasEditOf(
	doc: EditorDoc,
	target: CanvasTarget,
	patch: Partial<ClipLayout>,
	time?: number,
): EditorCommand {
	const { engine, handle } = canvasDocument(doc);
	return canvasEdit(engine, handle, target, patch, time);
}

/** `doc` with a static layout change applied (`patchCanvasLayout`); `doc` itself
 *  when the change is refused or changes nothing. */
export function canvasPatchedDoc(
	doc: EditorDoc,
	target: CanvasTarget,
	patch: Partial<ClipLayout>,
): EditorDoc {
	return applyCommand(documentScope(doc), canvasEditOf(doc, target, patch)).doc;
}

/** `resizeLayoutValue`: an aspect-locked size field scales both sides. */
export function canvasSizePatchOf(
	layout: Pick<ClipLayout, "widthPct" | "heightPct" | "aspectLocked">,
	axis: "widthPct" | "heightPct",
	value: number,
): Partial<ClipLayout> {
	return canvasSizePatch(editorEngine(), layout, axis, value);
}
