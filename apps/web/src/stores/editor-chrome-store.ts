/* The editor's chrome: which rail is open, how the timeline is laid out, which
 * inspector tab is showing.
 *
 * `timeline-document-store.ts` holds the document and says in its own header
 * that chrome is deliberately not part of it. This is the other half — the same
 * `useSyncExternalStore` shape, so a panel subscribes to the one field it reads
 * instead of receiving it through a component signature.
 *
 * Why a store rather than props: the editor's panels need ~60 values between
 * them, and threading those as props makes a component signature that is the
 * same coupling with more typing. Why not context: a single context re-renders
 * every consumer on any change, and this is the surface where that costs most.
 * Selector subscription is what the document store already does.
 *
 * Transient per-gesture state — a drag in flight, a hovered clip, an open
 * context menu — is NOT here. It dies with the interaction, nothing else reads
 * it, and putting it in a store only widens what can notify.
 */
import { keysOf } from "@maleo/shared";
import { useCallback, useSyncExternalStore } from "react";
import type { MaterialGroup, ClipAnimationProperty } from "@maleo/shared";
import type { KeyframeClipboard } from "@models/timeline/clip-animation-edit.ts";
// The rail and density vocabularies already have a home; this store holds a
// value of each, it does not get to redefine them.
import type { RailKey, TimelineDensity } from "@models/timeline/timeline-editor-model.ts";
import { resolveSetState } from "@models/core/set-state.ts";

export type AssetTab = "media" | "library" | "stock";

/** Which bottom sheet the phone layout is showing, if any.
 *
 *  One value rather than a boolean each, and that is the whole point: these
 *  three all slide up from the same edge, and as independent flags nothing
 *  stopped two being true at once — clip properties and the tools sheet stacked
 *  on top of each other, the lower one visible around the edges of the upper
 *  and both claiming the same scrim. A single value cannot express that state,
 *  so opening one closes the others by construction rather than by every call
 *  site remembering to. */
export type BottomSheet = "none" | "clip-props" | "clip-actions" | "tools";

/** What the Edit Timeline Item modal is pointed at. */
export interface EditTarget {
	type: "scene" | "broll" | "audio" | "text";
	id: number;
}

export type AnimationInspectorTarget =
	| { clipId: string; edge: "in" | "out" }
	| { fromClipId: string; toClipId: string };

export interface EditorChrome {
	/** Which rail destination is showing in the left panel. */
	rail: RailKey;
	/** Which source tab is active inside the Assets rail. */
	assetTab: AssetTab;
	/** Whether the left panel is open at all. */
	panelOpen: boolean;
	/** Row height mode for the timeline tracks. */
	timelineDensity: TimelineDensity;
	/** Height in px of the timeline half of the stage; null = the CSS default. */
	timelineHeight: number | null;
	/** Whether the inspector drawer is open. Opened on demand, not on selection. */
	inspectorOpen: boolean;
	/** Active category in the docked clip panel. */
	clipTab: string;
	clipMaskEditing: boolean;
	/** Keys chosen on the timeline: whole moments (several with Shift or a box), or one property's key when `property` is set. */
	clipKeySelection: { target: string; property?: ClipAnimationProperty; times: number[] } | null;
	/** Per-property key lanes expanded under the selected clip. */
	clipKeyLanesOpen: boolean;
	clipKeyVisual: { sceneId: number; visualId: string } | null;
	clipKeyClipboard: { projectId: string | null; keys: KeyframeClipboard } | null;
	/* Which bottom sheet is showing. Phone only: at desktop width the clip panel
	 * is docked and the tools are a toolbar, so nothing reads this.
	 *
	 * Chrome rather than local state because the three sheets live in three
	 * different components — the stage draws clip properties, the contextual bar
	 * owns clip actions, the transport owns tools — and mutual exclusion between
	 * them cannot be expressed by state that each of them holds privately. */
	bottomSheet: BottomSheet;
	/* A span of the timeline, in seconds, marked out on the ruler — or null.
	 *
	 * This is what replaces multi-select on a coarse pointer. The product already
	 * thought in ranges before it thought in clip sets: `organizeRange` has
	 * always operated on "the selected clips, OR the current scene range", so
	 * multi-select was one of two ways to say something the model already had.
	 * Dropping the weaker one on touch costs less than it looks like it does. */
	timelineRange: { start: number; end: number } | null;
	/** Whether the Project Materials drawer is open. */
	materialsOpen: boolean;
	/* Which material group the drawer opens on, or null for the scan view. A
	 * regenerate flow sets this so the material behind the image is reachable
	 * BEFORE the operator regenerates, rather than after they wonder why. */
	materialsGroup: MaterialGroup | null;
	/** Whether the aspect-ratio menu is open. */
	aspectOpen: boolean;
	/** The scene the preview is showing. Follows the playhead; undefined until the
	 *  first scene exists, which the editor's own effect settles. */
	previewSceneId: number | undefined;
	/** Preview playback speed. J/K/L shuttle steps through PLAYBACK_RATES. */
	playbackRate: number;
	/** Whether drags and trims snap to candidates. Remembered per browser. */
	snapping: boolean;
	/** Whether trims and deletes close the gap behind them. Remembered per browser. */
	rippleEditing: boolean;
	/** The clip the Edit Timeline Item modal is open on, or null. */
	editTarget: EditTarget | null;
	/* The three edit popovers, each keyed by the clip it is open on. They outlive
	 * the gesture that opened them — a double-click opens one and it stays until
	 * dismissed — so they are chrome, unlike the right-click menus, which die with
	 * the pointer and stay local to the editor. */
	transitionEditId: number | null;
	animationInspector: AnimationInspectorTarget | null;
	effectEdit: { id: number } | null;
}

export const DEFAULT_CHROME: EditorChrome = {
	rail: "chat",
	assetTab: "media",
	panelOpen: true,
	timelineDensity: "comfortable",
	timelineHeight: null,
	inspectorOpen: false,
	clipTab: "content",
	clipMaskEditing: false,
	clipKeySelection: null,
	clipKeyVisual: null,
	clipKeyLanesOpen: false,
	clipKeyClipboard: null,
	bottomSheet: "none",
	timelineRange: null,
	materialsOpen: false,
	materialsGroup: null,
	aspectOpen: false,
	previewSceneId: undefined,
	playbackRate: 1,
	snapping: true,
	rippleEditing: false,
	editTarget: null,
	transitionEditId: null,
	animationInspector: null,
	effectEdit: null,
};

export type ChromeUpdater = (chrome: EditorChrome) => EditorChrome;

export interface EditorChromeStore {
	get: () => EditorChrome;
	/** Replace the chrome, immutably. No-op when the next value is identical. */
	set: (next: EditorChrome | ChromeUpdater) => void;
	/** Set one field. The common case, and the one that reads clearly at a call site. */
	patch: <K extends keyof EditorChrome>(
		key: K,
		value: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K]),
	) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createEditorChromeStore(initial?: Partial<EditorChrome>): EditorChromeStore {
	let chrome: EditorChrome = { ...DEFAULT_CHROME, ...initial };
	const listeners = new Set<() => void>();

	const get = (): EditorChrome => chrome;

	const set = (next: EditorChrome | ChromeUpdater): void => {
		const resolved = typeof next === "function" ? next(chrome) : next;
		if (resolved === chrome) return;
		// A patch that lands the same value must not notify: the editor writes
		// chrome on pointer moves, and a no-op notify re-renders the timeline.
		let changed = false;
		for (const k of keysOf(resolved)) {
			if (resolved[k] !== chrome[k]) {
				changed = true;
				break;
			}
		}
		if (!changed) return;
		chrome = resolved;
		for (const l of listeners) l();
	};

	const patch: EditorChromeStore["patch"] = (key, value) => {
		const prev = chrome[key];
		const nextValue = resolveSetState(value, prev);
		if (nextValue === prev) return;
		set({ ...chrome, [key]: nextValue });
	};

	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	return { get, set, patch, subscribe };
}

/** Subscribe to one field. A panel that reads `rail` does not re-render when the
 *  timeline height changes. */
function useChrome<K extends keyof EditorChrome>(
	store: EditorChromeStore,
	key: K,
): EditorChrome[K] {
	const getSnapshot = useCallback(() => store.get()[key], [store, key]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** A setter for one field, WITHOUT subscribing to it.
 *
 * `useChromeField` returns a pair, so a component that only writes a field still
 * subscribes to it and re-renders whenever anything else changes it. Four fields
 * in `timeline-tracks.tsx` were held that way and immediately voided —
 * `void editTarget; void transitionEditId; …` — which is a subscription bought
 * for nothing on a component of several hundred lines.
 *
 * Reach for this when a component opens something it does not itself render. */
export function useChromeSetter<K extends keyof EditorChrome>(
	store: EditorChromeStore,
	key: K,
): (value: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K])) => void {
	return useCallback(
		(next: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K])) =>
			store.patch(key, next),
		[store, key],
	);
}

/** One field as a `useState`-shaped pair, so a call site that used to hold this
 *  in local state reads identically after it moves into the store. */
export function useChromeField<K extends keyof EditorChrome>(
	store: EditorChromeStore,
	key: K,
): [
	EditorChrome[K],
	(value: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K])) => void,
] {
	const value = useChrome(store, key);
	const setValue = useCallback(
		(next: EditorChrome[K] | ((prev: EditorChrome[K]) => EditorChrome[K])) =>
			store.patch(key, next),
		[store, key],
	);
	return [value, setValue];
}
