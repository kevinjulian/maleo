/* The curated music library: fetch the manifest, keep it, and match a cue to a bed.
 *
 * WHY MATCHING IS SCORED RATHER THAN FILTERED
 *
 * Cues arrive as free text written by a planner — "dark driving pulse", "tense
 * rising synth, ticking pulse" — and the library holds tens of beds, not
 * hundreds of thousands. Exact or substring matching would miss nearly
 * everything. Token overlap against the labels a human wrote is what makes a
 * small library usable, which is also why tags outweigh prose.
 *
 * WHY IT NEVER RETURNS NOTHING
 *
 * With a large catalogue, an empty result meant a bad query. With this one, "no
 * strong match" is ordinary. The previous provider answered valid searches with
 * an empty success roughly a quarter of the time and that silently dropped beds
 * from finished videos — the failure this library exists to remove. So while the
 * library is non-empty the best-scoring bed is returned, even at a score of
 * zero. An empty library is a different condition and is reported as such. */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import {
	musicManifestUrl,
	parseMusicManifest,
	type MusicBed,
	type MusicManifest,
} from "./music-manifest.ts";
import type { StockAudio } from "./types.ts";

/** How long a fetched manifest is trusted before revalidating. Short enough that
 *  publishing a bed shows up without a restart. */
const TTL_MS = 10 * 60 * 1000;

/** Where the last good manifest is kept. Generation is long-running and costly;
 *  losing music to a transient outage AFTER paying for voice and images is a
 *  worse trade than scoring against a slightly stale library. */
function cachePath(): string {
	return process.env.STOCK_MUSIC_CACHE?.trim() || join(tmpdir(), "maleo-music-manifest.json");
}

interface CacheState {
	manifest: MusicManifest | null;
	fetchedAt: number;
	etag?: string;
}
let state: CacheState = { manifest: null, fetchedAt: 0 };

export function clearMusicLibraryCache(): void {
	state = { manifest: null, fetchedAt: 0 };
}

// Test seam: replace the network without disabling the cache or the disk copy.
let fetchOverride:
	| ((url: string, etag?: string) => Promise<{ status: number; body?: unknown; etag?: string }>)
	| null = null;
export function setMusicFetchForTests(fn: typeof fetchOverride): void {
	fetchOverride = fn;
}

function readRetained(): MusicManifest | null {
	try {
		return parseMusicManifest(JSON.parse(readFileSync(cachePath(), "utf8")));
	} catch {
		return null;
	}
}

function retain(manifest: MusicManifest): void {
	try {
		const path = cachePath();
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, JSON.stringify(manifest));
	} catch {
		// A machine that cannot write its cache still works; it just loses the
		// offline fallback. Not worth failing a generation over.
	}
}

/** The library, fetched at most once per TTL. Falls back to the retained copy
 *  when the fetch fails, and to nothing only when there has never been one. */
export async function musicLibrary(): Promise<MusicBed[]> {
	if (state.manifest && Date.now() - state.fetchedAt < TTL_MS) return state.manifest.tracks;

	const url = musicManifestUrl();
	try {
		let body: unknown;
		let etag: string | undefined;
		if (fetchOverride) {
			const res = await fetchOverride(url, state.etag);
			// 304 means what we already hold is current.
			const held = state.manifest;
			// 304 means what is already held is current.
			if (res.status === 304 && held) {
				state = { ...state, fetchedAt: Date.now() };
				return held.tracks;
			}
			if (res.status !== 200) throw new Error(`manifest ${res.status}`);
			body = res.body;
			etag = res.etag;
		} else {
			const res = await fetch(url, {
				headers: state.etag ? { "if-none-match": state.etag } : {},
				signal: AbortSignal.timeout(15_000),
			});
			const held = state.manifest;
			if (res.status === 304 && held) {
				state = { ...state, fetchedAt: Date.now() };
				return held.tracks;
			}
			if (!res.ok) throw new Error(`manifest ${res.status}`);
			body = await res.json();
			etag = res.headers.get("etag") ?? undefined;
		}
		const manifest = parseMusicManifest(body);
		state = { manifest, fetchedAt: Date.now(), etag };
		retain(manifest);
		return manifest.tracks;
	} catch {
		if (state.manifest) return state.manifest.tracks;
		const retained = readRetained();
		if (retained) {
			state = { manifest: retained, fetchedAt: Date.now() };
			return retained.tracks;
		}
		return [];
	}
}

/* Weights follow how deliberate each label is. Tags are curated one at a time;
 * a description is prose and will incidentally contain common words. */
const WEIGHT_EMOTION = 5;
const WEIGHT_TAG = 3;
const WEIGHT_TITLE = 2;
const WEIGHT_DESCRIPTION = 1;

function tokens(value: string): string[] {
	return value
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((token) => token.length > 1);
}

/** Overlap score for one bed against one cue. Exported for the tests that pin
 *  the weighting, since the ordering it produces is the whole user-visible
 *  behaviour of the library. */
export function scoreBed(bed: MusicBed, cueTokens: string[], emotion?: string): number {
	if (!cueTokens.length && !emotion) return 0;
	let score = 0;
	if (emotion && bed.emotion && bed.emotion.toLowerCase() === emotion.toLowerCase())
		score += WEIGHT_EMOTION;
	const tagTokens = new Set(bed.tags.flatMap(tokens));
	const titleTokens = new Set(tokens(bed.title));
	const descTokens = new Set(tokens(bed.description));
	const emotionTokens = new Set(bed.emotion ? tokens(bed.emotion) : []);
	for (const token of new Set(cueTokens)) {
		if (tagTokens.has(token)) score += WEIGHT_TAG;
		if (titleTokens.has(token)) score += WEIGHT_TITLE;
		if (descTokens.has(token)) score += WEIGHT_DESCRIPTION;
		// An emotion named in the cue text counts even when the caller did not
		// pass one structurally.
		if (emotionTokens.has(token)) score += WEIGHT_TAG;
	}
	return score;
}

/** Best bed for a cue. Deterministic: score, then longer duration (a better bed),
 *  then id — so a preview and the rendered video never disagree. */
export function bestBed(
	beds: readonly MusicBed[],
	cue: string,
	emotion?: string,
): MusicBed | undefined {
	if (!beds.length) return undefined;
	const cueTokens = tokens(cue);
	let best: { bed: MusicBed; score: number } | undefined;
	for (const bed of beds) {
		const score = scoreBed(bed, cueTokens, emotion);
		if (
			!best ||
			score > best.score ||
			(score === best.score && bed.durationSec > best.bed.durationSec) ||
			(score === best.score && bed.durationSec === best.bed.durationSec && bed.id < best.bed.id)
		) {
			best = { bed, score };
		}
	}
	return best?.bed;
}

/** Resolve a cue to the shape the audio seam expects. Empty only when no library
 *  is published. */
export async function searchMusicLibrary(query: string, limit = 12): Promise<StockAudio[]> {
	const beds = await musicLibrary();
	if (!beds.length) return [];
	const cueTokens = tokens(query);
	const ranked = [...beds]
		.map((bed) => ({ bed, score: scoreBed(bed, cueTokens) }))
		.sort(
			(a, b) =>
				b.score - a.score ||
				b.bed.durationSec - a.bed.durationSec ||
				(a.bed.id < b.bed.id ? -1 : a.bed.id > b.bed.id ? 1 : 0),
		);
	return ranked.slice(0, limit).map(({ bed }): StockAudio => ({
		url: bed.url,
		title: bed.title,
		author: bed.license,
		durationSec: bed.durationSec,
	}));
}

/** The bed curated for an emotion, if the library has one. */
export async function musicBedForEmotion(emotion: string): Promise<MusicBed | undefined> {
	const beds = await musicLibrary();
	const wanted = emotion.trim().toLowerCase();
	if (!wanted) return undefined;
	return beds.find((bed) => bed.emotion?.toLowerCase() === wanted);
}

/** Whether a library has been published at all — the condition a surface reports
 *  rather than presenting as "no matches". */
export async function isMusicLibraryPublished(): Promise<boolean> {
	return (await musicLibrary()).length > 0;
}
