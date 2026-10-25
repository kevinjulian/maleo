/* Canvas editing in the engine (`p2-preview-editing`), typed over the raw
 * `canvas_*` calls in `engine.ts`.
 *
 * A canvas handle holds the view and the gesture in progress. The host sends
 * each pointer, touch or key event with the playhead time and the selection,
 * and draws what comes back: the box, its handles and the snap guides; a
 * selection action to apply through the selection rules; `preview`, the
 * command the gesture would commit now (run on a copy of the document, never
 * recorded); and on release `commit`, the command to apply as one undo step. */
import type { ClipLayout } from "../timeline-model.ts";
import type { EditorCommand } from "./commands.ts";
import type { Engine, EngineResult } from "./engine.ts";

export interface CanvasTarget {
	source: "scene" | "video" | "text";
	id: number;
	visualId?: string;
}

/** Where the canvas sits on the screen, in logical pixels. */
export interface CanvasView {
	area: { x: number; y: number; width: number; height: number };
	/** Canvas width over height. */
	aspect: number;
	fit?: "contain" | "cover";
	zoom?: number;
	pan?: { x: number; y: number };
	/** Device pixels per logical pixel; event points are in device pixels. */
	density?: number;
	handleSize?: number;
	/** Corner handles sit outside the box corners (a coarse pointer). */
	handlesOutside?: boolean;
}

export type CanvasHandleId = "move" | "rotate" | "nw" | "ne" | "sw" | "se";

/** A box in canvas percent, drawn as CSS draws one: left/top/width/height, rotated and scaled about its centre. */
export interface CanvasBox {
	xPct: number;
	yPct: number;
	widthPct: number;
	heightPct: number;
	rotationDeg: number;
	scale: number;
	locked: boolean;
	source?: CanvasTarget["source"];
	id?: number;
	visualId?: string;
	/** The interactive box only. */
	kind?: "element" | "mask" | "group";
	handles?: { id: Exclude<CanvasHandleId, "move">; xPct: number; yPct: number }[];
}

export interface CanvasOverlay {
	/** The box the selection is edited through, with its handles. */
	box: CanvasBox | null;
	/** Each member's outline, for a multi-selection. */
	members: CanvasBox[];
	guides: { x: number | null; y: number | null };
	/** A selected element is animated: its box follows the playhead. */
	animated: boolean;
}

/** A selection action for `selection_apply` (`selection-model.ts`). */
export type CanvasSelectAction =
	| { type: "selectClip" | "toggleClip"; source: CanvasTarget["source"]; refId: number }
	| { type: "selectScene"; sceneId: number }
	| { type: "clear" };

export interface CanvasResult {
	overlay: CanvasOverlay;
	select: CanvasSelectAction | null;
	preview: EditorCommand | null;
	commit: EditorCommand | null;
	/** The engine used the event; the host prevents its default. */
	handled: boolean;
}

/** What every event and overlay read carries. */
export interface CanvasContext {
	time: number;
	/** The editor selection (`Selection`), or explicit targets. */
	selection?: unknown;
	targets?: CanvasTarget[];
	/** The scene visual the keyframe panel edits. */
	visual?: { sceneId: number; visualId: string } | null;
	mask?: boolean;
	shift?: boolean;
	alt?: boolean;
	/** The document handle, when the host reopened its document. */
	doc?: number;
}

export type CanvasEvent = CanvasContext &
	(
		| { type: "down" | "move" | "up" | "cancel"; x: number; y: number }
		| { type: "key"; key: string; handle?: CanvasHandleId }
		| { type: "pinch"; scale: number }
		| { type: "twist"; angle: number }
	);

export interface CanvasSession {
	readonly handle: number;
	view(view: CanvasView): void;
	input(event: CanvasEvent): CanvasResult;
	overlay(context: CanvasContext): CanvasOverlay;
	close(): void;
}

export class CanvasEngineError extends Error {
	constructor(
		readonly kind: string,
		message: string,
	) {
		super(`${kind}: ${message}`);
		this.name = "CanvasEngineError";
	}
}

function ok<T>(result: EngineResult<T>): T {
	if (!result.ok) throw new CanvasEngineError(result.error.kind, result.error.message);
	return result.value;
}

/** Open a canvas over document handle `doc`. Throws `CanvasEngineError` on a refusal. */
export function openCanvas(engine: Engine, doc: number): CanvasSession {
	const handle = ok(engine.canvasOpen(doc));
	return {
		handle,
		view: (view) => ok(engine.canvasView(handle, JSON.stringify(view))),
		// SAFETY: `{overlay, select, preview, commit, handled}` as `Session::input` writes it.
		input: (event) =>
			JSON.parse(ok(engine.canvasInput(handle, JSON.stringify(event)))) as CanvasResult,
		// SAFETY: `{box, members, guides}` as `Session::overlay` writes it.
		overlay: (context) =>
			JSON.parse(ok(engine.canvasOverlay(handle, JSON.stringify(context)))) as CanvasOverlay,
		close: () => ok(engine.canvasClose(handle)),
	};
}

/** The layout a target edits (`canvasClipLayout`). */
export interface CanvasLayout {
	clipId: string;
	layout: Partial<ClipLayout> | null;
	/** Timeline seconds where the layout's key time 0 sits. */
	start: number;
	duration: number;
	kind: "scene" | "image" | "video" | "text";
	visualId: string | null;
}

export function canvasLayout(
	engine: Engine,
	doc: number,
	target: CanvasTarget,
): CanvasLayout | null {
	// SAFETY: `canvas_layout` writes a `CanvasLayout` or `null`.
	return JSON.parse(
		ok(engine.canvasLayout(doc, JSON.stringify({ target }))),
	) as CanvasLayout | null;
}

/** The command a layout change makes: keys at `time` for what is keyed, a static
 *  replace for the rest, `noop` when refused. A field set to `undefined` is cleared. */
export function canvasEdit(
	engine: Engine,
	doc: number,
	target: CanvasTarget,
	patch: Partial<ClipLayout>,
	time?: number,
): EditorCommand {
	const unset = Object.entries(patch)
		.filter(([, value]) => value === undefined)
		.map(([key]) => key);
	const request = {
		target,
		patch,
		...(unset.length ? { unset } : {}),
		...(time === undefined ? {} : { time }),
	};
	// SAFETY: `canvas_edit` writes a command the engine built.
	return JSON.parse(ok(engine.canvasEdit(doc, JSON.stringify(request)))) as EditorCommand;
}

/** `resizeLayoutValue`: an aspect-locked size field scales both sides. */
export function canvasSizePatch(
	engine: Engine,
	layout: Pick<ClipLayout, "widthPct" | "heightPct" | "aspectLocked">,
	axis: "widthPct" | "heightPct",
	value: number,
): Partial<ClipLayout> {
	// SAFETY: `canvas_size_patch` writes `{widthPct?, heightPct?}`.
	return JSON.parse(
		ok(engine.canvasSizePatch(JSON.stringify({ layout, axis, value }))),
	) as Partial<ClipLayout>;
}
