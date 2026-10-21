/* Which of a multi-visual scene's images the Transform group (and its keyframes) edits.
 * Shared with compositing through the `clipKeyVisual` chrome field. */
import type { JSX } from "react";
import { fromTimelineDoc, normalizeSceneClips } from "@maleo/shared";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Select } from "@design-system/components/select.tsx";

export function SceneVisualSource({
	sceneId,
	store,
	chromeStore,
}: {
	sceneId: number;
	store: TimelineDocumentStore;
	chromeStore: EditorChromeStore;
}): JSX.Element | null {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [choice, setChoice] = useChromeField(chromeStore, "clipKeyVisual");
	const scene = fromTimelineDoc(doc).scenes.find((s) => s.id === sceneId);
	const visuals = scene && normalizeSceneClips(scene).visualClips;
	if (!scene || !visuals || visuals.length < 2) return null;
	const current =
		visuals.find((v) => choice?.sceneId === sceneId && v.id === choice.visualId) ?? visuals[0]!;
	return (
		<InspectorSection title="Visual source">
			<PropertyRow label="Visual source">
				<Select
					size="xs"
					value={current.id}
					onValueChange={(e) => setChoice({ sceneId, visualId: e })}
					aria-label={"Visual source"}
					phoneBreakpoint={860}
					options={[...(visuals.map((v) => ({ value: v.id, label: v.label || v.id })) ?? [])]}
				/>
			</PropertyRow>
		</InspectorSection>
	);
}
