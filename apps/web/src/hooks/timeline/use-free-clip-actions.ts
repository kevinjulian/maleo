/* Maleo — actions over free clips: what a clip edits, how it is removed, and
 * whether it is locked.
 *
 * "Free" clips are everything outside the scene run — b-roll, audio, text and
 * infographics — which live in a shared generic track space where rows are
 * layers and any clip can move to any row. Removal therefore has to dispatch on
 * the clip's source to reach the right array.
 *
 * A clip is locked when its TRACK is locked, which blocks every mutating path
 * (drag, trim, delete, ripple, reorder, nudge) rather than only pointer drags. */
import type { Dispatch, SetStateAction } from "react";
import type { InfographicOverlay } from "@maleo/shared";
import type { TimelineClip, OverlayTimelineClip } from "@models/timeline/timeline-clips.ts";

export interface FreeClipEditTarget {
	type: "broll" | "audio" | "text";
	id: number;
}

export interface FreeClipActions {
	editTargetFor: (c: OverlayTimelineClip) => FreeClipEditTarget;
	removeFreeClip: (c: TimelineClip) => void;
	isLockedClip: (id: string) => boolean;
}

export function useFreeClipActions(args: {
	freeClips: TimelineClip[];
	removeCaption: (id: string) => void;
	trackLocked: (row?: number) => boolean;
	removeVideoOverlay: (id: number) => void;
	removeAudio: (id: number) => void;
	removeOverlay: (id: number) => void;
	setInfographicOverlays: Dispatch<SetStateAction<InfographicOverlay[]>>;
}): FreeClipActions {
	const {
		freeClips,
		trackLocked,
		removeVideoOverlay,
		removeAudio,
		removeOverlay,
		setInfographicOverlays,
	} = args;

	const editTargetFor = (c: OverlayTimelineClip): FreeClipEditTarget => ({
		type: c.source === "video" ? "broll" : c.source === "audio" ? "audio" : "text",
		id: c.refId,
	});

	const removeFreeClip = (c: TimelineClip): void => {
		if (c.source === "caption") {
			args.removeCaption(c.id);
			return;
		}
		if (c.source === "video") removeVideoOverlay(c.refId);
		else if (c.source === "audio") removeAudio(c.refId);
		else if (c.source === "infographic")
			setInfographicOverlays((items) => items.filter((x) => x.id !== c.refId));
		else removeOverlay(c.refId);
	};

	const isLockedClip = (id: string): boolean => {
		const c = freeClips.find((x) => x.id === id);
		return c ? trackLocked(c.track) : false;
	};

	return { editTargetFor, removeFreeClip, isLockedClip };
}
