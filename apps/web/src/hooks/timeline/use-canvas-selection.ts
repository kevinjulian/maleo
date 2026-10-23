/* What the canvas can select, and what the selected thing lets you edit.
 *
 * The preview is a single surface with several clip families layered on it, so
 * "the selected clip" has to be resolved by priority — b-roll overlay, then
 * text, then the base scene — and each family needs its own
 * writer for the layout the bounding box drags. That resolution is here rather
 * than in the stage because the timeline reads the same answer.
 *
 * The hit boxes are the other half, and they are NOT here: they depend on the
 * playhead, and the editor calls this hook, so keeping them here meant the
 * editor knew the current time and re-rendered at frame rate to hold it. They
 * live in `use-canvas-hit-clips.ts`, called by the stage that draws them.
 */
import type { ClipKind, ClipLayout } from "@models/timeline/clip-layout.ts";
import type { Scene, TextOverlay } from "@maleo/shared";
import type { useAudioOps } from "./use-audio-ops.ts";
import type { useVideoOverlayOps } from "./use-video-overlay-ops.ts";
import { patchCanvasLayout, type CanvasTarget } from "@models/timeline/canvas-transform.ts";
import type { DocUpdater } from "@models/storyboard/editor-doc.ts";

export interface CanvasSelectionInput {
	mutateDoc: (edit: DocUpdater) => void;
	scenes: Scene[];
	selectedSceneId?: number;
	selectedOverlay: TextOverlay | null;
	selectedAudio: ReturnType<typeof useAudioOps>["selectedAudio"];
	selectedVideoOverlay: ReturnType<typeof useVideoOverlayOps>["selectedVideoOverlay"];
	trackLocked: (row?: number) => boolean;
}

export interface CanvasSelection {
	setSceneLayout: (id: number, patch: Partial<ClipLayout>) => void;
	selectedScene: Scene | null;
	selectedClip: {
		target: CanvasTarget;
		kind: ClipKind;
		layout?: ClipLayout;
		set: (p: Partial<ClipLayout>) => void;
	} | null;
	/** Gates the canvas edit affordances, mirroring the timeline's track lock. */
	selectedClipLocked: boolean;
}

export function useCanvasSelection({
	scenes,
	mutateDoc,
	selectedSceneId,
	selectedOverlay,
	selectedAudio,
	selectedVideoOverlay,
	trackLocked,
}: CanvasSelectionInput): CanvasSelection {
	// Unified clip layout: one selected visual clip whose placement the canvas
	// bounding box + Controls panel edit. Priority: video overlay → text → scene.
	const setSceneLayout = (id: number, patch: Partial<ClipLayout>): void =>
		mutateDoc((doc) => patchCanvasLayout(doc, { source: "scene", id }, patch));
	const selectedScene =
		selectedSceneId != null ? (scenes.find((s) => s.id === selectedSceneId) ?? null) : null;
	const selected = selectedVideoOverlay
		? {
				target: { source: "video" as const, id: selectedVideoOverlay.id },
				kind: selectedVideoOverlay.kind,
				layout: selectedVideoOverlay.layout,
			}
		: selectedOverlay
			? {
					target: { source: "text" as const, id: selectedOverlay.id },
					kind: "text" as const,
					layout: selectedOverlay.layout,
				}
			: selectedScene
				? {
						target: { source: "scene" as const, id: selectedScene.id },
						kind: "scene" as const,
						layout: selectedScene.layout,
					}
				: null;
	const selectedClip = selected
		? {
				...selected,
				set: (patch: Partial<ClipLayout>) =>
					mutateDoc((doc) => patchCanvasLayout(doc, selected.target, patch)),
			}
		: null;
	// The selected clip's track lock state — gates canvas edit affordances so a
	// locked clip can be viewed but not dragged/resized/edited (mirrors the timeline).
	const selectedClipLocked = selectedVideoOverlay
		? trackLocked(selectedVideoOverlay.track ?? 0)
		: selectedOverlay
			? trackLocked(selectedOverlay.track ?? 0)
			: selectedAudio
				? trackLocked(selectedAudio.track ?? 0)
				: selectedScene
					? trackLocked(-1)
					: false;

	return { setSceneLayout, selectedScene, selectedClip, selectedClipLocked };
}
