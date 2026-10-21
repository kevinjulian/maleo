/* Every media URL the timeline will need, with the window it is on screen for.
 *
 * Pure: the preloader hook decides what to fetch near the playhead, this only
 * says what exists and when. Scene starts follow the same rule as the renderer —
 * explicit `start` when any scene carries one, otherwise sequential.
 */
import type { AudioOverlay, Scene, VideoOverlay } from "@maleo/shared";

export interface TimelinePreloadAsset {
	url?: string;
	kind: "image" | "audio" | "video";
	startSec: number;
	endSec: number;
}

export function collectPreloadAssets(
	scenes: Scene[],
	videoOverlays: VideoOverlay[],
	audioOverlays: AudioOverlay[],
): TimelinePreloadAsset[] {
	const out: TimelinePreloadAsset[] = [];
	const explicit = scenes.some((s) => s.start != null);
	let cursor = 0;
	for (const s of scenes) {
		const start = explicit ? (s.start ?? cursor) : cursor;
		const dur = Math.max(1, s.dur);
		cursor = start + dur;
		const sceneUrls = s.visualClips?.length
			? s.visualClips.map((v) => ({
					url: v.url,
					kind: v.kind ?? "image",
					start: start + (v.startSec ?? 0),
					dur: Math.max(0.5, v.durationSec ?? dur),
				}))
			: [{ url: s.src, kind: "image" as const, start, dur }];
		for (const v of sceneUrls)
			out.push({
				url: v.url,
				kind: v.kind === "video" ? "video" : "image",
				startSec: v.start,
				endSec: v.start + v.dur,
			});
		if (s.endSrc) out.push({ url: s.endSrc, kind: "image", startSec: start, endSec: start + dur });
	}
	for (const v of videoOverlays)
		out.push({
			url: v.url,
			kind: v.kind === "video" ? "video" : "image",
			startSec: v.start,
			endSec: v.start + v.dur,
		});
	for (const a of audioOverlays)
		out.push({ url: a.url, kind: "audio", startSec: a.start, endSec: a.start + a.dur });
	return out;
}
