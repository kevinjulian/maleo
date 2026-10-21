import { readStoryboardDocument, readStoryboardSlides } from "./storyboard-document.ts";
import { toTimelineDoc } from "./timeline-doc.ts";

export const PROJECT_FEED_SORTS = ["modified", "modified-asc", "name", "name-desc"] as const;
export type ProjectFeedSort = (typeof PROJECT_FEED_SORTS)[number];
export interface ProjectFeedPreview {
	thumbnail_url: string | null;
	duration_sec: number | null;
}

/** Derived from newest authored version, never from requested target duration. */
export function projectFeedPreview(
	raw: unknown,
	type: "video" | "image" | "text",
): ProjectFeedPreview {
	if (type !== "video")
		return {
			thumbnail_url:
				type === "image" ? (readStoryboardSlides(raw).find((s) => s.image)?.image ?? null) : null,
			duration_sec: null,
		};
	const read = readStoryboardDocument(raw);
	const legacy = read.legacyArrays;
	const clips = read.clipFirst
		? read.doc.clips
		: toTimelineDoc(
				legacy.scenes,
				legacy.videoOverlays,
				legacy.textOverlays,
				legacy.audioOverlays,
				legacy.effects,
				legacy.transitions,
			).clips;
	const spans = clips.filter((c) => c.type !== "transition");
	// Legacy readers supply timing defaults for missing fields; those are useful
	// for opening a document, but cannot claim a measured inventory duration.
	const duration =
		read.clipFirst &&
		spans.length &&
		!read.diagnostic.defaulted.includes("clips[]") &&
		spans.every(
			(c) =>
				Number.isFinite(c.startSec) &&
				c.startSec >= 0 &&
				Number.isFinite(c.durationSec) &&
				c.durationSec > 0,
		)
			? spans.reduce((end, c) => Math.max(end, c.startSec + c.durationSec), 0)
			: null;
	let thumbnail: string | null = null;
	for (const clip of [...clips].sort((a, b) => a.startSec - b.startSec)) {
		const visuals = Array.isArray(clip.scene?.visualClips) ? clip.scene.visualClips : [];
		const source =
			clip.video?.thumb ??
			(clip.video?.kind === "image" ? clip.video.url : null) ??
			(clip.vis?.vclip?.kind === "image" ? clip.vis.vclip.url : null) ??
			visuals.find((v) => v?.kind === "image")?.url ??
			(visuals.length ? null : clip.scene?.src) ??
			null;
		thumbnail = typeof source === "string" && source.length ? source : null;
		if (thumbnail) break;
	}
	return { thumbnail_url: thumbnail, duration_sec: duration };
}
