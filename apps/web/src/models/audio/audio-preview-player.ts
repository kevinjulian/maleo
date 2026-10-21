/* The one element every audio preview plays through.
 *
 * Same mechanism as the voice auditions, and for the same reason: assigning
 * `src` to a playing element stops what it was playing, so two previews cannot
 * overlap even with a dozen mounted. Coordinating separate elements per surface
 * would leave the overlap possible and defend against it only by convention.
 *
 * This holds the element and the subscription; the control that draws the play
 * button and the scrub bar is a component. Keeping them apart is what lets the
 * playback rules be tested without a DOM. */

export interface AudioPreviewState {
	/** Which clip is sounding, by url, or null. */
	url: string | null;
	positionSec: number;
	durationSec: number;
	playing: boolean;
}

const IDLE: AudioPreviewState = { url: null, positionSec: 0, durationSec: 0, playing: false };

let element: HTMLAudioElement | null = null;
let state: AudioPreviewState = IDLE;
const listeners = new Set<(s: AudioPreviewState) => void>();

function publish(next: Partial<AudioPreviewState>): void {
	state = { ...state, ...next };
	for (const listener of listeners) listener(state);
}

/** Lazily created, so importing this does no DOM work and it stays importable
 *  from a test environment with no document. */
function audio(): HTMLAudioElement | null {
	if (typeof document === "undefined") return null;
	if (element) return element;
	element = new Audio();
	element.preload = "metadata";
	element.addEventListener("timeupdate", () => publish({ positionSec: element?.currentTime ?? 0 }));
	element.addEventListener("durationchange", () => {
		const d = element?.duration ?? 0;
		// A stream of unknown length reports Infinity; a scrub bar cannot be drawn
		// against that, so it reads as no duration rather than as a broken one.
		publish({ durationSec: Number.isFinite(d) ? d : 0 });
	});
	element.addEventListener("ended", () => publish({ playing: false, positionSec: 0 }));
	// A play() rejection or a missing file must not leave a control stuck showing
	// a clip as playing.
	element.addEventListener("error", () => publish({ ...IDLE }));
	return element;
}

export function subscribeAudioPreview(listener: (s: AudioPreviewState) => void): () => void {
	listeners.add(listener);
	listener(state);
	return () => {
		listeners.delete(listener);
	};
}

export function audioPreviewState(): AudioPreviewState {
	return state;
}

export function stopAudioPreview(): void {
	audio()?.pause();
	publish({ playing: false });
}

/** Start this clip, replacing whatever was sounding. Pressing the clip that is
 *  already sounding pauses it, and pressing it again resumes where it stopped —
 *  a preview is for judging a bed, and restarting from zero each time makes the
 *  middle of a track hard to reach. */
export function toggleAudioPreview(url: string, knownDurationSec?: number): void {
	const el = audio();
	if (!el || !url) return;
	if (state.url === url) {
		if (state.playing) {
			stopAudioPreview();
			return;
		}
		publish({ playing: true });
		void el.play().catch(() => publish({ ...IDLE }));
		return;
	}
	el.src = url;
	publish({ url, positionSec: 0, durationSec: knownDurationSec ?? 0, playing: true });
	void el.play().catch(() => publish({ ...IDLE }));
}

/** Seek within the clip that is loaded. Seeking a clip that is not loaded loads
 *  it first, so dragging the bar of a paused preview does what it looks like. */
export function seekAudioPreview(url: string, sec: number): void {
	const el = audio();
	if (!el || !url) return;
	if (state.url !== url) {
		el.src = url;
		publish({ url, durationSec: 0, playing: false });
	}
	const clamped = Math.max(0, state.durationSec ? Math.min(sec, state.durationSec) : sec);
	el.currentTime = clamped;
	publish({ positionSec: clamped });
}

/** Test seam — reset the shared playback state between cases. */
export function resetAudioPreviewForTests(): void {
	element = null;
	state = IDLE;
	listeners.clear();
}
