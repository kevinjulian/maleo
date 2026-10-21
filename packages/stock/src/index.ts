/* @maleo/stock — licensed media we FETCH, as opposed to @maleo/media which
 * GENERATES.
 *
 *   media  →  costs credits, nondeterministic, needs a backend
 *   stock  →  licensed, deterministic, cacheable, needs an API key
 *   baked  →  stock pulled local, so generation never touches the network
 *
 * Adapters live together in one package rather than one package per source
 * because they are thin HTTP clients, not deployable services (which is what
 * each media-provider-* package is). They share the response cache, the
 * rate-limit capture, the canonical result shape, and the "no key yields an
 * empty result rather than a throw" contract — all of which were previously
 * duplicated across two route files and a lib, or simply missing. */

export {
	PEXELS_API_KEY,
	isPexelsConfigured,
	pexelsKey,
	probePexels,
	searchPexelsImages,
	searchPexelsVideos,
	setPexelsFetchForTests,
} from "./pexels.ts";

export {
	FREESOUND_API_KEY,
	FREESOUND_COMMERCIAL_USE_APPROVED,
	FREESOUND_LICENSE_FILTER,
	freesoundKey,
	isFreesoundConfigured,
	probeFreesound,
	searchFreesoundSfx,
	setFreesoundFetchForTests,
} from "./freesound.ts";
export { PROVIDERS, getProvider } from "./providers.ts";
export type { StockCapability, StockProvider, StockProviderHealth } from "./providers.ts";
export {
	searchMusicLibrary,
	musicLibrary,
	musicBedForEmotion,
	isMusicLibraryPublished,
	bestBed,
	scoreBed,
	clearMusicLibraryCache,
	setMusicFetchForTests,
} from "./music-library.ts";
export {
	parseMusicManifest,
	musicManifestUrl,
	musicBedUrl,
	musicBaseUrl,
	MUSIC_MANIFEST_VERSION,
	MUSIC_PUBLIC_HOST,
	MUSIC_BUCKET,
	MUSIC_PREFIX_DEFAULT,
	musicHost,
	musicBucket,
	musicPrefix,
	baseUrlMatchesBucket,
} from "./music-manifest.ts";
export type { MusicBed, MusicManifest } from "./music-manifest.ts";
export { findDuplicates, assignUniqueIds, dropDuplicateAudio } from "./music-dedup.ts";
export type { PreparedTrack, DuplicateProblem } from "./music-dedup.ts";
export { planPublish, describePlan } from "./music-publish-plan.ts";
export type { PublishPlan, PublishedBed, PlannablePrepared } from "./music-publish-plan.ts";
export { compileManifest, describeCompile, isCarried } from "./music-compile.ts";
export type {
	CompiledTrack,
	CompileResult,
	SidecarTrack,
	PublishedTrack,
} from "./music-compile.ts";
export {
	planEnrich,
	describeEnrichPlan,
	needsEnrichment,
	buildEnrichPrompt,
	parseEnrichment,
	applyEnrichment,
} from "./music-enrich.ts";
export type { EnrichableBed, Enrichment, EnrichPlan } from "./music-enrich.ts";
export {
	searchStockAudio,
	resolveStockAudio,
	resolveStockAudioCue,
	resolveStockAudioPool,
	clearStockAudioCache,
	setStockAudioResolverForTests,
	setStockSearchForTests,
} from "./audio.ts";

export { clearStockCache, getStockRateInfo, captureDrops, getStockDropInfo } from "./cache.ts";

export type {
	StockAsset,
	StockKind,
	StockAudio,
	StockAudioKind,
	StockSearchLimit,
	StockProviderReachability,
	BakedMusicTrack,
} from "./types.ts";
