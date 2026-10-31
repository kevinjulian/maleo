/* Where the timeline fetches stock audio from.
 *
 * Playing a track and decoding one have different requirements: an <audio>
 * element will play a cross-origin file happily, while `decodeAudioData` needs
 * the bytes, and neither stock host sends an `Access-Control-Allow-Origin`. The
 * result was a timeline where local `/uploads` audio drew a waveform and every
 * stock clip fell back to its label — a difference that looked like a waveform
 * bug and was entirely about the origin.
 *
 * Playback goes through the same rewrite now, for a second reason: the
 * sound-effect CDN sends no `cache-control` at all, so a project with thirty
 * effect clips re-downloaded the same file every session. The passthrough sets
 * one.
 *
 * The host list, and the guarantee that nothing outside it is rewritten, live in
 * `@maleo/shared` — the api enforces the same list on the other end, and two
 * copies of that list is how a passthrough ends up forwarding somewhere its
 * server never agreed to. The music library's host is deployment configuration,
 * so callers pass the table the api serves (`@api/stock-audio.ts`); without it
 * only the shared hosts are rewritten.
 */
import { sameOriginStockAudioUrl, type StockAudioHosts } from "@maleo/shared";

/** A stock-audio url rewritten onto this origin; anything else untouched. */
export function decodableAudioUrl(url: string, hosts?: StockAudioHosts): string {
	return sameOriginStockAudioUrl(url, hosts);
}
