export type MusicMood = "upbeat" | "chill" | "luxury" | "energetic" | "minimal";

export type MusicTrack = {
	id: string;
	url: string;
	mood: MusicMood;
	bpm: number;
	durationSec: number;
	license: string;
};

export const MUSIC_POOL: MusicTrack[] = [
	{
		id: "track-upbeat-01",
		url: "public/music/upbeat-01.mp3",
		mood: "upbeat",
		bpm: 128,
		durationSec: 60,
		license: "royalty-free",
	},
	{
		id: "track-chill-01",
		url: "public/music/chill-01.mp3",
		mood: "chill",
		bpm: 90,
		durationSec: 60,
		license: "royalty-free",
	},
	{
		id: "track-luxury-01",
		url: "public/music/luxury-01.mp3",
		mood: "luxury",
		bpm: 75,
		durationSec: 60,
		license: "royalty-free",
	},
];

export function pickTrack(mood: MusicMood, seed = Date.now()): MusicTrack {
	const candidates = MUSIC_POOL.filter((t) => t.mood === mood);
	const pool = candidates.length > 0 ? candidates : MUSIC_POOL;
	return pool[seed % pool.length]!;
}

export function duckEnvelope(
	frame: number,
	fps: number,
	voiceoverRanges: Array<{ startSec: number; endSec: number }>,
	duckedVolume = 0.18,
	normalVolume = 0.6,
	fadeFrames = 8,
): number {
	const sec = frame / fps;
	for (const r of voiceoverRanges) {
		if (sec >= r.startSec - fadeFrames / fps && sec <= r.endSec + fadeFrames / fps) {
			const inFade = Math.min(1, ((sec - (r.startSec - fadeFrames / fps)) * fps) / fadeFrames);
			const outFade = Math.min(1, ((r.endSec + fadeFrames / fps - sec) * fps) / fadeFrames);
			const t = Math.min(inFade, outFade);
			return normalVolume + (duckedVolume - normalVolume) * t;
		}
	}
	return normalVolume;
}

export {
	BED_VOLUME,
	BED_DUCKED_VOLUME,
	BED_SWELL_VOLUME,
	DEFAULT_DUCK_UNDER_VOICE,
	dialoguePriorityEnvelope,
	bedDuckEnvelope,
	type BedLevels,
	type DialoguePriorityKind,
} from "@maleo/shared";
