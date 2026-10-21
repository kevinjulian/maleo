/** Caret-to-time mapping for keyboard split. The engine's `split` snaps a time to the
 *  nearest word start (first on ties) and estimates words when a cue has none; this
 *  mirrors both so the split lands on the boundary the caret names, or is refused. */

interface Word {
	text: string;
	startSec: number;
	endSec: number;
}

interface SplitCue {
	startSec: number;
	durationSec: number;
	caption: { text: string; words: readonly Word[] };
}

/** Matches the engine's character-proportional estimate over whitespace tokens. */
function estimate(text: string, duration: number): Word[] {
	const tokens = text.split(/\s+/).filter(Boolean);
	const total = tokens.reduce((sum, token) => sum + Array.from(token).length, 0);
	return tokens.reduce<{ cursor: number; words: Word[] }>(
		(acc, token) => {
			const next = acc.cursor + Array.from(token).length;
			return {
				cursor: next,
				words: [
					...acc.words,
					{
						text: token,
						startSec: (acc.cursor / total) * duration,
						endSec: (next / total) * duration,
					},
				],
			};
		},
		{ cursor: 0, words: [] },
	).words;
}

/** Absolute split time for a caret offset, or null when the caret names no interior boundary. */
export function captionSplitTime(cue: SplitCue, caret: number): number | null {
	const { text } = cue.caption;
	const words = cue.caption.words.length ? cue.caption.words : estimate(text, cue.durationSec);
	const spans = words.reduce<Array<{ start: number; end: number }>>((acc, word) => {
		const from = acc.at(-1)?.end ?? 0;
		const start = text.indexOf(word.text, from);
		return start < 0 ? acc : [...acc, { start, end: start + word.text.length }];
	}, []);
	if (spans.length !== words.length) return null;
	const k = spans.findIndex((span) => span.end > caret);
	if (k < 1) return null;
	const at = (words[k - 1]!.endSec + words[k]!.startSec) / 2;
	const resolved = words
		.slice(1)
		.reduce(
			(best, word, index) =>
				Math.abs(word.startSec - at) < Math.abs(words[best]!.startSec - at) ? index + 1 : best,
			1,
		);
	if (resolved !== k || at <= 0 || at >= cue.durationSec) return null;
	return cue.startSec + at;
}
