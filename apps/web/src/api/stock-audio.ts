/* The stock audio host table of this deployment, asked for once.
 *
 * The music library's bucket host is server configuration, so the api serves the
 * table the passthrough enforces and the timeline rewrites with the same one. A
 * failed request falls back to the shared hosts and is asked again next time:
 * music then plays through its own origin as before, rather than not at all. */
import { STOCK_AUDIO_HOST_KEYS, STOCK_AUDIO_HOSTS, type StockAudioHosts } from "@maleo/shared";
import { get } from "@api/client.ts";

let cached: Promise<StockAudioHosts> | undefined;

/** Only known keys with an https base are kept: the reply decides where audio is
 *  fetched from, so it is read field by field rather than trusted whole. */
export function readHosts(value: unknown): StockAudioHosts {
	if (typeof value !== "object" || value === null) return STOCK_AUDIO_HOSTS;
	const out: Partial<Record<(typeof STOCK_AUDIO_HOST_KEYS)[number], string>> = {};
	for (const key of STOCK_AUDIO_HOST_KEYS) {
		const host: unknown = Object.getOwnPropertyDescriptor(value, key)?.value;
		if (typeof host === "string" && /^https:\/\/[^/\s]+/.test(host)) out[key] = host;
	}
	return { ...STOCK_AUDIO_HOSTS, ...out };
}

export function stockAudioHosts(): Promise<StockAudioHosts> {
	cached ??= get<unknown>("/api/stock/audio-hosts").then(readHosts, () => {
		cached = undefined;
		return STOCK_AUDIO_HOSTS;
	});
	return cached;
}
