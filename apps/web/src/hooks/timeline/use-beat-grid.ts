/* Beat grid: detect onsets in the timeline's music clip and map them from file
 * time into timeline time, so snapping and the tick lane agree with what plays. */
import { useEffect, useMemo, useState } from "react";
import type { AudioOverlay } from "@maleo/shared";
import { beatsForUrl } from "@models/analysis/beat-detect.ts";

export interface BeatGrid {
	/** Null when the timeline has no music clip, which is when the grid is unavailable. */
	musicClip: AudioOverlay | undefined;
	beatGridOn: boolean;
	setBeatGridOn: (on: boolean | ((prev: boolean) => boolean)) => void;
	timelineBeats: number[];
}

export function useBeatGrid(audioOverlays: AudioOverlay[], total: number): BeatGrid {
	const [beatGridOn, setBeatGridOn] = useState(false);
	const [rawBeats, setRawBeats] = useState<number[]>([]);
	const musicClip = audioOverlays.find((a) => a.kind === "music" && a.url);

	useEffect(() => {
		if (!beatGridOn || !musicClip?.url) {
			setRawBeats([]);
			return;
		}
		let alive = true;
		void beatsForUrl(musicClip.url)
			.then((b) => {
				if (alive) setRawBeats(b);
			})
			.catch(() => {
				if (alive) setRawBeats([]);
			});
		return () => {
			alive = false;
		};
	}, [beatGridOn, musicClip?.url]);

	const timelineBeats = useMemo(() => {
		if (!musicClip || !rawBeats.length) return [];
		// Beat times are relative to the audio FILE; shift by the clip's placement and
		// trim, then keep only beats inside the clip's window.
		return rawBeats
			.map((b) => musicClip.start + (b - (musicClip.mediaStartSec ?? 0)))
			.filter((t) => t >= musicClip.start && t <= musicClip.start + musicClip.dur && t <= total);
	}, [musicClip, rawBeats, total]);

	return { musicClip, beatGridOn, setBeatGridOn, timelineBeats };
}
