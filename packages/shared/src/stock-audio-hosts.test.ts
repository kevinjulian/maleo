import { describe, expect, test } from "vite-plus/test";
import {
	sameOriginStockAudioUrl,
	stockAudioHostOf,
	STOCK_AUDIO_HOSTS,
} from "./stock-audio-hosts.ts";

describe("stock audio hosts", () => {
	test("a music library url is rewritten onto this origin, path intact", () => {
		expect(
			sameOriginStockAudioUrl(`${STOCK_AUDIO_HOSTS.music}/file/example-bucket/music/track-123.mp3`),
		).toBe("/api/stock/audio/music/file/example-bucket/music/track-123.mp3");
	});

	test("a sound-effect url is rewritten the same way", () => {
		expect(
			sameOriginStockAudioUrl(`${STOCK_AUDIO_HOSTS.freesound}/previews/82/82378_605154-hq.mp3`),
		).toBe("/api/stock/audio/freesound/previews/82/82378_605154-hq.mp3");
	});

	test("a local upload is left exactly as it is", () => {
		// Same origin already: there was never a CORS or a caching problem here.
		expect(sameOriginStockAudioUrl("/uploads/vo-1.mp3")).toBe("/uploads/vo-1.mp3");
	});

	test("an unknown host is not rerouted", () => {
		// The rewrite must not become a general request forwarder.
		const other = "https://example.com/previews/82/x.mp3";
		expect(sameOriginStockAudioUrl(other)).toBe(other);
		expect(stockAudioHostOf(other)).toBeNull();
	});

	test("a host with nothing after it is left alone", () => {
		expect(sameOriginStockAudioUrl(STOCK_AUDIO_HOSTS.freesound)).toBe(STOCK_AUDIO_HOSTS.freesound);
		expect(sameOriginStockAudioUrl(`${STOCK_AUDIO_HOSTS.freesound}/`)).toBe(
			`${STOCK_AUDIO_HOSTS.freesound}/`,
		);
	});

	test("a traversal is refused rather than normalised", () => {
		const escape = `${STOCK_AUDIO_HOSTS.freesound}/previews/../../etc/passwd`;
		expect(sameOriginStockAudioUrl(escape)).toBe(escape);
		const doubled = `${STOCK_AUDIO_HOSTS.freesound}/previews//82/x.mp3`;
		expect(sameOriginStockAudioUrl(doubled)).toBe(doubled);
	});

	test("a near-miss host is not matched by prefix", () => {
		// `cdn.freesound.org.evil.com` must not read as the sfx host.
		const lookalike = `${STOCK_AUDIO_HOSTS.freesound}.evil.com/previews/x.mp3`;
		expect(stockAudioHostOf(lookalike)).toBeNull();
	});
});
