/* audio domain — stock audio cues + TTS voiceover (scene-bound, free clip, standalone). */
import type { AnyToolDef } from "../../types.ts";
import { addAudio } from "./add-audio.ts";
import { generateVoiceover } from "./generate-voiceover.ts";
import { generateVoiceoverClip } from "./generate-voiceover-clip.ts";
import { generateVoice } from "./generate-voice.ts";

export const audioTools: AnyToolDef[] = [
	addAudio,
	generateVoiceover,
	generateVoiceoverClip,
	generateVoice,
];
