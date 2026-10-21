import { oneOf } from "./one-of.ts";
export const AUDIO_OVERLAY_KINDS = ["voiceover", "music", "sfx", "ambient", "accent_hit"] as const;
export type AudioOverlayKind = (typeof AUDIO_OVERLAY_KINDS)[number];

export const AUDIO_ORIGINS = ["tts", "stock", "upload", "recorded", "generated"] as const;
export type AudioOrigin = (typeof AUDIO_ORIGINS)[number];

export function isAudioOverlayKind(value: unknown): value is AudioOverlayKind {
	return oneOf(value, AUDIO_OVERLAY_KINDS) !== undefined;
}

export function normalizeAudioOverlayKind(value: unknown): AudioOverlayKind {
	return isAudioOverlayKind(value) ? value : "voiceover";
}

export function isAudioOrigin(value: unknown): value is AudioOrigin {
	return oneOf(value, AUDIO_ORIGINS) !== undefined;
}

export function normalizeAudioOrigin(value: unknown): AudioOrigin | undefined {
	return isAudioOrigin(value) ? value : undefined;
}

export function defaultAudioContent(kind: AudioOverlayKind): string {
	switch (kind) {
		case "voiceover":
			return "New voiceover";
		case "music":
			return "Background music";
		case "sfx":
			return "SFX";
		case "ambient":
			return "Ambient";
		case "accent_hit":
			return "Accent hit";
	}
}

export function audioKindLabel(kind: AudioOverlayKind, origin?: AudioOrigin): string {
	if (kind === "voiceover") {
		if (origin === "tts" || origin === "generated") return "TTS Voiceover";
		if (origin === "upload") return "Uploaded Voiceover";
		if (origin === "recorded") return "Recorded Voiceover";
		return "Voiceover";
	}
	if (kind === "music") return "Background Music";
	if (kind === "sfx") return "SFX";
	if (kind === "ambient") return "Ambient";
	return "Accent Hit";
}

/* How far each kind drops while voiceover is speaking, as a share of the clip's
 * own volume. The renderer applies it (`packages/video/src/lib/music.ts`); this
 * is the same table, stated here so a control can show the operator what a clip
 * is doing before they change it. A clip that states its own `duckUnderVoice`
 * uses that instead, and 1 means no ducking at all.
 *
 * Two copies of one table is a risk worth naming: they are asserted equal in
 * `audio-overlays.test.ts`, because the renderer cannot import the editor's
 * package and the editor must not import the renderer's. */
const DUCK_UNDER_VOICE = {
	voiceover: 1,
	music: 0.35,
	ambient: 0.45,
	sfx: 0.62,
	accent_hit: 0.62,
} satisfies Record<AudioOverlayKind, number>;

/** The duck depth a clip of this kind uses when it states none. */
export function defaultDuckUnderVoice(kind: AudioOverlayKind): number {
	return DUCK_UNDER_VOICE[kind];
}
