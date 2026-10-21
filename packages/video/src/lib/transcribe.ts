import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { CaptionWord } from "../schema";
import { z } from "zod";

/* Only the fields the caption track is built from. A word row missing any of
 * the three cannot be placed on a timeline, so the row is dropped rather than
 * failing the whole transcript. */
const whisperResponseSchema = z
	.object({
		words: z
			.array(
				z
					.object({ word: z.string(), start: z.number(), end: z.number() })
					.passthrough()
					.nullable()
					.catch(null),
			)
			.transform((rows) => rows.filter((r): r is NonNullable<typeof r> => r !== null))
			.optional(),
	})
	.passthrough();

export type TranscribeOptions = {
	audioPath: string;
	text?: string;
	cacheDir?: string;
};

export type TranscribeResult = {
	words: CaptionWord[];
	cached: boolean;
};

export async function transcribe(opts: TranscribeOptions): Promise<TranscribeResult> {
	const cacheDir = opts.cacheDir ?? path.resolve("public/voiceover");
	await fs.mkdir(cacheDir, { recursive: true });

	const audio = await fs.readFile(opts.audioPath);
	const hash = crypto.createHash("sha256").update(audio).digest("hex").slice(0, 16);
	const cachePath = path.join(cacheDir, `${hash}.words.json`);

	try {
		const cached = await fs.readFile(cachePath, "utf8");
		return { words: JSON.parse(cached), cached: true };
	} catch {}

	const apiKey = process.env.OPENAI_API_KEY;
	if (!apiKey) {
		if (!opts.text) {
			throw new Error("No OPENAI_API_KEY and no fallback text. Cannot transcribe.");
		}
		const words = approximateWordTimings(opts.text);
		await fs.writeFile(cachePath, JSON.stringify(words, null, 2));
		return { words, cached: false };
	}

	const form = new FormData();
	form.append(
		"file",
		new Blob([new Uint8Array(audio)], { type: "audio/mpeg" }),
		path.basename(opts.audioPath),
	);
	form.append("model", "whisper-1");
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "word");

	const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
		method: "POST",
		headers: { Authorization: `Bearer ${apiKey}` },
		body: form,
	});
	if (!res.ok) {
		throw new Error(`Whisper error ${res.status}: ${await res.text()}`);
	}
	/* Whisper is somebody else's API. A body with no readable `words` yields an
	 * empty caption track, which is what a missing `words` already produced —
	 * the caller falls back to approximate timings from the script. */
	const parsed = whisperResponseSchema.safeParse(await res.json().catch(() => undefined));
	const json = parsed.success ? parsed.data : {};
	const words: CaptionWord[] = (json.words ?? []).map((w) => ({
		text: w.word,
		startSec: w.start,
		endSec: w.end,
	}));
	await fs.writeFile(cachePath, JSON.stringify(words, null, 2));
	return { words, cached: false };
}

function approximateWordTimings(text: string): CaptionWord[] {
	const tokens = text.trim().split(/\s+/);
	const wpm = 160;
	const secPerWord = 60 / wpm;
	return tokens.map((t, i) => ({
		text: t,
		startSec: i * secPerWord,
		endSec: (i + 1) * secPerWord,
	}));
}

export type SceneSegment = {
	startSec: number;
	endSec: number;
	words: CaptionWord[];
};

export function segmentByScenes(
	allWords: ReadonlyArray<CaptionWord>,
	boundaries: ReadonlyArray<{ startSec: number; endSec: number }>,
): SceneSegment[] {
	return boundaries.map((b) => {
		const words = allWords.filter(
			(w) => w.startSec >= b.startSec - 0.05 && w.endSec <= b.endSec + 0.05,
		);
		return {
			startSec: b.startSec,
			endSec: b.endSec,
			words,
		};
	});
}
