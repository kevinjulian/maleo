import { entriesOf } from "@maleo/shared";
/* The third-party hosts stock audio is served from, and the same-origin path
 * the api forwards to each of them.
 *
 * Two problems, one shape. Neither host sends an `Access-Control-Allow-Origin`,
 * so the timeline can PLAY their files but not decode them — a stock clip fell
 * back to its label where a local upload drew a waveform, which looks like a
 * waveform bug and is entirely about the origin. And the sound-effect CDN sends
 * no `cache-control` at all, so a project with thirty effect clips re-downloads
 * the same file on every session.
 *
 * A key names the host; the caller never supplies one. Anything the map does not
 * name is returned untouched, so this cannot become a general request forwarder
 * — the property worth keeping as the list grows.
 */

export const STOCK_AUDIO_HOSTS = {
	/** The project's own music library bucket. */
	music: "https://media.example.com",
	/** Freesound preview mp3s, which is what the sfx picker stores. */
	freesound: "https://cdn.freesound.org",
} as const;

export type StockAudioHostKey = keyof typeof STOCK_AUDIO_HOSTS;

/** The path prefix the api mounts the passthrough on. */
export const STOCK_AUDIO_PATH = "/api/stock/audio";

/** Which known host a url belongs to, and what follows it. */
export function stockAudioHostOf(url: string): { key: StockAudioHostKey; rest: string } | null {
	for (const [key, host] of entriesOf(STOCK_AUDIO_HOSTS)) {
		if (!url.startsWith(`${host}/`)) continue;
		return { key, rest: url.slice(host.length + 1) };
	}
	return null;
}

/** A stock-audio url rewritten onto this origin, or the url unchanged.
 *
 *  Refuses anything that could escape the host it names — a traversal segment or
 *  an empty path is left alone rather than normalised, because a rewrite that
 *  "fixes" a suspicious path is how a passthrough turns into a forwarder. */
export function sameOriginStockAudioUrl(url: string): string {
	const match = stockAudioHostOf(url);
	if (!match) return url;
	const { key, rest } = match;
	if (!rest || rest.includes("..") || rest.includes("//")) return url;
	return `${STOCK_AUDIO_PATH}/${key}/${rest}`;
}
