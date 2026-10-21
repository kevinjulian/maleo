/* Playback for the prebaked voice audition clips.
 *
 * One module-level <audio> element serves every picker on the page. That is the
 * whole mechanism behind "only one sample plays at a time": setting `src` on a
 * playing element stops the previous clip, so two samples cannot overlap even if
 * two pickers are mounted at once. Coordinating separate elements would leave the
 * overlap possible and only defend against it by convention.
 *
 * The clips are static files. Nothing here synthesizes, so playing a sample any
 * number of times costs nothing. */
import { useCallback, useEffect, useState } from "react";

/* What identifies the clip that is sounding.
 *
 * A bare voice id does not. Ids are unique within a provider and not across
 * them, so a surface listing more than one — the voice library — can otherwise
 * mark the wrong row as playing, or collide two rows that are different voices
 * from different services. The baked file has been provider-qualified since it
 * was written (`voice-sample-<provider>-<voice>-<version>`); only the in-memory
 * key lagged.
 *
 * It lives here, next to the state it keys, so two callers cannot spell it
 * differently and quietly stop agreeing about what is playing. The hook's own
 * signature stays `(id, url)`: it must not learn what a voice is, because the
 * speaker picker passes a speaker and has no provider to give it. */
export function sampleKey(provider: string, voiceId: string): string {
	return `${provider}:${voiceId}`;
}

/** Lazily created so importing this module does no DOM work (and so it stays
 *  importable from a test environment that has no document). */
let element: HTMLAudioElement | null = null;
function audio(): HTMLAudioElement | null {
	if (typeof document === "undefined") return null;
	if (!element) element = new Audio();
	return element;
}

/** Which voice is currently sounding, shared across every mounted picker so a
 *  second picker shows the first one's clip as playing rather than disagreeing. */
let playingId: string | null = null;
const listeners = new Set<(id: string | null) => void>();

function setPlaying(id: string | null): void {
	playingId = id;
	for (const listener of listeners) listener(id);
}

export interface VoiceSampleState {
	/** Voice id currently playing, or null. */
	playingId: string | null;
	/** Start this voice's sample, replacing whatever was playing. */
	play: (voiceId: string, url: string) => void;
	stop: () => void;
	/** True when this specific voice is the one sounding. */
	isPlaying: (voiceId: string) => boolean;
}

export function useVoiceSample(): VoiceSampleState {
	const [current, setCurrent] = useState<string | null>(playingId);

	useEffect(() => {
		listeners.add(setCurrent);
		setCurrent(playingId);
		return () => {
			listeners.delete(setCurrent);
		};
	}, []);

	const stop = useCallback(() => {
		const el = audio();
		if (el) el.pause();
		setPlaying(null);
	}, []);

	const play = useCallback(
		(voiceId: string, url: string) => {
			const el = audio();
			if (!el) return;
			// Toggle: pressing play on the clip that is already sounding stops it.
			if (playingId === voiceId) {
				stop();
				return;
			}
			// Assigning src interrupts the current clip — this is what guarantees a
			// single concurrent sample.
			el.src = url;
			el.onended = () => setPlaying(null);
			// A play() rejection (autoplay policy, missing file) must not leave the UI
			// stuck showing a clip as playing.
			el.onerror = () => setPlaying(null);
			setPlaying(voiceId);
			void el.play().catch(() => setPlaying(null));
		},
		[stop],
	);

	return {
		playingId: current,
		play,
		stop,
		isPlaying: useCallback((voiceId: string) => current === voiceId, [current]),
	};
}
