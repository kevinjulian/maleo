import type { CaptionWord } from "./caption-timing.ts";

export const CAPTION_PHRASE_DEFAULTS = Object.freeze({
	maxWords: 7,
	maxCharsPerLine: 42,
	maxLines: 2,
	gapSec: 0.6,
	targetDurationSec: 3.5,
});

export interface CaptionPhrase {
	startSec: number;
	endSec: number;
	text: string;
	/** Cue-local words. */
	words: CaptionWord[];
	/** Splitting a long spoken token interpolates its internal timing. */
	estimatedWordTiming: boolean;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);
const sentenceEnd = /[.!?。！？…]["'”’）)\]]?$/u;

/** Wrap a whole phrase once. Authored line breaks remain authoritative. */
export function wrapCaptionPhrase(text: string): string {
	if (text.includes("\n")) return text;
	const lines = [""];
	for (const token of text.split(/\s+/u)) {
		const last = lines.length - 1;
		const candidate = lines[last] ? `${lines[last]} ${token}` : token;
		if (lines[last] && graphemes(candidate).length > CAPTION_PHRASE_DEFAULTS.maxCharsPerLine)
			lines.push(token);
		else lines[last] = candidate;
	}
	return lines.join("\n");
}

/** Precompute cue boundaries. Playback never selects a moving word window. */
export function groupCaptionWords(words: readonly CaptionWord[]): CaptionPhrase[] {
	const out: CaptionPhrase[] = [];
	let bucket: CaptionWord[] = [];
	let estimatedWordTiming = false;
	const flush = () => {
		if (!bucket.length) return;
		const startSec = bucket[0]!.startSec;
		out.push({
			startSec,
			endSec: bucket[bucket.length - 1]!.endSec,
			text: wrapCaptionPhrase(bucket.map((word) => word.text).join(" ")),
			words: bucket.map((word) => ({
				...word,
				startSec: word.startSec - startSec,
				endSec: word.endSec - startSec,
			})),
			estimatedWordTiming,
		});
		bucket = [];
		estimatedWordTiming = false;
	};
	let previousEnd = 0;
	for (const input of words) {
		if (
			!input.text.trim() ||
			!Number.isFinite(input.startSec) ||
			!Number.isFinite(input.endSec) ||
			input.startSec < previousEnd ||
			input.endSec <= input.startSec
		)
			throw new Error("Caption words must have text and ordered finite positive intervals");
		previousEnd = input.endSec;
		const letters = graphemes(input.text);
		const pieces: CaptionWord[] = [];
		// Long tokens split on grapheme boundaries; no surrogate or combining mark is cut.
		for (
			let offset = 0;
			offset < letters.length;
			offset += CAPTION_PHRASE_DEFAULTS.maxCharsPerLine
		) {
			const end = Math.min(letters.length, offset + CAPTION_PHRASE_DEFAULTS.maxCharsPerLine);
			pieces.push({
				text: letters.slice(offset, end).join(""),
				startSec: input.startSec + ((input.endSec - input.startSec) * offset) / letters.length,
				endSec:
					end === letters.length
						? input.endSec
						: input.startSec + ((input.endSec - input.startSec) * end) / letters.length,
			});
		}
		for (const word of pieces) {
			if (pieces.length > 1) flush();
			const last = bucket[bucket.length - 1];
			const candidate = wrapCaptionPhrase(
				[...bucket.map((item) => item.text), word.text].join(" "),
			);
			if (
				last &&
				(word.startSec - last.endSec >= CAPTION_PHRASE_DEFAULTS.gapSec ||
					sentenceEnd.test(last.text) ||
					bucket.length >= CAPTION_PHRASE_DEFAULTS.maxWords ||
					word.endSec - bucket[0]!.startSec > CAPTION_PHRASE_DEFAULTS.targetDurationSec ||
					candidate.split("\n").length > CAPTION_PHRASE_DEFAULTS.maxLines)
			)
				flush();
			bucket.push(word);
			estimatedWordTiming ||= pieces.length > 1;
		}
	}
	flush();
	return out;
}
