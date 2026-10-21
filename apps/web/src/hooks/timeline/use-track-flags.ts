/* Maleo — per-track hide / mute / lock, CapCut-style track headers.
 *
 * Flags are keyed by free-row index; the base scene track uses key -1. State
 * lives in the editor's document (it persists and drives export), so this hook
 * only owns the toggle and the lock read that every mutating path consults. */
import type { Dispatch, SetStateAction } from "react";
import type { TrackFlags } from "@maleo/shared";

export type TrackFlagKey = "hidden" | "muted" | "locked";

export interface TrackFlagOps {
	toggleTrackFlag: (row: number, key: TrackFlagKey) => void;
	/** A row is locked when its flag says so; row defaults to 0. */
	trackLocked: (row?: number) => boolean;
}

export function useTrackFlags(
	trackFlags: TrackFlags,
	setTrackFlags: Dispatch<SetStateAction<TrackFlags>>,
): TrackFlagOps {
	const toggleTrackFlag = (row: number, key: TrackFlagKey): void =>
		setTrackFlags((f) => ({ ...f, [row]: { ...f[row], [key]: !f[row]?.[key] } }));

	const trackLocked = (row?: number): boolean => Boolean(trackFlags[row ?? 0]?.locked);

	return { toggleTrackFlag, trackLocked };
}
