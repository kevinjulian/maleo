import type { CaptionWord } from "./caption-timing.ts";

export function captionsToCaptionWords<T extends { text: string; startMs: number; endMs: number }>(
	captions: T[],
	offsetSec = 0,
): CaptionWord[] {
	return captions
		.map((caption) => ({
			text: caption.text.trim(),
			startSec: Math.max(0, Math.round((offsetSec + caption.startMs / 1000) * 1000) / 1000),
			endSec: Math.max(0, Math.round((offsetSec + caption.endMs / 1000) * 1000) / 1000),
		}))
		.filter((word) => word.text && word.endSec > word.startSec);
}

export function offsetCaptionWords(words: CaptionWord[], offsetSec = 0): CaptionWord[] {
	if (!offsetSec) return words;
	return words
		.map((word) => ({
			text: word.text,
			startSec: Math.max(0, Math.round((word.startSec + offsetSec) * 1000) / 1000),
			endSec: Math.max(0, Math.round((word.endSec + offsetSec) * 1000) / 1000),
		}))
		.filter((word) => word.text && word.endSec > word.startSec);
}

function normalizeToken(text: string): string {
	return text
		.normalize("NFKD")
		.toLowerCase()
		.replace(/[^\p{L}\p{N}]+/gu, "");
}

function scriptTokens(text: string): string[] {
	return text
		.trim()
		.split(/\s+/)
		.map((token) => token.trim())
		.filter(Boolean);
}

function levenshtein(a: string, b: string): number {
	const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	const curr = Array.from({ length: b.length + 1 }, () => 0);
	for (let i = 1; i <= a.length; i += 1) {
		curr[0] = i;
		for (let j = 1; j <= b.length; j += 1) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			curr[j] = Math.min(prev[j]! + 1, curr[j - 1]! + 1, prev[j - 1]! + cost);
		}
		prev.splice(0, prev.length, ...curr);
	}
	return prev[b.length] ?? 0;
}

function tokenSimilarity(a: string, b: string): number {
	const left = normalizeToken(a);
	const right = normalizeToken(b);
	if (!left || !right) return 0;
	if (left === right) return 1;
	if (left.length >= 4 && right.length >= 4 && (left.includes(right) || right.includes(left)))
		return 0.82;
	const maxLen = Math.max(left.length, right.length);
	return Math.max(0, 1 - levenshtein(left, right) / maxLen);
}

function repairCaptionBoundaries(words: CaptionWord[]): CaptionWord[] {
	if (words.length <= 1) return words;
	const out = words.map((word) => ({ ...word }));
	for (let index = 0; index < out.length; index += 1) {
		const word = out[index]!;
		const prev = out[index - 1];
		const next = out[index + 1];
		if (prev && word.startSec < prev.endSec) word.startSec = prev.endSec;
		if (next && word.endSec > next.startSec) word.endSec = next.startSec;
		if (word.endSec - word.startSec >= 0.08) continue;
		const center = (word.startSec + word.endSec) / 2;
		const leftLimit = prev?.endSec ?? word.startSec;
		const rightLimit = next?.startSec ?? word.endSec;
		const room = rightLimit - leftLimit;
		if (room < 0.08) continue;
		const dur = Math.min(0.18, room);
		word.startSec = Math.max(leftLimit, center - dur / 2);
		word.endSec = Math.min(rightLimit, word.startSec + dur);
		if (word.endSec - word.startSec < 0.08) word.startSec = Math.max(leftLimit, word.endSec - 0.08);
	}
	return out
		.map((word) => ({
			text: word.text,
			startSec: Math.round(word.startSec * 1000) / 1000,
			endSec: Math.round(word.endSec * 1000) / 1000,
		}))
		.filter((word) => word.text && word.endSec - word.startSec >= 0.08);
}

export function alignCaptionWordsToScript(
	anchorWords: CaptionWord[],
	text?: string,
): CaptionWord[] {
	const tokens = scriptTokens(text ?? "");
	if (!tokens.length || !anchorWords.length) return anchorWords;
	const n = tokens.length;
	const m = anchorWords.length;
	if (n * m > 4_000_000)
		throw new Error("Script alignment exceeds limit; split narration into shorter segments");
	const gap = -0.38;
	const dp = Array.from({ length: n + 1 }, () => Array.from({ length: m + 1 }, () => 0));
	const back = Array.from({ length: n + 1 }, () =>
		Array.from<"diag" | "up" | "left">({ length: m + 1 }).fill("diag"),
	);
	for (let i = 1; i <= n; i += 1) {
		dp[i]![0] = dp[i - 1]![0]! + gap;
		back[i]![0] = "up";
	}
	for (let j = 1; j <= m; j += 1) {
		dp[0]![j] = dp[0]![j - 1]! + gap;
		back[0]![j] = "left";
	}
	for (let i = 1; i <= n; i += 1) {
		for (let j = 1; j <= m; j += 1) {
			const similarity = tokenSimilarity(tokens[i - 1]!, anchorWords[j - 1]!.text);
			const matchScore = similarity >= 0.45 ? similarity * 2 : -0.65;
			const diag = dp[i - 1]![j - 1]! + matchScore;
			const up = dp[i - 1]![j]! + gap;
			const left = dp[i]![j - 1]! + gap;
			if (diag >= up && diag >= left) {
				dp[i]![j] = diag;
				back[i]![j] = "diag";
			} else if (up >= left) {
				dp[i]![j] = up;
				back[i]![j] = "up";
			} else {
				dp[i]![j] = left;
				back[i]![j] = "left";
			}
		}
	}
	const matched = Array.from<CaptionWord | null>({ length: n }).fill(null);
	let i = n;
	let j = m;
	while (i > 0 || j > 0) {
		const move = back[i]?.[j] ?? (i > 0 ? "up" : "left");
		if (move === "diag" && i > 0 && j > 0) {
			const anchor = anchorWords[j - 1]!;
			matched[i - 1] = { text: tokens[i - 1]!, startSec: anchor.startSec, endSec: anchor.endSec };
			i -= 1;
			j -= 1;
		} else if (move === "up" && i > 0) {
			i -= 1;
		} else {
			j -= 1;
		}
	}
	const firstStart = anchorWords[0]!.startSec;
	const lastEnd = anchorWords[anchorWords.length - 1]!.endSec;
	let cursor = 0;
	while (cursor < matched.length) {
		if (matched[cursor]) {
			cursor += 1;
			continue;
		}
		const startIndex = cursor;
		while (cursor < matched.length && !matched[cursor]) cursor += 1;
		const endIndex = cursor - 1;
		const prev = startIndex > 0 ? matched[startIndex - 1] : null;
		const next = cursor < matched.length ? matched[cursor] : null;
		const spanStart = prev ? prev.endSec : firstStart;
		const spanEnd = next ? next.startSec : lastEnd;
		const weights = tokens
			.slice(startIndex, endIndex + 1)
			.map((token) => Math.max(1, normalizeToken(token).length));
		const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
		const span = Math.max(0.08 * weights.length, spanEnd - spanStart);
		let pos = spanStart;
		for (let k = startIndex; k <= endIndex; k += 1) {
			const dur = span * (weights[k - startIndex]! / totalWeight);
			const endSec = k === endIndex ? spanEnd : pos + dur;
			matched[k] = {
				text: tokens[k]!,
				startSec: Math.round(pos * 1000) / 1000,
				endSec: Math.round(Math.max(pos + 0.08, endSec) * 1000) / 1000,
			};
			pos = endSec;
		}
	}
	return repairCaptionBoundaries(matched.filter((word): word is CaptionWord => Boolean(word)));
}
