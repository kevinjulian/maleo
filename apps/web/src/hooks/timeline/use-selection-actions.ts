/* The selection actions the timeline, the canvas and the chat all invoke.
 *
 * They are together because they share one rule that is easy to get wrong at a
 * call site: selecting something seeks the playhead ONLY when the playhead is
 * outside what was selected. Clicking a clip you are already inside must not
 * yank the playhead to its start.
 *
 * The writes all go through the selection model (`selection-model.ts`), which
 * is where "selecting one kind clears the others" lives instead of at seven
 * call sites.
 *
 * Split out of `timeline-editor.tsx`.
 */
import type { PrimaryClipSource } from "@models/timeline/selection-model.ts";
import type { Dispatch, SetStateAction } from "react";
import {
	EMPTY_SELECTION,
	clearSelection as clearSelectionIn,
	openSceneEditor as openSceneEditorIn,
	selectClip as selectClipIn,
	selectScene as selectSceneIn,
	toggleClip as toggleClipIn,
	type Selection,
} from "@models/timeline/selection-model.ts";
import { parseClipId } from "@models/timeline/timeline-clips.ts";
import { resequenceScenes } from "@maleo/shared";
import type { Scene } from "@maleo/shared";
import type { ChatLogMessage } from "@models/chat/chat-log.ts";
import type { RailKey, ToggleCat } from "@models/timeline/timeline-editor-model.ts";
import type { selectDerivedArrays } from "@stores/timeline-document-store.ts";
import type { ChatSession } from "@hooks/editor/use-chat-session.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import type { usePreviewComposition } from "./use-preview-composition.ts";

type Derived = ReturnType<typeof selectDerivedArrays>;

export interface SelectionActionsInput {
	removeCaption: (id: string) => void;
	scenes: Scene[];
	overlays: Derived["textOverlays"];
	audioOverlays: Derived["audioOverlays"];
	videoOverlays: Derived["videoOverlays"];
	effects: Derived["effects"];
	setScenes: Dispatch<SetStateAction<Scene[]>>;
	setSelection: Dispatch<SetStateAction<Selection>>;
	setPreviewSceneId: (id: number | undefined) => void;
	setInspectorOpen: (open: boolean) => void;
	setRail: Dispatch<SetStateAction<RailKey>>;
	setPanelOpen: (open: boolean) => void;
	sceneStart: (id: number) => number;
	seekPreview: ReturnType<typeof usePreviewComposition>["seekPreview"];
	playhead: PlayheadHandle;
	selectedFreeIds: Set<string>;
	selectedFreeId: string | null;
	chat: ChatSession;
	removeVideoOverlay: (id: number) => void;
	removeOverlay: (id: number) => void;
	removeAudio: (id: number) => void;
	removeEffect: (id: number) => void;
}

export interface SelectionActions {
	selectScene: (sceneId: number) => void;
	selectFreeClip: (
		source: PrimaryClipSource | "caption",
		refId: number | string,
		start: number,
	) => void;
	toggleFreeClip: (
		source: "video" | "text" | "audio" | "effect" | "scene" | "caption",
		refId: number | string,
	) => void;
	clearSelection: () => void;
	isClipSelected: (id: string) => boolean;
	removeFreeClipById: (id: string) => void;
	openSceneEditor: (sceneId: number) => void;
	showInChat: (label: string, ref?: ChatLogMessage["ref"]) => void;
	jumpToClip: (ref: NonNullable<ChatLogMessage["ref"]>) => void;
	toggleSceneRef: (sceneId: number, cat: ToggleCat, id: string) => void;
}

export function useSelectionActions({
	removeCaption,
	scenes,
	overlays,
	audioOverlays,
	videoOverlays,
	effects,
	setScenes,
	setSelection,
	setPreviewSceneId,
	setInspectorOpen,
	setRail,
	setPanelOpen,
	sceneStart,
	seekPreview,
	playhead,
	selectedFreeIds,
	selectedFreeId,
	chat,
	removeVideoOverlay,
	removeOverlay,
	removeAudio,
	removeEffect,
}: SelectionActionsInput): SelectionActions {
	const selectScene = (sceneId: number): void => {
		setPreviewSceneId(sceneId);
		// Match clip-select behavior: only seek when the playhead is outside the
		// scene span, so selecting a scene doesn't yank the playhead to its start.
		const start = sceneStart(sceneId);
		const dur = Math.max(1, scenes.find((s) => s.id === sceneId)?.dur ?? 0);
		const at = playhead.get();
		if (!(at >= start && at <= start + dur)) seekPreview(start);
		setSelection(selectSceneIn(sceneId));
	};
	// clip-first single click: select the clip + preview it, but do NOT open any
	// drawer (the Controls button does that). Selecting also seeks so the preview
	// reflects the clip even when the playhead was elsewhere.
	const selectFreeClip = (
		source: PrimaryClipSource | "caption",
		refId: number | string,
		start: number,
	): void => {
		if (source === "caption") {
			if (typeof refId !== "string") throw new Error("Caption identity must be a string");
			setSelection({ ...EMPTY_SELECTION, freeIds: new Set([refId]) });
			seekPreview(start);
			return;
		}
		if (typeof refId !== "number") throw new Error("Clip identity must be numeric");
		/* Every family this can be handed is looked up in its own collection, so
		 * the duration that decides the seek below is the clicked clip's own. */
		const selected =
			source === "video"
				? videoOverlays.find((v) => v.id === refId)
				: source === "text"
					? overlays.find((o) => o.id === refId)
					: source === "audio"
						? audioOverlays.find((a) => a.id === refId)
						: effects.find((e) => e.id === refId);
		const dur = selected?.dur ?? 0;
		setSelection(selectClipIn(source, refId));
		const at = playhead.get();
		if (!(dur > 0 && at >= start && at <= start + dur)) seekPreview(start);
	};
	// Shift-click: toggle a free clip in the multi-select set + make it primary.
	const toggleFreeClip = (
		source: "video" | "text" | "audio" | "effect" | "scene" | "caption",
		refId: number | string,
	): void => {
		if (source === "caption") {
			if (typeof refId !== "string") throw new Error("Caption identity must be a string");
			setSelection((prev) => {
				const freeIds = new Set(prev.freeIds);
				if (freeIds.has(refId)) freeIds.delete(refId);
				else freeIds.add(refId);
				return { ...prev, freeIds };
			});
			return;
		}
		if (typeof refId !== "number") throw new Error("Clip identity must be numeric");
		setSelection((prev) => toggleClipIn(prev, source, refId));
	};
	// Click an empty area / Esc → clear everything, hide Edit + Controls.
	const clearSelection = (): void => {
		setSelection(clearSelectionIn());
		setInspectorOpen(false);
	};
	// A clip is "selected" when it's the primary OR part of the multi-select set.
	const isClipSelected = (id: string): boolean => selectedFreeIds.has(id) || selectedFreeId === id;
	// Remove a free clip by its "source:refId" id.
	const removeFreeClipById = (id: string): void => {
		if (id.startsWith("caption:")) {
			removeCaption(id);
			return;
		}
		const p = parseClipId(id);
		if (!p) return;
		if (p.source === "video") removeVideoOverlay(p.refId);
		else if (p.source === "text") removeOverlay(p.refId);
		else if (p.source === "audio") removeAudio(p.refId);
		else if (p.source === "effect") removeEffect(p.refId);
	};
	const openSceneEditor = (sceneId: number): void => {
		setSelection(openSceneEditorIn(sceneId));
		setPreviewSceneId(sceneId);
	};
	// "Show in chat" — drop a clickable reference line into the chat log.
	const showInChat = (label: string, ref?: ChatLogMessage["ref"]): void => {
		chat.setMessages((m) => [
			...m,
			{
				id: m.reduce((a, x) => Math.max(a, x.id), 0) + 1,
				role: "assistant",
				text: `Linked clip: ${label}`,
				ref,
			},
		]);
		setRail("chat");
		setPanelOpen(true);
	};
	// Reverse link — clicking a chat reference selects + seeks to the clip.
	const jumpToClip = (ref: NonNullable<ChatLogMessage["ref"]>): void => {
		if (ref.type === "scene") selectScene(ref.id);
		else if (ref.type === "broll") {
			const v = videoOverlays.find((x) => x.id === ref.id);
			if (v) {
				setSelection(selectClipIn("video", ref.id));
				seekPreview(v.start);
			}
		} else if (ref.type === "audio") {
			const a = audioOverlays.find((x) => x.id === ref.id);
			if (a) {
				setSelection(selectClipIn("audio", ref.id));
				seekPreview(a.start);
			}
		} else {
			const o = overlays.find((x) => x.id === ref.id);
			if (o) {
				setSelection(selectClipIn("text", ref.id));
				seekPreview(o.start);
			}
		}
	};
	const toggleSceneRef = (sceneId: number, cat: ToggleCat, id: string): void => {
		const field = cat === "image" ? "refIds" : cat === "voice" ? "voiceIds" : "noteIds";
		setScenes((ss) =>
			resequenceScenes(
				ss.map((scene) => {
					if (scene.id !== sceneId) return scene;
					const list = scene[field] ?? [];
					return {
						...scene,
						[field]: list.includes(id) ? list.filter((x) => x !== id) : [...list, id],
					};
				}),
			),
		);
	};
	return {
		selectScene,
		selectFreeClip,
		toggleFreeClip,
		clearSelection,
		isClipSelected,
		removeFreeClipById,
		openSceneEditor,
		showInChat,
		jumpToClip,
		toggleSceneRef,
	};
}
