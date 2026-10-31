/* Expand a placed motion clip into ordinary clips (motion-design-generation, D9).
 *
 * A `motion-comp` clip is sealed: its layers' keys show on no timeline. This
 * replaces it with one text or shape clip per layer, each on its own lane, with
 * keys in clip-local seconds the key lanes edit, as ONE batch command, so one
 * undo restores the single clip. The saved motion definition is not touched.
 *
 * It refuses, rather than drops, what it cannot carry over: a clip resized away
 * from full frame (layer positions would need rescaling) or a clip with its own
 * clip-level animation. */
import {
	compositionConfigSchema,
	expandComposition,
	textClipOf,
	type TextOverlay,
} from "@maleo/shared";
import {
	batch,
	insertClip,
	removeClip,
	type EditorCommand,
	type EditorDoc,
	type EditScope,
} from "@maleo/shared/editor";

const FULL_FRAME = 1e-6;

const fullFrame = (layout: TextOverlay["layout"]) =>
	!layout ||
	(Math.abs(layout.xPct ?? 0) < FULL_FRAME &&
		Math.abs(layout.yPct ?? 0) < FULL_FRAME &&
		Math.abs((layout.widthPct ?? 100) - 100) < FULL_FRAME &&
		Math.abs((layout.heightPct ?? 100) - 100) < FULL_FRAME);

/** Why the clip cannot be expanded, or null when it can. */
export function motionExpandRefusal(doc: EditorDoc, clipId: string): string | null {
	const text = doc.clips.find((c) => c.id === clipId)?.text;
	if (text?.preset !== "motion-comp") return "Select a placed motion clip";
	if (!compositionConfigSchema.safeParse(text.params).success)
		return "This motion clip's layers cannot be read";
	if (!fullFrame(text.layout)) return "Reset the motion clip to full frame before expanding";
	if (text.layout?.animation) return "Remove the motion clip's own clip animation first";
	return null;
}

export function expandMotionCommand(scope: EditScope, clipId: string): EditorCommand {
	const refusal = motionExpandRefusal(scope.doc, clipId);
	if (refusal) throw new Error(refusal);
	const clip = scope.doc.clips.find((c) => c.id === clipId)!;
	const text = clip.text!;
	const layers = expandComposition(compositionConfigSchema.parse(text.params), clip.durationSec);
	// Lanes keep the composition's paint order: back layer lowest.
	const ranks = [...new Set(layers.map((l) => l.lane))].sort((a, b) => a - b);
	const end = clip.startSec + clip.durationSec;
	const busy = (track: number) =>
		scope.doc.clips.some(
			(c) =>
				c.id !== clipId &&
				!c.scene &&
				c.track === track &&
				c.startSec < end &&
				c.startSec + c.durationSec > clip.startSec,
		);
	let first = clip.track;
	while (ranks.some((_, i) => busy(first + i))) first++;
	const nextId = Math.max(0, ...scope.doc.clips.flatMap((c) => (c.text ? [c.text.id] : []))) + 1;
	const overlays = layers.map((layer, index): TextOverlay => ({
		id: nextId + index,
		content: layer.content,
		start: clip.startSec + layer.startSec,
		dur: layer.durationSec,
		track: first + ranks.indexOf(layer.lane),
		preset: layer.preset,
		...(layer.style ? { style: layer.style } : {}),
		...(layer.params ? { params: layer.params } : {}),
		layout: layer.layout,
	}));
	return batch(
		[removeClip(clipId), ...overlays.map((overlay) => insertClip(textClipOf(overlay)))],
		"Expand motion into clips",
	);
}
