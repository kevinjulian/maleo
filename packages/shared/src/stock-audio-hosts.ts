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

export const STOCK_AUDIO_HOST_KEYS = ["music", "freesound"] as const;
export type StockAudioHostKey = (typeof STOCK_AUDIO_HOST_KEYS)[number];

/** Each known host by key. A missing key is a host this deployment does not
 *  configure, and its urls are left untouched. */
export type StockAudioHosts = Readonly<Partial<Record<StockAudioHostKey, string>>>;

/** The hosts every deployment shares. The music library has no entry here: its
 *  bucket is deployment configuration (`STOCK_MUSIC_HOST`, `STOCK_MUSIC_BASE_URL`)
 *  that only the api can read, so the api serves the full table and the web
 *  rewrites with that. */
export const STOCK_AUDIO_HOSTS = {
	/** Freesound preview mp3s, which is what the sfx picker stores. */
	freesound: "https://cdn.freesound.org",
} as const satisfies StockAudioHosts;

/** The path prefix the api mounts the passthrough on. */
export const STOCK_AUDIO_PATH = "/api/stock/audio";

/** Which known host a url belongs to, and what follows it. */
export function stockAudioHostOf(
	url: string,
	hosts: StockAudioHosts = STOCK_AUDIO_HOSTS,
): { key: StockAudioHostKey; rest: string } | null {
	for (const key of STOCK_AUDIO_HOST_KEYS) {
		const host = hosts[key]?.replace(/\/+$/, "");
		if (!host || !url.startsWith(`${host}/`)) continue;
		return { key, rest: url.slice(host.length + 1) };
	}
	return null;
}

/** A stock-audio url rewritten onto this origin, or the url unchanged.
 *
 *  Refuses anything that could escape the host it names — a traversal segment or
 *  an empty path is left alone rather than normalised, because a rewrite that
 *  "fixes" a suspicious path is how a passthrough turns into a forwarder. */
export function sameOriginStockAudioUrl(
	url: string,
	hosts: StockAudioHosts = STOCK_AUDIO_HOSTS,
): string {
	const match = stockAudioHostOf(url, hosts);
	if (!match) return url;
	const { key, rest } = match;
	if (!rest || rest.includes("..") || rest.includes("//")) return url;
	return `${STOCK_AUDIO_PATH}/${key}/${rest}`;
}
