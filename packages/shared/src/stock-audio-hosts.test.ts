import { describe, expect, test } from "vite-plus/test";
import {
	sameOriginStockAudioUrl,
	stockAudioHostOf,
	STOCK_AUDIO_HOSTS,
	type StockAudioHosts,
} from "./stock-audio-hosts.ts";

/* The music library host is deployment configuration, so these tests pass it in
 * the way the web receives it from the api. */
const configured: StockAudioHosts = {
	...STOCK_AUDIO_HOSTS,
	music: "https://files.example.org/file/example-bucket",
};

describe("stock audio hosts", () => {
	test("a music library url at the configured base is rewritten onto this origin", () => {
		expect(
			sameOriginStockAudioUrl(
				"https://files.example.org/file/example-bucket/music/track-123.mp3",
				configured,
			),
		).toBe("/api/stock/audio/music/music/track-123.mp3");
	});

	test("without a configured music base, a music url is left alone", () => {
		// The shared table cannot know a deployment's bucket host; guessing one is
		// how a placeholder silently stopped every library bed from decoding.
		const url = "https://files.example.org/file/example-bucket/music/track-123.mp3";
		const shared: StockAudioHosts = STOCK_AUDIO_HOSTS;
		expect(shared.music).toBeUndefined();
		expect(sameOriginStockAudioUrl(url)).toBe(url);
	});

	test("a sound-effect url is rewritten the same way", () => {
		expect(
			sameOriginStockAudioUrl(`${STOCK_AUDIO_HOSTS.freesound}/previews/82/82378_605154-hq.mp3`),
		).toBe("/api/stock/audio/freesound/previews/82/82378_605154-hq.mp3");
	});

	test("a local upload is left exactly as it is", () => {
		// Same origin already: there was never a CORS or a caching problem here.
		expect(sameOriginStockAudioUrl("/uploads/vo-1.mp3", configured)).toBe("/uploads/vo-1.mp3");
	});

	test("an unknown host is not rerouted", () => {
		// The rewrite must not become a general request forwarder.
		const other = "https://example.com/previews/82/x.mp3";
		expect(sameOriginStockAudioUrl(other, configured)).toBe(other);
		expect(stockAudioHostOf(other, configured)).toBeNull();
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
		const musicLookalike = "https://files.example.org/file/example-bucket-evil/x.mp3";
		expect(stockAudioHostOf(musicLookalike, configured)).toBeNull();
	});
});
