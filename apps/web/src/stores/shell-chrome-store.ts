/* The create shell's chrome: which panels are open, which editor mode is
 * showing, what the save and render flows are reporting.
 *
 * The same shape and the same reasoning as `editor-chrome-store.ts` beside it,
 * for the other half of the surface. That store holds the TIMELINE's chrome —
 * rail, density, inspector tab — and a text or image project has no timeline, so
 * it should not subscribe to a store full of timeline fields to learn its save
 * state. Two stores, split where the surfaces actually split.
 *
 * Why a store rather than props: the shell held these as thirteen `useState`
 * calls, so any region extracted from it had to take them as a signature. The
 * ceiling `AGENTS.md` names is a component that would take sixty props: it has
 * not been decomposed, it has been renamed. Per-field subscription means a
 * region reads what it reads.
 *
 * What is NOT here: `trackFlags`, which looks like chrome and is not — it is
 * written into the persisted storyboard, read back from `doc.trackFlags`, and
 * decides what a render contains, so it belongs to the document store. Nor the
 * form's own fields (type, title, description, format, preset): those are
 * collected, submitted and discarded. Nor transient per-gesture state, for the
 * reason the timeline's store gives.
 */
import { keysOf } from "@maleo/shared";
import { useCallback, useSyncExternalStore } from "react";
import type { SaveState } from "@models/content/create-content-model.ts";
import type { RenderQueueStatus } from "@models/render/render-queue.ts";

/** Video editor views. Storyboard owns plan draft; other views render execution state. */
export type EditorMode = "storyboard" | "script" | "timeline" | "studio";

import type { ExportConnection } from "@models/video/render-job.ts";

export interface ShellChrome {
	exportConnection: ExportConnection;
	exportOrigin: "server" | "browser";
	exportError: string | null;
	/** Whether the left tool rail is open. */
	railOpen: boolean;
	/** Whether the chat panel is open. Collapsible on every content type. */
	chatOpen: boolean;
	/** Which video editing view is showing. Image and text use studio/workspace. */
	editorMode: EditorMode;
	/** What the autosave last reported. */
	saveState: SaveState;
	/** The last error worth showing the operator, or null. */
	saveError: string | null;
	/** A submit (render or publish) is in flight. */
	submitting: boolean;
	/** `createProject` is in flight; guards a double create. */
	creating: boolean;
	/** The last agent run failed, so the retry affordance shows. */
	agentFailed: boolean;
	/** A render is in flight. Decides what the export button does. */
	rendering: boolean;
	/** The active render job's progress, or null. */
	renderStatus: RenderQueueStatus | null;
	/** The job being polled, or null. */
	renderJobId: string | null;
	/** Whether the render status modal is open. */
	renderInfoOpen: boolean;
	/** Whether the export menu is open. */
	exportMenuOpen: boolean;
}

export const DEFAULT_SHELL_CHROME: ShellChrome = {
	exportConnection: "idle",
	exportOrigin: "server",
	exportError: null,
	railOpen: false,
	chatOpen: true,
	editorMode: "timeline",
	saveState: "idle",
	saveError: null,
	submitting: false,
	creating: false,
	agentFailed: false,
	rendering: false,
	renderStatus: null,
	renderJobId: null,
	renderInfoOpen: false,
	exportMenuOpen: false,
};

export type ShellChromeUpdater = (chrome: ShellChrome) => ShellChrome;

export interface ShellChromeStore {
	get: () => ShellChrome;
	/** Replace the chrome, immutably. No-op when nothing actually changed. */
	set: (next: ShellChrome | ShellChromeUpdater) => void;
	/** Set one field. The common case, and the one that reads clearly at a call site. */
	patch: <K extends keyof ShellChrome>(
		key: K,
		value: ShellChrome[K] | ((prev: ShellChrome[K]) => ShellChrome[K]),
	) => void;
	subscribe: (listener: () => void) => () => void;
}

export function createShellChromeStore(initial?: Partial<ShellChrome>): ShellChromeStore {
	let chrome: ShellChrome = { ...DEFAULT_SHELL_CHROME, ...initial };
	const listeners = new Set<() => void>();

	const get = (): ShellChrome => chrome;

	const set = (next: ShellChrome | ShellChromeUpdater): void => {
		const resolved = typeof next === "function" ? next(chrome) : next;
		if (resolved === chrome) return;
		// A write that lands the same value must not notify: the render poll writes
		// status on an interval, and a no-op notify re-renders the whole shell.
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

	const patch: ShellChromeStore["patch"] = (key, value) => {
		const prev = chrome[key];
		// SAFETY: no chrome field holds a function, so a function here is the updater form
		// of the `SetStateAction` the signature accepts.
		const nextValue =
			typeof value === "function" ? (value as (p: typeof prev) => typeof prev)(prev) : value;
		if (nextValue === prev) return;
		set({ ...chrome, [key]: nextValue });
	};

	const subscribe = (listener: () => void): (() => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};

	return { get, set, patch, subscribe };
}

/** Subscribe to one field. A topbar that reads `saveState` does not re-render
 *  when the export menu opens. */
export function useShellChrome<K extends keyof ShellChrome>(
	store: ShellChromeStore,
	key: K,
): ShellChrome[K] {
	const getSnapshot = useCallback(() => store.get()[key], [store, key]);
	return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot);
}

/** One field as a `useState`-shaped pair, so a call site that used to hold this
 *  in local state reads identically after it moves into the store. */
export function useShellChromeField<K extends keyof ShellChrome>(
	store: ShellChromeStore,
	key: K,
): [ShellChrome[K], (value: ShellChrome[K] | ((prev: ShellChrome[K]) => ShellChrome[K])) => void] {
	const value = useShellChrome(store, key);
	const setValue = useCallback(
		(next: ShellChrome[K] | ((prev: ShellChrome[K]) => ShellChrome[K])) => store.patch(key, next),
		[store, key],
	);
	return [value, setValue];
}
