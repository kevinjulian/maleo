/* Resolving an uploaded recording to a format.
 *
 * The case that made this a shared module rather than a MIME map in the route:
 * a real `.m4a` from macOS arrives as `audio/x-m4a`, the route's list had
 * `audio/mp4`, and a perfectly good recording was refused as unsupported.
 */
import { describe, expect, test } from "vite-plus/test";
import {
	VOICE_CLONE_AUDIO_ACCEPT,
	VOICE_CLONE_AUDIO_EXTENSIONS,
	voiceCloneAudioFormat,
} from "./voice-clone-audio.ts";

describe("the extension decides", () => {
	test("accepts the m4a that platform MIME matching refused", () => {
		expect(voiceCloneAudioFormat("Suara Kevin.m4a", "audio/x-m4a")?.ext).toBe("m4a");
	});

	test("accepts the same container under every platform's spelling", () => {
		for (const type of ["audio/mp4", "audio/x-m4a", "audio/m4a"]) {
			expect(voiceCloneAudioFormat("voice.m4a", type)?.ext).toBe("m4a");
		}
	});

	/* An OS with no mapping registered sends an empty type. The file is still a
	 * recording and the operator can still see what it is. */
	test("accepts a known extension when the browser sends no type at all", () => {
		expect(voiceCloneAudioFormat("voice.wav", "")?.ext).toBe("wav");
		expect(voiceCloneAudioFormat("voice.flac", undefined)?.ext).toBe("flac");
	});

	test("is case-insensitive about the extension", () => {
		expect(voiceCloneAudioFormat("VOICE.M4A", "")?.ext).toBe("m4a");
	});

	test("accepts every advertised extension", () => {
		for (const ext of VOICE_CLONE_AUDIO_EXTENSIONS) {
			expect(voiceCloneAudioFormat(`voice.${ext}`, "")?.ext).toBe(ext);
		}
	});
});

describe("the MIME type is the fallback", () => {
	test("resolves a file with no extension by its type", () => {
		expect(voiceCloneAudioFormat("recording", "audio/mpeg")?.ext).toBe("mp3");
	});

	test("ignores MIME parameters", () => {
		expect(voiceCloneAudioFormat("recording", "audio/ogg; codecs=opus")?.ext).toBe("ogg");
	});

	test("resolves a dotfile with no suffix by its type", () => {
		expect(voiceCloneAudioFormat(".wav", "audio/wav")?.ext).toBe("wav");
	});
});

describe("refusals", () => {
	test("refuses a document whatever it is called", () => {
		expect(voiceCloneAudioFormat("notes.pdf", "application/pdf")).toBeNull();
	});

	test("refuses a file with neither a known extension nor a known type", () => {
		expect(voiceCloneAudioFormat("recording", "")).toBeNull();
		expect(voiceCloneAudioFormat(undefined, undefined)).toBeNull();
	});

	/* Video is the likely mistake — a phone clip of someone talking — and it is
	 * still refused, because the model takes an audio prompt. */
	test("refuses video", () => {
		expect(voiceCloneAudioFormat("clip.mp4", "video/mp4")).toBeNull();
	});
});

describe("the accept attribute", () => {
	test("offers every extension, so the picker greys out the rest", () => {
		for (const ext of VOICE_CLONE_AUDIO_EXTENSIONS) {
			expect(VOICE_CLONE_AUDIO_ACCEPT).toContain(`.${ext}`);
		}
	});

	test("also carries the MIME types, for platforms that match on those", () => {
		expect(VOICE_CLONE_AUDIO_ACCEPT).toContain("audio/x-m4a");
	});

	/* `audio/*` is what the picker had, and it is what let a file be chosen that
	 * the upload then refused. */
	test("is not a wildcard", () => {
		expect(VOICE_CLONE_AUDIO_ACCEPT).not.toContain("audio/*");
	});
});
