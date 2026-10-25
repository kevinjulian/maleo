/* The document the canvas engine reads (`p2-preview-editing`).
 *
 * Canvas and inspector calls name a document handle. One follower handle per
 * page holds the store's current document and is reopened only when the
 * document changes, so a pointer move does not admit the document again. The
 * other parts of the scope are fixed empty lists: the canvas rules read only
 * the document. */
import type { ClipLayout } from "@maleo/shared";
import {
	applyCommand,
	canvasEdit,
	canvasLayout,
	canvasSizePatch,
	editorEngine,
	engineExecutor,
	type CanvasLayout,
	type CanvasTarget,
	type EditorCommand,
	type EditScope,
	type Engine,
	type EngineExecutor,
} from "@maleo/shared/editor";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";

const NONE: never[] = [];
const scopes = new WeakMap<EditorDoc, EditScope>();
let follower: { engine: Engine; executor: EngineExecutor } | undefined;

/** `doc` as the scope the follower compares by identity. */
function scopeOf(doc: EditorDoc): EditScope {
	let scope = scopes.get(doc);
	if (!scope) {
		scope = { doc, slides: NONE, posts: NONE, mediaAssets: NONE };
		scopes.set(doc, scope);
	}
	return scope;
}

/** The engine and a document handle holding `doc`. */
export interface CanvasDocument {
	engine: Engine;
	handle: number;
}

export function canvasDocument(doc: EditorDoc): CanvasDocument {
	const engine = editorEngine();
	if (follower?.engine !== engine) follower = { engine, executor: engineExecutor(engine) };
	return { engine, handle: follower.executor.handleFor(scopeOf(doc)) };
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
	return applyCommand(scopeOf(doc), canvasEditOf(doc, target, patch)).doc;
}

/** `resizeLayoutValue`: an aspect-locked size field scales both sides. */
export function canvasSizePatchOf(
	layout: Pick<ClipLayout, "widthPct" | "heightPct" | "aspectLocked">,
	axis: "widthPct" | "heightPct",
	value: number,
): Partial<ClipLayout> {
	return canvasSizePatch(editorEngine(), layout, axis, value);
}
