/* Maleo — preview playback speed.
 *
 * J/K/L shuttle steps through the rate table in `timeline-editor-model.ts`.
 * Remotion's Player cannot play in reverse, so J slows down rather than
 * rewinding — the shuttle is a speed control, not a direction one. */
import { useCallback } from "react";
import { stepPlaybackRate } from "@models/timeline/editor-chrome.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { EditorChrome } from "@stores/editor-chrome-store.ts";

type RateSetter = (
	value:
		| EditorChrome["playbackRate"]
		| ((prev: EditorChrome["playbackRate"]) => EditorChrome["playbackRate"]),
) => void;

export interface PlaybackRateControl {
	playbackRate: EditorChrome["playbackRate"];
	setPlaybackRate: RateSetter;
	stepRate: (dir: 1 | -1) => void;
}

export function usePlaybackRate(chromeStore: EditorChromeStore): PlaybackRateControl {
	const [playbackRate, setPlaybackRate] = useChromeField(chromeStore, "playbackRate");
	const stepRate = useCallback(
		(dir: 1 | -1): void => {
			setPlaybackRate((r) => stepPlaybackRate(r, dir));
		},
		[setPlaybackRate],
	);
	return { playbackRate, setPlaybackRate, stepRate };
}
