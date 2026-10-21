import { useEffect } from "react";
import {
	animationTargetForId,
	selectedClipAnimationTarget,
	clipIdForTarget,
} from "@models/timeline/clip-animation-edit.ts";
import { selectClip, selectScene } from "@models/timeline/selection-model.ts";
import { defaultClipInspectorTab } from "@models/timeline/timeline-editor-model.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import { useSelectionValue, type SelectionStore } from "@stores/selection-store.ts";
import type { TimelineDocumentStore } from "@stores/timeline-document-store.ts";

/** Timeline shortcuts select their real subject and use the existing inspector housing. */
export function useAnimationInspector({
	store,
	selectionStore,
	chromeStore,
	phone,
}: {
	store: TimelineDocumentStore;
	selectionStore: SelectionStore;
	chromeStore: EditorChromeStore;
	phone: boolean;
}) {
	const [request] = useChromeField(chromeStore, "animationInspector");
	const selected = useSelectionValue(selectionStore);
	useEffect(() => {
		if (!request) return;
		const target = animationTargetForId(
			store.getDoc(),
			"clipId" in request ? request.clipId : request.fromClipId,
		);
		if (!target) return;
		selectionStore.set(
			target.source === "scene" ? selectScene(target.id) : selectClip(target.source, target.id),
		);
		if (target.source === "scene" && target.visualId)
			chromeStore.patch("clipKeyVisual", { sceneId: target.id, visualId: target.visualId });
		chromeStore.patch("clipKeySelection", null);
		chromeStore.patch("clipTab", "animation");
		chromeStore.patch("inspectorOpen", true);
		chromeStore.patch("bottomSheet", phone ? "clip-props" : "none");
	}, [request, store, selectionStore, chromeStore, phone]);
	useEffect(() => {
		const doc = store.getDoc(),
			current = chromeStore.get().animationInspector;
		const target = selectedClipAnimationTarget(doc, selected, chromeStore.get().clipKeyVisual);
		const id = target && clipIdForTarget(doc, target);
		if (current && id === ("clipId" in current ? current.clipId : current.fromClipId)) {
			chromeStore.patch("clipTab", "animation");
			return;
		}
		chromeStore.patch("animationInspector", null);
		const kind =
			selected.audioId != null
				? "audio"
				: selected.overlayId != null
					? "text"
					: selected.videoOverlayId != null
						? "broll"
						: selected.infographicId != null
							? "infographic"
							: selected.effectId != null
								? "effect"
								: selected.transitionId != null
									? "transition"
									: "scene";
		chromeStore.patch("clipTab", defaultClipInspectorTab(kind));
	}, [
		selected.sceneId,
		selected.audioId,
		selected.overlayId,
		selected.videoOverlayId,
		selected.infographicId,
		selected.effectId,
		selected.transitionId,
	]);
}
