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
interface MediaStoryboard {
	scenes?: ReadonlyArray<{
		image?: string;
		endImage?: string | null;
		visualClips?: ReadonlyArray<{ url: string; kind?: string }>;
		sfxUrl?: string;
		audioClips?: ReadonlyArray<{ url?: string }>;
	}>;
	visualTimeline?: ReadonlyArray<{ url: string; kind?: string }>;
	videoOverlays?: ReadonlyArray<{ url: string; kind?: string }>;
	audioOverlays?: ReadonlyArray<{ url?: string }>;
	voiceover?: { audioUrl?: string; text?: string } | null;
	musicUrl?: string;
}

function sourceUrls(storyboard: MediaStoryboard, imagesOnly: boolean): string[] {
	const image = (clip: { url: string; kind?: string }): string[] =>
		(!imagesOnly || (clip.kind ?? "image") === "image") && clip.url ? [clip.url] : [];
	const urls = [
		...(storyboard.scenes ?? []).flatMap((scene) => [
			...(scene.image ? [scene.image] : []),
			...(scene.endImage ? [scene.endImage] : []),
			...(scene.visualClips ?? []).flatMap(image),
		]),
		...(storyboard.visualTimeline ?? []).flatMap(image),
		...(storyboard.videoOverlays ?? []).flatMap(image),
		...(imagesOnly
			? []
			: [
					...(storyboard.voiceover?.audioUrl ? [storyboard.voiceover.audioUrl] : []),
					...(storyboard.musicUrl ? [storyboard.musicUrl] : []),
					...(storyboard.audioOverlays ?? []).flatMap((clip) => (clip.url ? [clip.url] : [])),
					...(storyboard.scenes ?? []).flatMap((scene) => [
						...(scene.sfxUrl ? [scene.sfxUrl] : []),
						...(scene.audioClips ?? []).flatMap((clip) => (clip.url ? [clip.url] : [])),
					]),
				]),
	];
	return [...new Set(urls)];
}

export function storyboardImageUrls(storyboard: MediaStoryboard): string[] {
	return sourceUrls(storyboard, true);
}

export function storyboardMediaUrls(storyboard: MediaStoryboard): string[] {
	return sourceUrls(storyboard, false);
}

/** Frame times in milliseconds: the last one, and the median and 95th
 *  percentile over the session (nearest rank, `crates/preview` `stats.rs`). */
export interface FrameTimes {
	last: number;
	p50: number;
	p95: number;
	count: number;
}
