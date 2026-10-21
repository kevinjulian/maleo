/* Background-music resolution for the longform timeline.
 *
 * One place decides which bed plays over which stretch of the video, because the
 * full generation pass and single-section regeneration both need the answer and
 * must agree — a regenerated section that disagreed with its neighbours would
 * restart the score mid-chapter.
 *
 * The shape mirrors the template's SFX handling: a pinned url beats any cue, a
 * cue resolves through the cached royalty-free lookup, and an unresolvable cue
 * omits its bed rather than emitting a clip the renderer cannot play. */

import type { Emotion, TimelineMusicEmotionCue, TimelineTemplate } from "@maleo/shared";
import type { StorySection } from "@maleo/shared/agent-wire";
import { DEFAULT_TIMELINE_TEMPLATE } from "@maleo/shared";
import { resolveStockAudioPool, type StockAudio } from "@maleo/stock";

/** One stretch of the video covered by a single bed, as section indices into the
 *  ordered section list (inclusive on both ends). `url` is undefined when the cue
 *  resolved to nothing — the span is then left silent. */
export interface MusicBedSpan {
	url: string | undefined;
	cue: string;
	fromIndex: number;
	toIndex: number;
}

type MusicTemplate = Pick<
	TimelineTemplate,
	"musicCue" | "musicUrl" | "musicPolicy" | "musicEmotionCues"
>;

/** What governs a section's bed: its emotion's entry when the template maps that
 *  emotion, else the template's default. Sections with no emotion, and emotions the
 *  operator left unset or left blank, all land on the default.
 *
 *  A per-emotion `url` is an asset the operator auditioned and pinned, so it wins
 *  over that emotion's cue and costs no provider lookup. Under the `single` policy
 *  the template-level `musicUrl` plays the same role for the whole video; it does
 *  NOT override per-emotion choices, since "one pinned bed everywhere" and "a bed
 *  per emotion" are opposite intents. */
export function musicChoiceForSection(
	template: MusicTemplate,
	emotion: Emotion | undefined,
): TimelineMusicEmotionCue {
	const mapped = emotion ? template.musicEmotionCues?.[emotion] : undefined;
	const url = mapped?.url?.trim();
	const cue = mapped?.cue?.trim();
	if (url || cue) return { cue: cue ?? "", url: url ?? "" };
	return defaultMusicChoice(template);
}

function defaultMusicChoice(template: MusicTemplate): TimelineMusicEmotionCue {
	return {
		cue: (template.musicCue || DEFAULT_TIMELINE_TEMPLATE.musicCue).trim(),
		url: template.musicUrl?.trim() ?? "",
	};
}

/** The cue text governing a section, ignoring any pinned asset. */
export function musicCueForSection(template: MusicTemplate, emotion: Emotion | undefined): string {
	return musicChoiceForSection(template, emotion).cue;
}

/** Spans merge on this: two emotions pinned to the same asset are one continuous
 *  stretch of music even when their cue text differs, and vice versa. */
function mergeKey(choice: TimelineMusicEmotionCue): string {
	return choice.url ? `url:${choice.url}` : `cue:${choice.cue}`;
}

/** Group an ordered section list into spans of one cue each. Consecutive sections
 *  sharing a cue collapse into one span, so a run of same-emotion sections plays a
 *  continuous bed instead of restarting the same file at each boundary.
 *
 *  Under the `single` policy the whole video is one span, which is the historical
 *  behaviour and stays the default. */
export function planMusicSpans(
	template: MusicTemplate,
	sections: Array<Pick<StorySection, "emotion">>,
): PlannedMusicSpan[] {
	if (!sections.length) return [];
	if (template.musicPolicy !== "per_emotion") {
		const choice = defaultMusicChoice(template);
		return [{ ...choice, key: mergeKey(choice), fromIndex: 0, toIndex: sections.length - 1 }];
	}
	const spans: PlannedMusicSpan[] = [];
	sections.forEach((section, index) => {
		const choice = musicChoiceForSection(template, section.emotion);
		const key = mergeKey(choice);
		const open = spans[spans.length - 1];
		if (open && open.key === key) open.toIndex = index;
		else spans.push({ ...choice, key, fromIndex: index, toIndex: index });
	});
	return spans;
}

/** A span before its cue has been resolved to a playable asset. `pinnedUrl` is set
 *  when the operator already chose the track. */
export interface PlannedMusicSpan extends TimelineMusicEmotionCue {
	key: string;
	fromIndex: number;
	toIndex: number;
}

/** A cue to the asset it resolved to. Built once per generation run and reused for
 *  every reassembly, which is what keeps the network out of the synchronous
 *  timeline-assembly path. */
export type MusicCueUrls = ReadonlyMap<string, string | undefined>;

/** Resolve every cue the plan can call for, once.
 *
 *  A pinned template url wins outright and costs no provider call. Otherwise each
 *  DISTINCT cue is resolved once per build and shared across the spans that use it,
 *  so an A-B-A arc pays for two lookups, not three — on top of the resolver's own
 *  24h cache, which makes a fixed cue vocabulary effectively free across projects.
 *
 *  Resolution covers ALL sections, not just the ready ones, so a run that assembles
 *  progressively never has to reach for the network again as later sections land. */
export async function resolveMusicCueUrls(
	template: MusicTemplate,
	sections: Array<Pick<StorySection, "emotion">>,
	placeholderUrl?: string,
): Promise<MusicCueUrls> {
	const resolved = new Map<string, string | undefined>();
	for (const span of planMusicSpans(template, sections)) {
		if (resolved.has(span.key)) continue;
		// A pinned asset is already the answer — no provider call, no chance of a miss.
		resolved.set(span.key, span.url || (await resolveCue(span.cue, placeholderUrl)));
	}
	// Nothing failed — no reason to look up the default as well.
	if (![...resolved.values()].some((url) => !url)) return resolved;

	// An emotion cue that resolved to nothing falls back to the default bed rather
	// than leaving that section silent. A transient empty result can blank a
	// perfectly good cue, and the miss is then cached. A slightly-wrong
	// bed beats a silent chapter; only a default that also fails leaves silence.
	const fallback = defaultMusicChoice(template);
	const fallbackUrl =
		fallback.url ||
		resolved.get(mergeKey(fallback)) ||
		(await resolveCue(fallback.cue, placeholderUrl));
	if (!fallbackUrl) return resolved;
	for (const [key, url] of resolved) if (!url) resolved.set(key, fallbackUrl);
	return resolved;
}

/** Spans for the sections placed so far, with each cue's already-resolved url
 *  attached. Synchronous by design: timeline assembly runs after every section
 *  completes and must not re-hit a provider. A cue missing from the map (a section
 *  whose emotion arrived after resolution) leaves its span silent. */
export function musicSpansFor(
	template: MusicTemplate,
	sections: Array<Pick<StorySection, "emotion">>,
	urls: MusicCueUrls,
): MusicBedSpan[] {
	return planMusicSpans(template, sections).map(({ key, cue, url, fromIndex, toIndex }) => ({
		cue,
		fromIndex,
		toIndex,
		url: url || urls.get(key),
	}));
}

/** Resolve and build in one step, for callers that are already async and assemble
 *  the timeline exactly once. */
export async function resolveMusicSpans(
	template: MusicTemplate,
	sections: Array<Pick<StorySection, "emotion">>,
	placeholderUrl?: string,
): Promise<MusicBedSpan[]> {
	return musicSpansFor(
		template,
		sections,
		await resolveMusicCueUrls(template, sections, placeholderUrl),
	);
}

/** A bed shorter than the stretch it covers leaves the rest of that section silent:
 *  the renderer plays each audio clip once and does not loop it. Stock catalogues mix
 *  full tracks with stingers a few seconds long, so the FIRST search result is often
 *  unusable as a bed even when the cue itself is good. */
export const MIN_MUSIC_BED_SEC = 60;

/** One cue to one url. Prefers a candidate long enough to hold a bed, then the
 *  longest on offer, before settling for the first. Falls back to the configured
 *  placeholder so the feature can be exercised without a provider key; returns
 *  undefined when neither is available and the caller leaves that stretch silent. */
async function resolveCue(cue: string, placeholderUrl?: string): Promise<string | undefined> {
	const query = cue.trim();
	if (query) {
		try {
			const candidates = await resolveStockAudioPool("music", [query], 8);
			const best = pickBedTrack(candidates);
			if (best?.url) return best.url;
		} catch {
			// resolver unavailable (no key / network) — fall through to the placeholder.
		}
	}
	return placeholderUrl || undefined;
}

/** First candidate that can cover a typical section, else the longest known, else
 *  the first. Candidates without a duration are trusted only as a last resort. */
export function pickBedTrack(candidates: readonly StockAudio[]): StockAudio | undefined {
	if (!candidates.length) return undefined;
	const longEnough = candidates.find((track) => (track.durationSec ?? 0) >= MIN_MUSIC_BED_SEC);
	if (longEnough) return longEnough;
	const measured = candidates.filter((track) => typeof track.durationSec === "number");
	if (measured.length)
		return measured.reduce((best, track) =>
			track.durationSec! > best.durationSec! ? track : best,
		);
	return candidates[0];
}
