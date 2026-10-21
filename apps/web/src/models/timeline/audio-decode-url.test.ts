import { describe, expect, test } from "vite-plus/test";
import { MUSIC_PUBLIC_HOST } from "@maleo/shared";
import { decodableAudioUrl } from "./audio-decode-url.ts";

describe("decodableAudioUrl", () => {
	test("a music-library url becomes a same-origin passthrough path", () => {
		expect(decodableAudioUrl(`${MUSIC_PUBLIC_HOST}/file/example-bucket/music/track-123.mp3`)).toBe(
			"/api/stock/audio/music/file/example-bucket/music/track-123.mp3",
		);
	});

	test("a local upload is left exactly as it is", () => {
		// These already decode: same origin, so there was never a CORS problem.
		expect(decodableAudioUrl("/uploads/vo-1.mp3")).toBe("/uploads/vo-1.mp3");
	});

	test("an unrelated host is not rerouted", () => {
		// The rewrite must not become a general request forwarder.
		const other = "https://example.com/file/example-bucket/music/x.mp3";
		expect(decodableAudioUrl(other)).toBe(other);
	});

	test("a sound-effect url is rewritten too, which is what makes it cacheable", () => {
		expect(decodableAudioUrl("https://cdn.freesound.org/previews/82/82378_605154-hq.mp3")).toBe(
			"/api/stock/audio/freesound/previews/82/82378_605154-hq.mp3",
		);
	});
});
