import { useCallback, useMemo, type ComponentProps } from "react";
import type { ClipLayout } from "@maleo/shared";
import {
	canvasClipLayout,
	canvasEditCommand,
	sampledCanvasLayout,
	type CanvasTarget,
} from "@models/timeline/canvas-transform.ts";
import { applyCommand, type EditScope } from "@maleo/shared/editor";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";
import type { PlayheadHandle } from "@models/timeline/playhead-handle.ts";
import { usePlayheadSelector } from "@hooks/timeline/use-playhead.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { maskCanvasLayout, maskFromCanvas } from "@models/timeline/clip-mask-canvas.ts";
import { ClipBox } from "./clip-canvas.tsx";

/** A keyed box follows preview time and edits existing tracks at that time. */
export function AnimatedClipBox({
	target,
	store,
	writers,
	playhead,
	chromeStore,
	onPreview,
	...props
}: Omit<ComponentProps<typeof ClipBox>, "layout" | "onChange" | "onPreview" | "scale"> & {
	target: CanvasTarget;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	playhead: PlayheadHandle;
	chromeStore: EditorChromeStore;
	onPreview: (doc: EditorDoc | null) => void;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc()),
		[visual] = useChromeField(chromeStore, "clipKeyVisual");
	const selected =
		target.source === "scene" && visual?.sceneId === target.id
			? { ...target, visualId: visual.visualId }
			: target;
	const [maskEditing] = useChromeField(chromeStore, "clipMaskEditing");
	const targetKey = JSON.stringify(selected);
	const resolved = useMemo(() => canvasClipLayout(doc, selected), [doc, targetKey]);
	const animated = Boolean(resolved.layout?.animation);
	const selectTime = useCallback((time: number) => (animated ? time : 0), [animated]);
	const time = usePlayheadSelector(playhead, selectTime),
		sampled = useMemo(
			() => sampledCanvasLayout(resolved.layout, props.kind, time - resolved.start),
			[resolved, props.kind, time],
		);
	/* One command per gesture: keys for animated properties at the playhead, a static
	   replace for the rest. Preview applies the same command to the live document. */
	const command = (scope: EditScope, value: Partial<ClipLayout>) =>
		canvasEditCommand(scope, selected, value, animated ? playhead.get() : undefined);
	const commit = (value: Partial<ClipLayout>) => writers.apply((scope) => command(scope, value));
	const preview = (value: Partial<ClipLayout> | null) => {
		if (!value) {
			onPreview(null);
			return;
		}
		const scope: EditScope = { doc: store.getDoc(), slides: [], posts: [], mediaAssets: [] };
		onPreview(applyCommand(scope, command(scope, value)).doc);
	};
	const mask = sampled.layout.mask;
	const canvas = props.canvasRef.current?.getBoundingClientRect();
	const box = useMemo(
		() =>
			maskEditing && mask && canvas?.width && canvas.height
				? maskCanvasLayout(
						sampled.layout,
						mask,
						{ w: canvas.width, h: canvas.height },
						sampled.scale,
					)
				: undefined,
		[maskEditing, mask, sampled.layout, sampled.scale, canvas?.width, canvas?.height],
	);
	if (mask && box && canvas) {
		const size = { w: canvas.width, h: canvas.height };
		const maskPatch = (value: Partial<ClipLayout>): Partial<ClipLayout> => ({
			mask: maskFromCanvas(sampled.layout, mask, { ...box, ...value }, size, sampled.scale),
		});
		return (
			<ClipBox
				{...props}
				subject="clip mask"
				localBox
				layout={box}
				onChange={(value) => commit(maskPatch(value))}
				onPreview={(value) => preview(value ? maskPatch(value) : null)}
			/>
		);
	}
	return (
		<ClipBox
			{...props}
			layout={sampled.layout}
			scale={sampled.scale}
			onChange={commit}
			onPreview={preview}
		/>
	);
}
