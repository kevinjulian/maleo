import { sampleClipProperty, type AudioAnimation } from "./clip-animation.ts";

// Mix levels for a continuous background-music bed under narration.
// The bed plays low, ducks further under active voiceover, and swells back up in the
// silent gaps BETWEEN voiceover ranges so an inter-section pause reads as an
// intentional breath rather than a dead/broken stretch.
export const BED_VOLUME = 0.24; // lead-in / tail (no narration, no internal gap)
export const BED_DUCKED_VOLUME = 0.11; // under active voiceover
export const BED_SWELL_VOLUME = 0.3; // during gaps between voiceover ranges

export interface BedLevels {
	bed?: number;
	ducked?: number;
	swell?: number;
	fadeFrames?: number;
}

export type DialoguePriorityKind = "voiceover" | "music" | "sfx" | "ambient" | "accent_hit";

/** Dialogue-priority multiplier for timeline audio. No scheduling/cooldown: clip
 * placement stays untouched; competing non-voice audio only lowers while VO is active. */
/** How far each kind drops under narration by default, as a fraction of the
 *  clip's own volume. A clip may override it — see `duckUnderVoice`. */
export const DEFAULT_DUCK_UNDER_VOICE = {
	music: 0.35,
	ambient: 0.45,
	sfx: 0.62,
	accent_hit: 0.62,
} satisfies Record<Exclude<DialoguePriorityKind, "voiceover">, number>;

export function dialoguePriorityEnvelope(
	frame: number,
	fps: number,
	voiceoverRanges: Array<{ startSec: number; endSec: number }>,
	kind: DialoguePriorityKind,
	/** The clip's own duck depth, when it states one. 1 disables ducking, which
	 *  is the escape hatch for an operator who wants the level they set. */
	duckUnderVoice?: number,
): number {
	if (kind === "voiceover") return 1;
	const ducked = duckUnderVoice ?? DEFAULT_DUCK_UNDER_VOICE[kind];
	if (ducked >= 1) return 1;
	return bedDuckEnvelope(frame, fps, voiceoverRanges, { bed: 1, ducked, swell: 1 });
}

/** Per-frame volume for a music bed that ducks under voiceover and swells in the
 *  gaps between voiceover ranges. Outside all voiceover the level is the swell when
 *  the frame sits BETWEEN the first and last voiceover (an inter-section gap), else
 *  the lower bed level (lead-in before the first VO, tail after the last). The duck
 *  is a smooth lerp toward `ducked` near/inside each voiceover range. Pure. */
export function bedDuckEnvelope(
	frame: number,
	fps: number,
	voiceoverRanges: Array<{ startSec: number; endSec: number }>,
	levels: BedLevels = {},
): number {
	const bed = levels.bed ?? BED_VOLUME;
	const ducked = levels.ducked ?? BED_DUCKED_VOLUME;
	const swell = levels.swell ?? BED_SWELL_VOLUME;
	const fadeFrames = levels.fadeFrames ?? 8;
	if (voiceoverRanges.length === 0) return bed;
	const sec = frame / fps;
	const fadeSec = fadeFrames / fps;
	const first = voiceoverRanges[0]!.startSec;
	const last = voiceoverRanges[voiceoverRanges.length - 1]!.endSec;
	// Outside-VO baseline: swell inside the narrated span (a gap), bed at the edges.
	const outside = sec > first && sec < last ? swell : bed;
	// How deep into any voiceover this frame sits (0 at the fade edges, 1 well inside).
	let duck = 0;
	for (const r of voiceoverRanges) {
		if (sec >= r.startSec - fadeSec && sec <= r.endSec + fadeSec) {
			const inFade = (sec - (r.startSec - fadeSec)) / fadeSec;
			const outFade = (r.endSec + fadeSec - sec) / fadeSec;
			duck = Math.max(duck, Math.max(0, Math.min(1, inFade, outFade)));
		}
	}
	return outside + (ducked - outside) * duck;
}

/** Production audio-overlay gain, also sampled by recognition's temporary mix. */
export function timelineAudioGain(
	clip: {
		kind: DialoguePriorityKind;
		startSec: number;
		durationSec: number;
		volume?: number;
		fadeInSec?: number;
		fadeOutSec?: number;
		duckUnderVoice?: number;
		animation?: AudioAnimation;
	},
	frame: number,
	fps: number,
	voiceoverRanges: Array<{ startSec: number; endSec: number }>,
): number {
	const frames = Math.max(1, Math.floor(clip.durationSec * fps));
	const fadeIn = Math.floor((clip.fadeInSec ?? 0) * fps);
	const fadeOut = Math.floor((clip.fadeOutSec ?? 0) * fps);
	const edge = Math.max(
		0,
		Math.min(
			fadeIn > 0 ? Math.min(1, frame / fadeIn) : 1,
			fadeOut > 0 ? Math.min(1, (frames - frame) / fadeOut) : 1,
		),
	);
	return (
		sampleClipProperty(clip.animation, "volume", frame / fps, clip.volume ?? 1) *
		(clip.kind === "ambient" ? 0.32 : 1) *
		dialoguePriorityEnvelope(
			Math.floor(clip.startSec * fps) + frame,
			fps,
			voiceoverRanges,
			clip.kind,
			clip.duckUnderVoice,
		) *
		edge
	);
}
