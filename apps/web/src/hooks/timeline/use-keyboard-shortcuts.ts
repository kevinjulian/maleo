/* NLE keyboard shortcuts: copy/paste/duplicate, split, play/pause, delete (lift +
 * ripple), transition/effect/clip removal, and arrow-key nudge. Extracted verbatim
 * from TimelineEditor; every handler + selection value is injected so the effect's
 * dependency array is preserved exactly. */
import { useEffect } from "react";
import { isStudioModalActive } from "@models/timeline/studio-modal-active.ts";
import { parseClipId, type TimelineClip } from "@models/timeline/timeline-clips.ts";
import type { Scene } from "@maleo/shared";
import type { ClipboardItem } from "./use-clip-ops.ts";
import { isTypingTarget, ownsKeyboard } from "@models/timeline/editor-chrome.ts";

type ClipSource = "video" | "text" | "audio" | "effect" | "scene" | "caption";

interface KeyboardShortcutsOptions {
	importFiles: (files: File[]) => void;
	editTarget: { type: "scene" | "broll" | "audio" | "text"; id: number } | null;
	clipboard: ClipboardItem[];
	selectedFreeIds: Set<string>;
	selectedFreeId: string | null;
	selectedOverlayId: number | null;
	selectedAudioId: number | null;
	selectedVideoOvId: number | null;
	selectedEffectId: number | null;
	selectedTransition: number | null;
	editorScene: Scene | undefined;
	freeClips: TimelineClip[];
	total: number;
	togglePlay: () => void;
	zoomIn: () => void;
	zoomOut: () => void;
	fitToWidth: (totalSec: number) => void;
	seekTo: (sec: number) => void;
	/** J/K/L shuttle: -1 slower, +1 faster (K maps to togglePlay). */
	stepPlaybackRate: (dir: 1 | -1) => void;
	selectionIds: () => string[];
	copySelection: () => void;
	pasteClipboard: () => void;
	duplicateSelection: () => void;
	splitAtPlayhead: () => void;
	trimAtPlayhead: (side: "before" | "after") => void;
	/** Delete the selection the way the ripple mode says; `shift` inverts it. */
	deleteByMode: (shift: boolean) => void;
	clearSelection: () => void;
	removeTransition: (id: number) => void;
	removeEffect: (id: number) => void;
	removeOverlay: (id: number) => void;
	removeAudio: (id: number) => void;
	removeVideoOverlay: (id: number) => void;
	rmScene: (id: number) => void;
	trackLocked: (row?: number) => boolean;
	isLockedClip: (id: string) => boolean;
	setFreeClipPos: (
		source: ClipSource,
		refId: number | string,
		patch: { start?: number; track?: number; dur?: number },
	) => void;
	setSelectedTransition: (id: number | null) => void;
	setSelectedEffectId: (id: number | null) => void;
	setCtxMenu: (v: { x: number; y: number } | null) => void;
}

export function useKeyboardShortcuts(opts: KeyboardShortcutsOptions): void {
	const {
		importFiles,
		editTarget,
		clipboard,
		selectedFreeIds,
		selectedFreeId,
		selectedOverlayId,
		selectedAudioId,
		selectedVideoOvId,
		selectedEffectId,
		selectedTransition,
		editorScene,
		freeClips,
		total,
		togglePlay,
		zoomIn,
		zoomOut,
		fitToWidth,
		seekTo,
		stepPlaybackRate,
		selectionIds,
		copySelection,
		pasteClipboard,
		duplicateSelection,
		splitAtPlayhead,
		trimAtPlayhead,
		deleteByMode,
		clearSelection,
		removeTransition,
		removeEffect,
		removeOverlay,
		removeAudio,
		removeVideoOverlay,
		rmScene,
		trackLocked,
		isLockedClip,
		setFreeClipPos,
		setSelectedTransition,
		setSelectedEffectId,
		setCtxMenu,
	} = opts;

	// NLE keyboard shortcuts: Space toggles playback, Delete removes the selected
	// clip. Ignored while typing or with the Edit modal open.
	useEffect(() => {
		const onEditorCaptureKey = (e: KeyboardEvent): void => {
			if (
				(e.code !== "Space" && e.key !== "Enter") ||
				e.isComposing ||
				isStudioModalActive() ||
				editTarget
			)
				return;
			const target = e.target instanceof Element ? e.target : null;
			const input = target?.closest("input");
			const editable = target?.closest("[contenteditable]");
			const textEntry = input
				? !["button", "submit", "reset", "checkbox", "radio", "range", "color"].includes(input.type)
				: isTypingTarget(e.target) ||
					(editable != null && editable.getAttribute("contenteditable") !== "false");
			if (textEntry) return;
			// Modal/studio controls keep their scope; editor property/option sheets
			// belong to this transport even though their DOM is portalled.
			if (
				target?.closest('[role="dialog"]') &&
				!target.closest(
					".tl2-clip-sheet,.tl2-more-sheet,.tl2-panel-sheet,[data-editor-options=true]",
				)
			)
				return;
			// Checkboxes need an activation key while Space belongs to transport.
			if (e.key === "Enter") {
				const checkbox = target?.closest<HTMLElement>(
					'input[type="checkbox"],button[role="checkbox"]',
				);
				if (!checkbox || e.ctrlKey || e.metaKey || e.altKey) return;
				e.preventDefault();
				e.stopImmediatePropagation();
				if (e.type === "keydown" && !e.repeat) checkbox.click();
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.type === "keydown" && !e.repeat) togglePlay();
		};
		const onKey = (e: KeyboardEvent): void => {
			if (e.code === "Space") return;
			if (isStudioModalActive()) return;
			// The shared helper, rather than a third copy of the same three checks.
			if (e.defaultPrevented || isTypingTarget(e.target) || ownsKeyboard(e.target)) return;
			if (editTarget) return;
			const mod = e.metaKey || e.ctrlKey;
			// Copy/paste use their native events so file paste can take priority.
			if (mod && ["c", "v"].includes(e.key.toLowerCase())) return;
			if (mod && (e.key === "d" || e.key === "D")) {
				if (selectionIds().length) {
					e.preventDefault();
					duplicateSelection();
				}
				return;
			}
			if (mod && (e.key === "b" || e.key === "B")) {
				e.preventDefault();
				splitAtPlayhead();
				return;
			}
			if (!mod && (e.key === "s" || e.key === "S")) {
				e.preventDefault();
				splitAtPlayhead();
				return;
			}
			if (!mod && e.key.toLowerCase() === "q") {
				e.preventDefault();
				trimAtPlayhead("before");
				return;
			}
			if (!mod && e.key.toLowerCase() === "w") {
				e.preventDefault();
				trimAtPlayhead("after");
				return;
			}
			if (!mod && (e.key === "j" || e.key === "J")) {
				e.preventDefault();
				stepPlaybackRate(-1);
				return;
			}
			if (!mod && (e.key === "k" || e.key === "K")) {
				e.preventDefault();
				togglePlay();
				return;
			}
			if (!mod && (e.key === "l" || e.key === "L")) {
				e.preventDefault();
				stepPlaybackRate(1);
				return;
			}
			if (!mod && (e.key === "+" || e.key === "=")) {
				e.preventDefault();
				zoomIn();
				return;
			}
			if (!mod && e.key === "-") {
				e.preventDefault();
				zoomOut();
				return;
			}
			if (!mod && e.key === "0") {
				e.preventDefault();
				fitToWidth(total);
				return;
			}
			if (e.key === "Home") {
				e.preventDefault();
				seekTo(0);
				return;
			}
			if (e.key === "End") {
				e.preventDefault();
				seekTo(total);
				return;
			}
			if (e.key === "Escape") {
				setCtxMenu(null);
				clearSelection();
			} else if (e.key === "Delete" || e.key === "Backspace") {
				// Ripple editing decides whether the gap closes; Shift inverts it.
				if (selectionIds().length > 0) {
					e.preventDefault();
					deleteByMode(e.shiftKey);
				} else if (selectedTransition != null) {
					removeTransition(selectedTransition);
					setSelectedTransition(null);
				} else if (selectedEffectId != null) {
					removeEffect(selectedEffectId);
					setSelectedEffectId(null);
				} else if (selectedOverlayId != null) removeOverlay(selectedOverlayId);
				else if (selectedAudioId != null) removeAudio(selectedAudioId);
				else if (selectedVideoOvId != null) removeVideoOverlay(selectedVideoOvId);
				else if (editorScene && !trackLocked(-1)) rmScene(editorScene.id);
			} else if (selectedFreeId && e.key.startsWith("Arrow")) {
				// Nudge the primary clip: ←/→ time (0.1s, Shift 1s), ↑/↓ track.
				const p = parseClipId(selectedFreeId);
				const cur = freeClips.find((fc) => fc.id === selectedFreeId);
				if (p?.source === "scene" || !cur || isLockedClip(selectedFreeId)) return;
				e.preventDefault();
				if (e.key === "ArrowUp" || e.key === "ArrowDown")
					setFreeClipPos(cur.source, cur.refId, {
						track: Math.max(0, cur.track + (e.key === "ArrowDown" ? 1 : -1)),
					});
				else {
					const step = (e.shiftKey ? 1 : 0.1) * (e.key === "ArrowRight" ? 1 : -1);
					setFreeClipPos(cur.source, cur.refId, {
						start: Math.max(0, Math.min(total, Math.round((cur.start + step) * 10) / 10)),
					});
				}
			}
		};
		const available = (event: Event) =>
			!event.defaultPrevented &&
			!isStudioModalActive() &&
			!isTypingTarget(event.target) &&
			!editTarget;
		const onCopy = (event: ClipboardEvent): void => {
			// Highlighted page text is the user's copy target, never the clip clipboard.
			if (
				!available(event) ||
				!selectionIds().length ||
				window.getSelection()?.isCollapsed === false
			)
				return;
			event.preventDefault();
			event.clipboardData?.setData("text/plain", "maleo:clip-clipboard");
			copySelection();
		};
		const onPaste = (event: ClipboardEvent): void => {
			if (!available(event)) return;
			const files = Array.from(event.clipboardData?.files ?? []);
			if (files.length) {
				event.preventDefault();
				importFiles(files);
			} else if (clipboard.length) {
				event.preventDefault();
				pasteClipboard();
			}
		};
		window.addEventListener("keydown", onEditorCaptureKey, true);
		window.addEventListener("keyup", onEditorCaptureKey, true);
		window.addEventListener("keydown", onKey);
		window.addEventListener("copy", onCopy);
		window.addEventListener("paste", onPaste);
		return () => {
			window.removeEventListener("keydown", onEditorCaptureKey, true);
			window.removeEventListener("keyup", onEditorCaptureKey, true);
			window.removeEventListener("keydown", onKey);
			window.removeEventListener("copy", onCopy);
			window.removeEventListener("paste", onPaste);
		};
	}, [
		importFiles,
		editTarget,
		selectedFreeIds,
		selectedFreeId,
		freeClips,
		clipboard,
		selectedOverlayId,
		selectedAudioId,
		selectedVideoOvId,
		selectedEffectId,
		selectedTransition,
		editorScene,
		total,
		togglePlay,
		zoomIn,
		zoomOut,
		fitToWidth,
		seekTo,
		stepPlaybackRate,
		trimAtPlayhead,
	]);
}
