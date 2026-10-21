/* Shapes for licensed, fetched media.
 *
 * The distinction this package encodes: @maleo/media GENERATES assets (costs
 * credits, nondeterministic, needs a backend). Stock is FETCHED — licensed,
 * deterministic, cacheable, needs an API key. "Baked" is stock pulled local so
 * generation never touches the network; it is a form of stock, not a fourth
 * thing. */

export type StockKind = "image" | "video" | "audio";

/** Paging for a visual search. */
export interface StockSearchLimit {
	perPage?: number;
	page?: number;
}

/** The canonical result. Deliberately richer than either route's wire shape so
 *  callers can map DOWN rather than re-fetching what they are missing.
 *
 * `license` / `pageUrl` / `author` are not decoration: Pexels and Pixabay both
 * ask that results show where media came from, and a Content ID claim on a music
 * bed is answered with provenance. A shape without them forces every caller to
 * invent its own. */
export interface StockAsset {
	id: string;
	kind: StockKind;
	/** "Pexels" | "Freesound" | "Local" — shown in attribution. */
	provider: string;
	/** The playable / downloadable asset. */
	url: string;
	thumbUrl?: string;
	/** Provider page for this asset — the attribution target. */
	pageUrl?: string;
	title?: string;
	author?: string;
	authorUrl?: string;
	durationSec?: number;
	license?: string;
	licenseUrl?: string;
	tags?: string[];
}

/* ── Audio ────────────────────────────────────────────────────────────────
 *
 * The agent path resolves audio cues to a narrower shape and a dozen call sites
 * depend on it, so it stays exactly as it was when this lived in
 * apps/api/src/lib/stock-audio.ts. Moving a file and changing its contract
 * in the same step is how a migration turns into a debugging session. */

export interface StockAudio {
	url: string;
	/** Original provider/listing page for locally curated audio. */
	source?: string;
	title?: string;
	author?: string;
	authorUrl?: string;
	pageUrl?: string;
	license?: string;
	licenseUrl?: string;
	durationSec?: number;
}

export type StockAudioKind = "music" | "ambient" | "sfx" | "accent_hit";

export interface StockProviderReachability {
	ok: boolean;
	reason?: string;
}

/** One baked background-music bed, read from local disk. */
export interface BakedMusicTrack {
	id: string;
	/** Path served by the API host, e.g. /uploads/music/calm.mp3 */
	url: string;
	title: string;
	durationSec: number;
	/** Where the operator obtained it, recorded at bake time so a Content ID
	 *  claim can be answered with provenance rather than a guess. */
	source: string;
	license: string;
	/** Emotion this bed scores, matching the timeline template's music map. */
	emotion?: string;
}
