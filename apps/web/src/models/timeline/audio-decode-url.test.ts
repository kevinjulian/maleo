import { describe, expect, test } from "vite-plus/test";
import type { StockAudioHosts } from "@maleo/shared";
import { decodableAudioUrl } from "./audio-decode-url.ts";

const hosts: StockAudioHosts = {
	freesound: "https://cdn.freesound.org",
	music: "https://files.example.org/file/example-bucket",
};

describe("decodableAudioUrl", () => {
	test("a music-library url at the deployment's base becomes a same-origin path", () => {
		expect(
			decodableAudioUrl("https://files.example.org/file/example-bucket/music/track-123.mp3", hosts),
		).toBe("/api/stock/audio/music/music/track-123.mp3");
	});

	test("a local upload is left exactly as it is", () => {
		// These already decode: same origin, so there was never a CORS problem.
		expect(decodableAudioUrl("/uploads/vo-1.mp3", hosts)).toBe("/uploads/vo-1.mp3");
	});

	test("an unrelated host is not rerouted", () => {
		// The rewrite must not become a general request forwarder.
		const other = "https://example.com/file/example-bucket/music/x.mp3";
		expect(decodableAudioUrl(other, hosts)).toBe(other);
	});

	test("a sound-effect url is rewritten too, which is what makes it cacheable", () => {
		expect(decodableAudioUrl("https://cdn.freesound.org/previews/82/82378_605154-hq.mp3")).toBe(
			"/api/stock/audio/freesound/previews/82/82378_605154-hq.mp3",
		);
	});
});
