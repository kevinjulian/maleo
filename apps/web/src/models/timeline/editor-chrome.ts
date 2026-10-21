/* Editor chrome — the parts of the timeline editor that read no document state.
 *
 * Rail navigation, stage sizing, playback speed and the imperative overlay
 * helpers were interleaved with clip assembly and selection in a 2,300-line
 * component, so changing how a panel opens meant reading past the drag handler.
 * None of this needs a document, a store or a player. */

/* Preview speeds live in `timeline-editor-model.ts`, which the toolbar already
 * reads; this module owns how they step, not what they are. */
import { PLAYBACK_RATES } from "./timeline-editor-model.ts";

export type PlaybackRate = (typeof PLAYBACK_RATES)[number];

/** Next speed in the given direction, clamped at both ends. An unknown current
 *  rate is treated as 1×. */
export function stepPlaybackRate(current: number, dir: 1 | -1): PlaybackRate {
	// `findIndex` rather than `indexOf`, because `indexOf` on a readonly tuple
	// only accepts a member and `current` is a plain number — the cast was there
	// to satisfy that signature, not to make a claim. The -1 case below is what
	// actually handles a non-member.
	const i = PLAYBACK_RATES.findIndex((rate) => rate === current);
	const at = i === -1 ? PLAYBACK_RATES.indexOf(1) : i;
	return PLAYBACK_RATES[Math.max(0, Math.min(PLAYBACK_RATES.length - 1, at + dir))]!;
}

/** Which rail destination an Alt+digit press selects, or null when the press is
 *  not one: 1–9 map to the first nine, 0 to the tenth.
 *
 *  Alt rather than Cmd/Ctrl so browser tab switching keeps working, and never
 *  while typing — a digit in a caption field is a digit. */
export function railTargetForKey<T>(
	rail: readonly T[],
	e: { altKey: boolean; metaKey: boolean; ctrlKey: boolean; code: string },
	typing: boolean,
): T | null {
	if (!e.altKey || e.metaKey || e.ctrlKey || typing) return null;
	const digit = e.code.startsWith("Digit") ? Number(e.code.slice(5)) : NaN;
	if (Number.isNaN(digit)) return null;
	return rail[digit === 0 ? 9 : digit - 1] ?? null;
}

/** True when the event target takes text, so a shortcut should stand aside. */
/** A text field that has no pending edit and opts into document undo. */
export function acceptsDocumentUndo(target: EventTarget | null): boolean {
	if (!target || typeof target !== "object" || !("getAttribute" in target)) return false;
	// SAFETY: `getAttribute` was checked above; as in `isTypingTarget`, tests run
	// with no DOM, so `instanceof Element` would throw rather than narrow.
	return (target as Element).getAttribute("data-document-undo") === "clean";
}

export function isTypingTarget(target: EventTarget | null): boolean {
	/* Reads the three properties it needs rather than claiming the target is an
	 * `HTMLElement`. An event target genuinely may not be one — `window` and
	 * `document` both dispatch keydown — and this guard decides whether a
	 * keyboard shortcut fires while someone is typing, so it should check.
	 *
	 * `in` narrowing rather than `instanceof`: this module is imported by tests
	 * that run with no DOM, where `HTMLElement` is not defined and `instanceof`
	 * throws a ReferenceError. What the function needs is the properties, not the
	 * prototype. */
	if (!target || typeof target !== "object") return false;
	const tag = "tagName" in target ? target.tagName : undefined;
	if (tag === "INPUT" || tag === "TEXTAREA") return true;
	return "isContentEditable" in target && target.isContentEditable === true;
}

/** Focused widgets whose own keys (arrows, typeahead letters, Delete) must not edit the timeline. */
const KEY_OWNING_WIDGETS =
	"select,[role=combobox],[role=listbox],[role=slider],[role=spinbutton],[role=separator],[role=menu],[role=menubar],[role=tablist],[role=radiogroup]";

/** True when the focused element is a widget that consumes keyboard input itself. */
export function ownsKeyboard(target: EventTarget | null): boolean {
	if (
		!target ||
		typeof target !== "object" ||
		!("closest" in target) ||
		typeof target.closest !== "function"
	)
		return false;
	return Boolean(target.closest(KEY_OWNING_WIDGETS));
}

/** Timeline height for a pointer at `clientY`, clamped so neither the stage nor
 *  the timeline can be dragged shut. */
export function resolveTimelineHeight(
	stageRect: { bottom: number; height: number },
	clientY: number,
): number {
	const MIN = Math.min(220, stageRect.height / 2);
	const max = Math.max(MIN, Math.floor(stageRect.height - MIN));
	return Math.max(MIN, Math.min(max, stageRect.bottom - clientY));
}

export interface EditorPaneSizes {
	tools: number;
	inspector: number;
	timeline: number;
}

/** Use workspace space, including when desktop chat consumes viewport width. */
export function clampEditorPanes(
	width: number,
	height: number,
	toolsOpen: boolean,
	sizes: EditorPaneSizes,
): EditorPaneSizes {
	const available = Math.max(1, width - 32); // Two 8px gaps and 8px outside padding.
	const scale = Math.min(1, available / ((toolsOpen ? 220 : 41) + 200 + 120));
	const minTools = (toolsOpen ? 220 : 41) * scale;
	const minInspector = 200 * scale;
	const preview = 120 * scale;
	const tools = toolsOpen
		? Math.max(minTools, Math.min(sizes.tools, available - minInspector - preview))
		: minTools;
	const inspector = Math.max(minInspector, Math.min(sizes.inspector, available - tools - preview));
	const usableHeight = Math.max(1, height - 24); // Outside padding and row gap.
	return {
		tools,
		inspector,
		timeline: resolveTimelineHeight(
			{ bottom: usableHeight, height: usableHeight },
			usableHeight - sizes.timeline,
		),
	};
}

/** Keep a context menu inside the viewport. A menu opened near the right or
 *  bottom edge would otherwise render partly offscreen with no way to scroll to it. */
/** A position in viewport pixels. */
export interface Point {
	x: number;
	y: number;
}

export function clampMenuToViewport(
	point: { x: number; y: number },
	size: { width: number; height: number },
	viewport: { width: number; height: number },
): Point {
	const margin = 8;
	return {
		x: Math.max(margin, Math.min(point.x, viewport.width - size.width - margin)),
		y: Math.max(margin, Math.min(point.y, viewport.height - size.height - margin)),
	};
}
