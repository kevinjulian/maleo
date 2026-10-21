/* Word-level caption timing for narrated video.
 *
 * The renderer shows kinetic captions from storyboard.voiceover.words (absolute
 * time). We ESTIMATE per-word timings by distributing each voiceover clip's
 * MEASURED duration across its words — weighted by word length and lengthened by
 * punctuation pauses. Section/clip boundaries stay exact; only intra-clip word
 * placement is estimated. A clip's real `words` (forced alignment) win verbatim.
 */

export interface CaptionWord {
	text: string;
	startSec: number;
	endSec: number;
}

// Trailing-pause weight after a token, in "average word" units.
function trailingPause(token: string): number {
	if (/[.!?…]["')\]]?$/.test(token)) return 2.2;
	if (/[,;:—-]["')\]]?$/.test(token)) return 0.9;
	return 0;
}

// Speaking weight of a token ~ its alphanumeric length. Floor at 1.
function speakWeight(token: string): number {
	const letters = token.replace(/[^\p{L}\p{N}]/gu, "").length;
	return Math.max(1, letters);
}

// Distribute `durationSec` (starting at `startSec`) across the words of `text`.
export function estimateWordTimings(
	text: string,
	startSec: number,
	durationSec: number,
): CaptionWord[] {
	if (!text || durationSec <= 0) return [];
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [];
	const speak = tokens.map(speakWeight);
	const pause = tokens.map(trailingPause);
	const meanSpeak = speak.reduce((a, b) => a + b, 0) / speak.length;
	const total = speak.reduce((a, b) => a + b, 0) + pause.reduce((a, b) => a + b, 0) * meanSpeak;
	const scale = durationSec / total;
	const end = startSec + durationSec;
	const words: CaptionWord[] = [];
	let cursor = startSec;
	for (let i = 0; i < tokens.length; i++) {
		const wStart = cursor;
		const wDur = speak[i]! * scale;
		const wEnd = Math.min(end, wStart + wDur);
		words.push({
			text: tokens[i]!,
			startSec: Math.round(wStart * 1000) / 1000,
			endSec: Math.round(wEnd * 1000) / 1000,
		});
		cursor = wEnd + pause[i]! * meanSpeak * scale;
		if (cursor > end) cursor = end;
	}
	return words;
}

export interface VoiceoverClipForCaptions {
	content: string;
	start: number;
	dur: number;
	words?: CaptionWord[];
}

export function clampCaptionWordsToClip(
	words: CaptionWord[] | undefined,
	startSec: number,
	durationSec: number,
): CaptionWord[] {
	if (!words?.length || durationSec <= 0) return [];
	const endSec = startSec + durationSec;
	return words
		.map((word) => ({
			text: word.text,
			startSec: Math.max(startSec, Math.round(word.startSec * 1000) / 1000),
			endSec: Math.min(endSec, Math.round(word.endSec * 1000) / 1000),
		}))
		.filter((word) => word.text.trim() && word.endSec - word.startSec >= 0.08);
}

// Build the absolute-time word track for the whole video from its voiceover clips.
export function buildCaptionWords(clips: VoiceoverClipForCaptions[]): CaptionWord[] {
	const ordered = [...clips].sort((a, b) => a.start - b.start);
	const out: CaptionWord[] = [];
	for (const clip of ordered) {
		if (clip.words?.length) {
			out.push(...clampCaptionWordsToClip(clip.words, clip.start, clip.dur));
			continue;
		}
		out.push(...estimateWordTimings(clip.content, clip.start, clip.dur));
	}
	return out;
}
