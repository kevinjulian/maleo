/* What publishing should actually do, given what is already published.
 *
 * The identity of a bed is its SOURCE URL, not its filename. The filename
 * encodes the normalised bytes (music-<slug>-<hash8>), so re-baking with
 * different loudness settings produces a different name for the same track —
 * and a filename-based check would call that "not published yet", upload a
 * second copy, and leave the first orphaned in the bucket forever.
 *
 * Diffing against the published manifest by source answers the three questions
 * that matter, and does it in one request rather than one HEAD per bed:
 *
 *   unchanged   already published, same bytes        → skip
 *   replaced    already published, bytes differ      → upload, old file orphaned
 *   added       not published                        → upload
 *
 * Pure, so the decision is testable without a network or a bucket. */

export interface PlannablePrepared {
	id: string;
	file: string;
	source: string;
	sha256?: string;
	[key: string]: unknown;
}

export interface PublishedBed {
	url: string;
	source: string;
	sha256?: string;
	[key: string]: unknown;
}

export interface PublishPlan<T extends PlannablePrepared> {
	/** Already published with identical bytes; reuse the published url. */
	unchanged: Array<{ track: T; url: string }>;
	/** Published before, but the audio changed. */
	replaced: Array<{ track: T; previousUrl: string }>;
	/** Never published. */
	added: T[];
	/** Urls left behind by a replacement, or by a bed dropped from the source
	 *  folder. Harmless — nothing references them — but they accumulate, so they
	 *  are reported rather than ignored. */
	orphaned: string[];
}

const key = (source: string): string => source.trim().replace(/\/$/, "").toLowerCase();

export function planPublish<T extends PlannablePrepared>(
	prepared: readonly T[],
	published: readonly PublishedBed[],
): PublishPlan<T> {
	const bySource = new Map<string, PublishedBed>();
	for (const bed of published) bySource.set(key(bed.source), bed);

	const plan: PublishPlan<T> = { unchanged: [], replaced: [], added: [], orphaned: [] };
	const stillPresent = new Set<string>();

	for (const track of prepared) {
		const existing = bySource.get(key(track.source));
		if (!existing) {
			plan.added.push(track);
			continue;
		}
		stillPresent.add(key(track.source));
		// Both hashes must be known to claim they match; an older manifest without
		// hashes is treated as "cannot prove it is current", so it re-uploads.
		if (existing.sha256 && track.sha256 && existing.sha256 === track.sha256) {
			plan.unchanged.push({ track, url: existing.url });
		} else {
			plan.replaced.push({ track, previousUrl: existing.url });
			plan.orphaned.push(existing.url);
		}
	}

	// A bed that was published but is no longer in the source folder. Its file
	// stays in the bucket and its entry disappears from the manifest, so nothing
	// can reach it.
	for (const bed of published) {
		if (!stillPresent.has(key(bed.source))) plan.orphaned.push(bed.url);
	}

	return plan;
}

/** One-line summary for the console. */
export function describePlan<T extends PlannablePrepared>(plan: PublishPlan<T>): string {
	return `${plan.added.length} new, ${plan.replaced.length} replaced, ${plan.unchanged.length} unchanged, ${plan.orphaned.length} orphaned`;
}
