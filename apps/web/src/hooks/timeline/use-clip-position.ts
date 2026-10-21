/* Committing a clip's timeline position.
 *
 * Following the playhead during playback used to live here too, on the argument
 * that both are "where a clip sits on the timeline". They are not the same
 * concern — one is a write path a drag ends in, the other is a view that tracks
 * the renderer — and keeping them together is why the studios had no follow at
 * all: it was only reachable through a hook about dragging clips. It is now
 * `use-follow-playhead.ts`, used by all three surfaces.
 *
 * Split out of `timeline-editor.tsx`.
 */
import { clipId } from "@models/timeline/timeline-clips.ts";
import { editCaptions, batch, moveClip, resizeClip, updateClip } from "@maleo/shared/editor";
import type { Clip, Scene, SceneDurationMode } from "@maleo/shared";
import type { Dispatch, SetStateAction } from "react";
import type { DocumentWriters } from "@stores/document-writers.ts";

export interface ClipPositionInput {
	writers: DocumentWriters;
	setScenes: Dispatch<SetStateAction<Scene[]>>;
}

export type SetFreeClipPos = (
	source: "video" | "text" | "audio" | "effect" | "scene" | "infographic" | "caption",
	refId: number | string,
	patch: { start?: number; track?: number; dur?: number; durMode?: SceneDurationMode },
) => void;

export function useClipPosition({ writers, setScenes }: ClipPositionInput): SetFreeClipPos {
	/* Commit a free clip's timeline position (start / track / dur).
	 *
	 * The overlay families commit the command they already know, so the whole
	 * document is not rebuilt and re-diffed to work out that one clip moved. They
	 * are byte-equivalent to the array path — asserted per family in
	 * `document-writers.test.ts`.
	 *
	 * A SCENE is not. Moving one re-pins explicit start/track onto EVERY scene,
	 * because the array rebuild re-sequences the whole run — a single-clip command
	 * would leave the others' implicit timing implicit and persist different bytes.
	 * A scene move is a sequence operation, so it keeps the array path. */
	const setFreeClipPos = (
		source: "video" | "text" | "audio" | "effect" | "scene" | "infographic" | "caption",
		refId: number | string,
		patch: { start?: number; track?: number; dur?: number; durMode?: SceneDurationMode },
	): void => {
		if (source === "caption") {
			if (typeof refId !== "string") throw new Error("Caption identity must be a string");
			writers.apply((scope) => {
				const cue = scope.doc.clips.find((clip) => clip.id === refId);
				if (!cue) throw new Error("Caption no longer exists");
				const commands = [];
				if (patch.start != null || patch.dur != null)
					commands.push(
						editCaptions({
							action: "timing",
							id: refId,
							startSec: patch.start ?? cue.startSec,
							durationSec: patch.dur ?? cue.durationSec,
						}),
					);
				if (patch.track != null) commands.push(updateClip(refId, { track: patch.track }));
				return batch(commands);
			});
			return;
		}
		if (typeof refId !== "number") throw new Error("Clip identity must be numeric");
		if (source === "scene") {
			setScenes((ss) =>
				ss.map((s) =>
					s.id === refId
						? {
								...s,
								...(patch.start != null ? { start: patch.start } : {}),
								...(patch.track != null ? { track: patch.track } : {}),
								...(patch.dur != null ? { dur: patch.dur } : {}),
								...(patch.durMode != null ? { durMode: patch.durMode } : {}),
							}
						: s,
				),
			);
			return;
		}
		const clipPatch: Partial<Clip> = {
			...(patch.start != null ? { startSec: patch.start } : {}),
			...(patch.track != null ? { track: patch.track } : {}),
			...(patch.dur != null ? { durationSec: patch.dur } : {}),
		};
		if (Object.keys(clipPatch).length === 0) return;
		// Label it for what it was, so the undo entry reads as the edit the user made.
		const id = clipId(source, refId);
		const command =
			patch.dur != null
				? resizeClip(id, {
						durationSec: patch.dur,
						...(patch.start != null ? { startSec: patch.start } : {}),
					})
				: moveClip(id, {
						startSec: patch.start ?? 0,
						...(patch.track != null ? { track: patch.track } : {}),
					});
		writers.apply(patch.start == null && patch.dur == null ? updateClip(id, clipPatch) : command);
	};

	return setFreeClipPos;
}
