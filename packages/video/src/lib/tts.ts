import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchWithRetry } from "./retry";

export type TTSOptions = {
	text: string;
	voiceId?: string;
	modelId?: string;
	cacheDir?: string;
};

export type TTSResult = {
	audioPath: string;
	durationSec: number;
	cached: boolean;
};

const ELEVEN_API = "https://api.elevenlabs.io/v1/text-to-speech";

// Provider selection. Defaults to Kokoro (free, local) when its URL is set
// or the provider is explicitly chosen; otherwise falls back to ElevenLabs.
type Provider = "kokoro" | "elevenlabs";
function resolveProvider(): Provider {
	const explicit = process.env.MALEO_TTS_PROVIDER?.trim().toLowerCase();
	if (explicit === "kokoro" || explicit === "elevenlabs") return explicit;
	if (process.env.MALEO_KOKORO_URL?.trim()) return "kokoro";
	return "elevenlabs";
}

export async function synthesize(opts: TTSOptions): Promise<TTSResult> {
	return resolveProvider() === "kokoro" ? synthesizeKokoro(opts) : synthesizeElevenLabs(opts);
}

// --- Kokoro: local TTS via its OpenAI-compatible HTTP server -----------------
async function synthesizeKokoro(opts: TTSOptions): Promise<TTSResult> {
	const base = (process.env.MALEO_KOKORO_URL ?? "http://127.0.0.1:8880").replace(/\/$/, "");
	const voice = opts.voiceId ?? process.env.MALEO_KOKORO_VOICE ?? "af_heart";
	const cacheDir = opts.cacheDir ?? path.resolve("public/voiceover");
	await fs.mkdir(cacheDir, { recursive: true });

	const hash = crypto
		.createHash("sha256")
		.update(`kokoro|${voice}|${opts.text}`)
		.digest("hex")
		.slice(0, 16);
	const audioPath = path.join(cacheDir, `${hash}.wav`);

	try {
		const stat = await fs.stat(audioPath);
		if (stat.size > 0) {
			return { audioPath, durationSec: await wavDuration(audioPath, opts.text), cached: true };
		}
	} catch {}

	const res = await fetchWithRetry(
		`${base}/v1/audio/speech`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json", Accept: "audio/wav" },
			body: JSON.stringify({ model: "kokoro", input: opts.text, voice, response_format: "wav" }),
		},
		{ label: `kokoro ${base}` },
	);
	const buf = Buffer.from(await res.arrayBuffer());
	await fs.writeFile(audioPath, buf);
	return { audioPath, durationSec: await wavDuration(audioPath, opts.text), cached: false };
}

// --- ElevenLabs (paid, original path) -----------------------------------------
async function synthesizeElevenLabs(opts: TTSOptions): Promise<TTSResult> {
	const apiKey = process.env.ELEVENLABS_API_KEY;
	const voiceId = opts.voiceId ?? process.env.ELEVENLABS_VOICE_ID ?? "21m00Tcm4TlvDq8ikWAM";
	const modelId = opts.modelId ?? "eleven_turbo_v2_5";
	const cacheDir = opts.cacheDir ?? path.resolve("public/voiceover");
	await fs.mkdir(cacheDir, { recursive: true });

	const hash = crypto
		.createHash("sha256")
		.update(`${voiceId}|${modelId}|${opts.text}`)
		.digest("hex")
		.slice(0, 16);
	const audioPath = path.join(cacheDir, `${hash}.mp3`);

	try {
		const stat = await fs.stat(audioPath);
		if (stat.size > 0) {
			return { audioPath, durationSec: estimateDuration(opts.text), cached: true };
		}
	} catch {}

	if (!apiKey) {
		throw new Error(
			"No TTS configured. Set MALEO_KOKORO_URL (free) or ELEVENLABS_API_KEY, or pre-generate cached audio.",
		);
	}

	const res = await fetchWithRetry(
		`${ELEVEN_API}/${voiceId}`,
		{
			method: "POST",
			headers: {
				"xi-api-key": apiKey,
				"Content-Type": "application/json",
				Accept: "audio/mpeg",
			},
			body: JSON.stringify({
				text: opts.text,
				model_id: modelId,
				voice_settings: { stability: 0.5, similarity_boost: 0.75 },
			}),
		},
		{ label: "elevenlabs" },
	);

	const buf = Buffer.from(await res.arrayBuffer());
	await fs.writeFile(audioPath, buf);
	return { audioPath, durationSec: estimateDuration(opts.text), cached: false };
}

function estimateDuration(text: string): number {
	const wpm = 160;
	const words = text.trim().split(/\s+/).length;
	return (words / wpm) * 60;
}

// Read true duration from a PCM WAV header (frames / sample rate). Falls back to
// the wpm estimate if the header can't be parsed — keeps caption/audio sync tied
// to the real audio length instead of a guess.
export async function wavDuration(filePath: string, fallbackText: string): Promise<number> {
	try {
		const fd = await fs.open(filePath, "r");
		try {
			const header = Buffer.alloc(44);
			await fd.read(header, 0, 44, 0);
			if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE") {
				return estimateDuration(fallbackText);
			}
			const byteRate = header.readUInt32LE(28); // bytes/sec
			const { size } = await fd.stat();
			const dataBytes = size - 44;
			if (byteRate > 0 && dataBytes > 0) return dataBytes / byteRate;
			return estimateDuration(fallbackText);
		} finally {
			await fd.close();
		}
	} catch {
		return estimateDuration(fallbackText);
	}
}

export type SceneVoiceover = {
	text: string;
	wordCount: number;
};

export type StoryboardTTSResult = {
	audioPath: string;
	totalDurationSec: number;
	sceneBoundaries: Array<{ startSec: number; endSec: number }>;
	cached: boolean;
};

export async function synthesizeStoryboard(
	scenes: ReadonlyArray<SceneVoiceover>,
	opts?: Omit<TTSOptions, "text">,
): Promise<StoryboardTTSResult> {
	// Synthesize each scene as its own request, then concatenate. One big request
	// for the whole narration is slow enough on a CPU TTS server to blow past
	// reverse-proxy timeouts (a ~250-word body can take >60s and 502); per-scene
	// requests stay small. It also yields real per-scene durations to time
	// captions against, instead of a word-count estimate.
	const cacheDir = opts?.cacheDir ?? path.resolve("public/voiceover");
	await fs.mkdir(cacheDir, { recursive: true });

	const parts: Array<{ path: string | null; durationSec: number }> = [];
	let allCached = true;
	for (const s of scenes) {
		const text = s.text.trim();
		if (!text) {
			parts.push({ path: null, durationSec: 0 });
			continue;
		}
		const r = await synthesize({ ...opts, text });
		allCached = allCached && r.cached;
		parts.push({ path: r.audioPath, durationSec: r.durationSec });
	}

	let cursor = 0;
	const sceneBoundaries = parts.map((p) => {
		const startSec = cursor;
		cursor += p.durationSec;
		return { startSec, endSec: cursor };
	});

	const clipPaths = parts.map((p) => p.path).filter((p): p is string => p !== null);
	const key = crypto.createHash("sha256").update(clipPaths.join("|")).digest("hex").slice(0, 16);
	const isWav = clipPaths.length > 0 && clipPaths.every((p) => p.endsWith(".wav"));
	const audioPath = path.join(cacheDir, `sb-${key}.${isWav ? "wav" : "mp3"}`);
	await concatAudio(clipPaths, audioPath, isWav);

	return {
		audioPath,
		totalDurationSec: cursor,
		sceneBoundaries,
		cached: allCached,
	};
}

// Concatenate per-scene clips into a single track. For PCM WAV (Kokoro) the
// data chunks are spliced under one corrected header; for MP3 (ElevenLabs CBR)
// raw frame concatenation plays back cleanly.
async function concatAudio(paths: string[], outPath: string, isWav: boolean): Promise<void> {
	if (paths.length === 0) return;
	const buffers = await Promise.all(paths.map((p) => fs.readFile(p)));
	if (!isWav) {
		await fs.writeFile(outPath, Buffer.concat(buffers));
		return;
	}
	const datas = buffers.map(wavDataChunk);
	const totalData = datas.reduce((n, d) => n + d.length, 0);
	const header = Buffer.from(buffers[0]!.subarray(0, 44)); // canonical 44-byte header
	header.writeUInt32LE(36 + totalData, 4); // RIFF chunk size
	header.writeUInt32LE(totalData, 40); // data subchunk size
	await fs.writeFile(outPath, Buffer.concat([header, ...datas]));
}

// Extract the PCM payload (the "data" subchunk) from a WAV buffer.
function wavDataChunk(buf: Buffer): Buffer {
	let off = 12; // skip RIFF/size/WAVE
	while (off + 8 <= buf.length) {
		const id = buf.toString("ascii", off, off + 4);
		const size = buf.readUInt32LE(off + 4);
		if (id === "data") return buf.subarray(off + 8, Math.min(off + 8 + size, buf.length));
		off += 8 + size + (size & 1); // chunks are word-aligned
	}
	return buf.subarray(44); // fallback: assume canonical header
}
