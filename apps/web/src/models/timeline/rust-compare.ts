/* Compare mode: the Rust renderer drawn beside the Remotion preview
 * (OpenSpec p2-render-foundation D8). Pure rules; the hook is
 * `hooks/timeline/use-rust-compare.ts`, the session runs in
 * `preview-worker/worker.ts` (OpenSpec p2-preview-runtime).
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
 *  percentile over the session (nearest rank, `crates/preview` `stats.rs`). */
export interface FrameTimes {
	last: number;
	p50: number;
	p95: number;
	count: number;
}
