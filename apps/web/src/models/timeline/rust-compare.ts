/* Compare mode: the Rust renderer drawn beside the Remotion preview
 * (OpenSpec p2-render-foundation D8). Pure rules; the hook is
 * `hooks/timeline/use-rust-compare.ts`.
 *
 * Opened by `?renderer=compare` for that page load only: no setting, no menu
 * item, no stored preference. Remotion stays the preview and the export. */

/** The query parameter and value that open compare mode. */
export const COMPARE_PARAM = "renderer";
export const COMPARE_VALUE = "compare";

export function compareModeRequested(search: string): boolean {
	return new URLSearchParams(search).get(COMPARE_PARAM) === COMPARE_VALUE;
}

/** One element the Rust renderer does not draw yet (its coverage report). */
export interface CoverageEntry {
	kind: string;
	path: string;
	reason: string;
}

/** The image URLs a render storyboard draws, each once, in document order. */
export function storyboardImageUrls(storyboard: {
	scenes?: ReadonlyArray<{
		image?: string;
		visualClips?: ReadonlyArray<{ url: string; kind?: string }>;
	}>;
	visualTimeline?: ReadonlyArray<{ url: string; kind?: string }>;
	videoOverlays?: ReadonlyArray<{ url: string; kind?: string }>;
}): string[] {
	const image = (clip: { url: string; kind?: string }): string[] =>
		(clip.kind ?? "image") === "image" && clip.url ? [clip.url] : [];
	const urls = [
		...(storyboard.scenes ?? []).flatMap((scene) => [
			...(scene.image ? [scene.image] : []),
			...(scene.visualClips ?? []).flatMap(image),
		]),
		...(storyboard.visualTimeline ?? []).flatMap(image),
		...(storyboard.videoOverlays ?? []).flatMap(image),
	];
	return [...new Set(urls)];
}

/** Frame times in milliseconds: the last one, and the median and 95th
 *  percentile over the session (nearest rank). */
export interface FrameTimes {
	last: number;
	p50: number;
	p95: number;
	count: number;
}

export function frameTimes(samples: readonly number[]): FrameTimes | null {
	if (samples.length === 0) return null;
	const sorted = [...samples].sort((a, b) => a - b);
	const rank = (p: number): number => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]!;
	return {
		last: samples[samples.length - 1]!,
		p50: rank(0.5),
		p95: rank(0.95),
		count: samples.length,
	};
}
