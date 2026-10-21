/** Audio duration helpers shared by editor TTS, longform, and blueprint builds.
 *  Generated narration timing must come from the rendered audio, not word counts. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Measure a WAV clip's duration from its header (data bytes / byte-rate). */
export function measureWavDurationSec(bytes: Uint8Array): number | null {
	if (bytes.length < 44) return null;
	const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const tag = (off: number): string =>
		String.fromCharCode(bytes[off]!, bytes[off + 1]!, bytes[off + 2]!, bytes[off + 3]!);
	if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
	let byteRate = 0;
	let dataSize = 0;
	let off = 12;
	while (off + 8 <= bytes.length) {
		const id = tag(off);
		const size = dv.getUint32(off + 4, true);
		if (id === "fmt ") byteRate = dv.getUint32(off + 8 + 8, true);
		else if (id === "data") {
			/* A STREAMED wav cannot know its length when it writes the header, so it
			 * writes a placeholder — 0xFFFFFFFF or 0 — and the real length is however
			 * many bytes actually arrived. Kokoro's server streams, and trusting the
			 * declared size turned a five-second clip into a 24-hour one, which the
			 * timeline placed accordingly.
			 *
			 * Clamping to what is present is right for both kinds of file: a
			 * well-formed wav declares no more than it carries, so the clamp is a
			 * no-op there. */
			dataSize = Math.min(size, bytes.length - (off + 8));
			break;
		}
		/* A bogus size would otherwise walk the offset backwards or past the end and
		 * spin. Chunks are word-aligned, so a non-advancing step is malformed. */
		const step = 8 + size + (size % 2);
		if (step <= 0 || off + step <= off) return null;
		off += step;
	}
	if (byteRate <= 0 || dataSize <= 0) return null;
	return Math.round((dataSize / byteRate) * 1000) / 1000;
}

/** Measure audio duration from raw bytes. WAV is parsed directly; other formats
 *  return null so callers can fall back to ffprobe. */
export function measureAudioDurationSec(bytes: Uint8Array, ext: string): number | null {
	if (ext.toLowerCase() === "wav") return measureWavDurationSec(bytes);
	return null;
}

export async function probeAudioDurationSec(absPath: string): Promise<number | null> {
	try {
		const proc = Bun.spawn(
			[
				"ffprobe",
				"-v",
				"error",
				"-show_entries",
				"format=duration",
				"-of",
				"default=noprint_wrappers=1:nokey=1",
				absPath,
			],
			{ stdout: "pipe", stderr: "ignore" },
		);
		const out = (await new Response(proc.stdout).text()).trim();
		await proc.exited;
		const n = Number(out);
		return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) / 1000 : null;
	} catch {
		return null;
	}
}

export async function measureOrProbeAudioDurationSec(
	bytes: Uint8Array,
	ext: string,
): Promise<number | null> {
	const measured = measureAudioDurationSec(bytes, ext);
	if (measured != null) return measured;
	const dir = await mkdtemp(join(tmpdir(), "maleo-audio-probe-"));
	try {
		const path = join(dir, `clip.${ext}`);
		await Bun.write(path, bytes);
		return await probeAudioDurationSec(path);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
