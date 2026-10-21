/* Turning editor state into context descriptors.
 *
 * The editor knows things the server cannot reconstruct: what is selected, where
 * the playhead is, which slide is open. Those are what make "make this punchier"
 * mean something, and they exist only in the browser — so they travel in the
 * envelope, as stable entity ids rather than as positions.
 *
 * Everything here is pure and reads the editor's own types. It is the one place
 * that knows how a `Selection` maps onto entity identity, so a surface that
 * gains a new kind of selectable thing changes this file and nothing else. */
import { clipId, parseClipId, type Clip, type ChatEntityRef } from "@maleo/shared";
import type { ChatLogMessage } from "./chat-log.ts";
import type { Selection } from "@models/timeline/selection-model.ts";
import { primaryClipKey } from "@models/timeline/selection-model.ts";
import type { EditorDoc } from "@models/storyboard/editor-doc.ts";

/* What the user has selected, as entity refs.
 *
 * Multi-select stays multi: selecting three clips and saying "tighten these" is
 * one command over three entities, and collapsing it to the primary would
 * silently narrow what was asked. A scene selection resolves to the scene rather
 * than to its clips, because a scene is what the user pointed at. */
export function focusFromSelection(selection: Selection): ChatEntityRef[] {
	const refs: ChatEntityRef[] = [];

	if (selection.sceneId != null) refs.push({ kind: "scene", id: String(selection.sceneId) });

	// The multi-select set is already keyed `source:refId`, the same identity the
	// timeline document uses, so these need no translation.
	for (const key of selection.freeIds) refs.push({ kind: "clip", id: key });

	const primary = primaryClipKey(selection);
	if (primary && !selection.freeIds.has(primary)) refs.push({ kind: "clip", id: primary });

	return refs;
}

/* What sits under the playhead.
 *
 * A weaker signal than selection — the user parked there, they did not point at
 * it — which is why it ranks below selection in the precedence rule. Only one
 * clip is returned even when several overlap: the topmost track, matching what
 * the stage is actually showing.
 */
export function focusFromPlayhead(doc: EditorDoc, playheadSec: number): ChatEntityRef | null {
	const covering = doc.clips.filter(
		(clip) => playheadSec >= clip.startSec && playheadSec < clip.startSec + clip.durationSec,
	);
	if (!covering.length) return null;
	const top = covering.reduce(
		(best: Clip, clip: Clip) => (clip.track > best.track ? clip : best),
		covering[0]!,
	);
	return { kind: "clip", id: top.id };
}

/** The scene a marker describes, as a ref — used when a chat result points back
 *  at a scene the user should look at. */
export function sceneRef(sceneId: number): ChatEntityRef {
	return { kind: "scene", id: String(sceneId) };
}

/** A clip ref from the family + numeric id the editor's surfaces carry. */
export function clipRef(source: Parameters<typeof clipId>[0], refId: number): ChatEntityRef {
	return { kind: "clip", id: clipId(source, refId) };
}

/** A slide or post ref, keyed by its stable key rather than its render ordinal. */
export function slideRef(key: string): ChatEntityRef {
	return { kind: "slide", id: key };
}

export function postRef(key: string): ChatEntityRef {
	return { kind: "post", id: key };
}

/* The timeline jump for an entity a result touched, when the timeline has one.
 *
 * The inverse of the descriptors above: a scene ref or a scene/video/audio/text
 * clip maps onto the jump the timeline already offers for chat links. Effects,
 * infographics, sections and anything off the timeline have no jump. */
export function timelineJumpFor(ref: ChatEntityRef): NonNullable<ChatLogMessage["ref"]> | null {
	if (ref.kind === "scene") {
		const id = Number(ref.id);
		return Number.isFinite(id) ? { type: "scene", id } : null;
	}
	if (ref.kind !== "clip") return null;
	const parsed = parseClipId(ref.id);
	if (!parsed) return null;
	const type =
		parsed.source === "scene"
			? "scene"
			: parsed.source === "video"
				? "broll"
				: parsed.source === "audio" || parsed.source === "text"
					? parsed.source
					: null;
	return type ? { type, id: parsed.refId } : null;
}
