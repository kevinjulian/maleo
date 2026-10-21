/* What a voice clone's reference recording may be, stated once.
 *
 * Three surfaces need this list and must not each hold their own: the upload
 * route refuses everything outside it, the file picker restricts what can be
 * chosen, and the form tells the operator which extensions work. A second copy
 * is how a picker comes to offer a file the route then rejects — which is
 * exactly what happened with `.m4a`.
 *
 * MATCHING IS BY EXTENSION FIRST, MIME SECOND, and that ordering is the fix.
 * A browser's `File.type` for the same container varies by platform: macOS
 * reports `.m4a` as `audio/x-m4a`, others as `audio/mp4`, and some send an
 * empty string when the OS has no mapping registered at all. A check written
 * against one machine's MIME strings refuses real audio on another's, with a
 * message that reads as "your file is wrong" rather than "we guessed badly".
 * The extension is what the operator can see and reason about, so it decides;
 * the MIME aliases only widen acceptance, never narrow it.
 */

export interface VoiceCloneAudioFormat {
	/** Lowercase extension, without the dot. Also the stored file's suffix. */
	ext: string;
	/** Every `File.type` seen for this container across platforms. */
	types: readonly string[];
}

export const VOICE_CLONE_AUDIO_FORMATS: readonly VoiceCloneAudioFormat[] = [
	{ ext: "wav", types: ["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"] },
	{ ext: "mp3", types: ["audio/mpeg", "audio/mp3", "audio/x-mpeg"] },
	{ ext: "m4a", types: ["audio/mp4", "audio/x-m4a", "audio/m4a"] },
	{ ext: "aac", types: ["audio/aac", "audio/aacp", "audio/x-aac"] },
	{ ext: "flac", types: ["audio/flac", "audio/x-flac"] },
	{ ext: "ogg", types: ["audio/ogg", "application/ogg", "audio/vorbis"] },
	{ ext: "opus", types: ["audio/opus"] },
	{ ext: "webm", types: ["audio/webm"] },
];

/** The extensions, for a message an operator reads. */
export const VOICE_CLONE_AUDIO_EXTENSIONS: readonly string[] = VOICE_CLONE_AUDIO_FORMATS.map(
	(format) => format.ext,
);

/* The `accept` attribute for a file input.
 *
 * Both halves are deliberate. The extensions are what makes the OS picker grey
 * out files that cannot be used — the point of restricting it at all — and the
 * MIME types keep platforms that match on type rather than suffix working. An
 * `accept` of `audio/*` let an operator choose a file the route then refused,
 * which is the worst order to discover it in. */
export const VOICE_CLONE_AUDIO_ACCEPT: string = [
	...VOICE_CLONE_AUDIO_FORMATS.map((format) => `.${format.ext}`),
	...VOICE_CLONE_AUDIO_FORMATS.flatMap((format) => format.types),
].join(",");

/** The extension of `filename`, lowercased, or "" when it has none. */
function extensionOf(filename: string): string {
	const dot = filename.lastIndexOf(".");
	if (dot < 1 || dot === filename.length - 1) return "";
	return filename.slice(dot + 1).toLowerCase();
}

/* The format this upload is, or null when it is not one we accept.
 *
 * The extension decides. A recognised extension is accepted whatever the
 * browser called it — including when it called it nothing — because the
 * extension is the operator's own description of the file. A file with no
 * usable extension still resolves when its MIME type names a format, which
 * covers a recording handed over from a clipboard or a share sheet with a
 * generated name.
 *
 * `null` is a refusal, and the caller reports the supported list rather than
 * the type it rejected: "audio/x-m4a is unsupported" told an operator nothing
 * they could act on. */
export function voiceCloneAudioFormat(
	filename: string | undefined,
	mimeType: string | undefined,
): VoiceCloneAudioFormat | null {
	const ext = extensionOf(filename ?? "");
	const byExt = VOICE_CLONE_AUDIO_FORMATS.find((format) => format.ext === ext);
	if (byExt) return byExt;

	// A MIME type may carry parameters (`audio/ogg; codecs=opus`); only the
	// essence names the format.
	const essence = (mimeType ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
	if (!essence) return null;
	return VOICE_CLONE_AUDIO_FORMATS.find((format) => format.types.includes(essence)) ?? null;
}
