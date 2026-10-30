import { withMirroredTiming, type Clip } from "./timeline-doc.ts";
import type { ClipLayout } from "./timeline-model.ts";
import { retainClipAnimation, type AudioAnimation } from "./clip-animation.ts";

/** Authored source edits stay bounded when narration extends a scene plate. */
export function sceneVisualSourceDuration(
	selected: number,
	scene: number,
	layout?: { preservePitch?: unknown; reverseMedia?: unknown },
): number {
	return layout?.preservePitch !== undefined || layout?.reverseMedia != null
		? Math.min(selected, scene)
		: scene;
}

/** Last selected source frame retained through narration and transition holds. */
export function heldVideoFrame(
	duration: number,
	rate: number,
	fps: number,
	frame: number,
): [number, boolean] {
	const end = Math.max(0, Math.floor(duration * fps - Math.max(1, 1 / rate)));
	return [Math.min(frame, end), frame > end];
}

/** Seconds in original source, independent of playback direction. */
export function sourceInterval(start: number, duration: number, rate = 1) {
	if (
		![start, duration, rate].every(Number.isFinite) ||
		start < 0 ||
		duration <= 0 ||
		rate < 0.25 ||
		rate > 4
	)
		throw new Error("Invalid source interval");
	return { start, end: start + duration * rate };
}

export function assertSourceInterval(
	start: number,
	duration: number,
	rate: number,
	sourceDuration: number,
): void {
	const interval = sourceInterval(start, duration, rate);
	if (
		!Number.isFinite(sourceDuration) ||
		sourceDuration <= 0 ||
		interval.end > sourceDuration + 0.000001
	)
		throw new Error("Replacement source is too short for selected clip range");
}

/** Reverse samples the same interval from its far boundary. */
export function sourceTime(
	start: number,
	duration: number,
	rate: number,
	reverse: boolean,
	elapsed: number,
): number {
	const interval = sourceInterval(start, duration, rate);
	const offset = Math.min(duration, Math.max(0, elapsed)) * rate;
	return reverse ? interval.end - offset : interval.start + offset;
}

/** Retained timeline window; bounds are original-source seconds even in reverse. */
export function sliceSourceInterval(
	start: number,
	duration: number,
	rate: number,
	reverse: boolean,
	from: number,
	to: number,
) {
	sourceInterval(start, duration, rate);
	if (![from, to].every(Number.isFinite) || to <= from)
		throw new Error("Invalid retained timeline interval");
	const nextStart = start + (reverse ? duration - to : from) * rate;
	if (nextStart < -0.000001) throw new Error("Invalid source interval");
	return sourceInterval(Math.max(0, nextStart), to - from, rate);
}

/** Stored rates outside the editable range read as the editor shows them, so old clips stay splittable. */
export function editableRate(rate: number | undefined): number {
	return rate == null || !Number.isFinite(rate) ? 1 : Math.max(0.25, Math.min(4, rate));
}

/** Legacy clips default to a forward 1x interval. Images have no temporal bound. */
export function clipSourceRange(clip: Clip) {
	if (clip.video?.kind === "video")
		return {
			start: clip.video.mediaStartSec ?? 0,
			rate: editableRate(clip.video.layout?.playbackRate),
			reverse: clip.video.layout?.reverse ?? false,
			assetId: clip.video.mediaAssetId,
		};
	if (clip.audio?.url)
		return {
			start: clip.audio.mediaStartSec ?? 0,
			rate: editableRate(clip.audio.playbackRate),
			reverse: clip.audio.reverse ?? false,
			assetId: clip.audio.mediaAssetId,
		};
	const visual =
		clip.vis?.vclip ??
		(clip.scene?.visualClips?.length === 1 && !clip.scene.visualClips[0]?.startSec
			? clip.scene.visualClips[0]
			: undefined);
	if (visual?.kind === "video") {
		const layout = { ...clip.scene?.layout, ...visual.layout };
		return {
			start: visual.mediaStartSec ?? 0,
			rate: editableRate(layout?.playbackRate),
			reverse: layout?.reverse ?? false,
			assetId: visual.mediaAssetId,
		};
	}
	return undefined;
}

/** A narration hold cannot become a new temporal source after its footage ends. */
export function canRetainClipWindow(clip: Clip, from: number, to: number): boolean {
	if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return false;
	const visual =
		clip.scene?.visualClips?.length === 1 && !clip.scene.visualClips[0]?.startSec
			? clip.scene.visualClips[0]
			: undefined;
	return (
		!visual ||
		visual.kind !== "video" ||
		from <
			sceneVisualSourceDuration(visual.durationSec, clip.durationSec, {
				...clip.scene?.layout,
				...visual.layout,
			})
	);
}

/** Slice authored clip content, including scene-local visual windows. Moving is separate. */
export function retainClipWindow(clip: Clip, from: number, to: number): Clip {
	if (!canRetainClipWindow(clip, from, to))
		throw new Error("Retained window contains no selected source");
	const range = clipSourceRange(clip);
	const source =
		range &&
		sliceSourceInterval(range.start, clip.durationSec, range.rate, range.reverse, from, to);
	let next: Clip = { ...clip, startSec: clip.startSec + from, durationSec: to - from };
	if (source && clip.video) next.video = { ...clip.video, mediaStartSec: source.start };
	if (source && clip.audio) next.audio = { ...clip.audio, mediaStartSec: source.start };
	if (clip.audio?.animation)
		next.audio = {
			...(next.audio ?? clip.audio),
			animation: retainClipAnimation(clip.audio.animation, from, to),
		};
	if (clip.video?.layout?.animation)
		next.video = {
			...(next.video ?? clip.video),
			layout: {
				...clip.video.layout,
				animation: retainClipAnimation(clip.video.layout.animation, from, to),
			},
		};
	if (source && clip.vis)
		next.vis = {
			...clip.vis,
			vclip: { ...clip.vis.vclip, mediaStartSec: source.start, durationSec: to - from },
		};
	if (clip.vis?.vclip.layout?.animation)
		next.vis = {
			...(next.vis ?? clip.vis),
			vclip: {
				...(next.vis?.vclip ?? clip.vis.vclip),
				layout: {
					...clip.vis.vclip.layout,
					animation: retainClipAnimation(clip.vis.vclip.layout.animation, from, to),
				},
			},
		};
	// A scene drawn from its own image (no visual clips) carries keys on the scene layout itself.
	if (clip.scene?.layout?.animation && !clip.scene.visualClips?.length)
		next.scene = {
			...clip.scene,
			layout: {
				...clip.scene.layout,
				animation: retainClipAnimation(clip.scene.layout.animation, from, to),
			},
		};
	if (clip.scene?.visualClips) {
		const single = clip.scene.visualClips.length === 1 && !clip.scene.visualClips[0]?.startSec;
		next.scene = {
			...(next.scene ?? clip.scene),
			visualClips: clip.scene.visualClips.flatMap((visual) => {
				const layout = { ...clip.scene?.layout, ...visual.layout };
				const start = single ? 0 : visual.startSec,
					duration = single
						? visual.kind === "video"
							? sceneVisualSourceDuration(visual.durationSec, clip.durationSec, layout)
							: clip.durationSec
						: visual.durationSec;
				const left = Math.max(from, start),
					right = Math.min(to, start + duration);
				if (right <= left) return [];
				const interval =
					visual.kind === "video"
						? sliceSourceInterval(
								visual.mediaStartSec ?? 0,
								duration,
								editableRate(layout?.playbackRate),
								layout?.reverse ?? false,
								left - start,
								right - start,
							)
						: undefined;
				return [
					{
						...visual,
						startSec: left - from,
						durationSec: right - left,
						...(interval ? { mediaStartSec: interval.start } : {}),
						...(layout.animation
							? {
									layout: {
										xPct: 0,
										yPct: 0,
										widthPct: 100,
										heightPct: 100,
										fit: "cover" as const,
										...layout,
										animation: retainClipAnimation(layout.animation, left - start, right - start),
									},
								}
							: {}),
					},
				];
			}),
		};
	}
	return withMirroredTiming(next);
}

/** Numeric/stepper trim shares the same bounds as timeline gestures. */
export function trimMediaTiming(
	source: {
		start: number;
		dur: number;
		mediaStartSec?: number;
		layout?: ClipLayout;
		playbackRate?: number;
		reverse?: boolean;
		animation?: AudioAnimation;
	},
	patch: {
		start?: number;
		dur?: number;
	},
	sourceDuration?: number,
) {
	const rate = editableRate(source.layout?.playbackRate ?? source.playbackRate),
		reverse = source.layout?.reverse ?? source.reverse ?? false,
		sourceStart = source.mediaStartSec ?? 0;
	if (
		![
			source.start,
			source.dur,
			sourceStart,
			rate,
			patch.start ?? source.start,
			patch.dur ?? source.dur,
		].every(Number.isFinite) ||
		(sourceDuration != null && (!Number.isFinite(sourceDuration) || sourceDuration <= 0))
	)
		return undefined;
	let from = (patch.start ?? source.start) - source.start,
		to = from + (patch.dur ?? source.dur);
	const extent = sourceDuration ?? Infinity;
	from = Math.max(
		from,
		reverse ? source.dur - (extent - sourceStart) / rate : -sourceStart / rate,
		-source.start,
	);
	to = Math.min(to, reverse ? source.dur + sourceStart / rate : (extent - sourceStart) / rate);
	if (to - from < 1 / 30) return undefined;
	const interval = sliceSourceInterval(sourceStart, source.dur, rate, reverse, from, to);
	return {
		start: source.start + from,
		dur: to - from,
		mediaStartSec: interval.start,
		...(source.layout?.animation
			? {
					layout: {
						...source.layout,
						animation: retainClipAnimation(source.layout.animation, from, to),
					},
				}
			: {}),
		...(source.animation ? { animation: retainClipAnimation(source.animation, from, to) } : {}),
	};
}

/** Rate edits retain original source endpoints, without moving timeline start. */
export function retimeSourceDuration(
	start: number,
	duration: number,
	previousRate: number,
	nextRate: number,
): number {
	const selected = sourceInterval(start, duration, previousRate);
	sourceInterval(start, duration, nextRate);
	return (selected.end - selected.start) / nextRate;
}

/** Clips whose placed source range runs past their source's measured length, by clip
 *  id. A file placed while uploading uses the browser's measured length; when the
 *  server measures it shorter, its clips need a trim rather than a silent cut. */
export function clipsPastSource(
	clips: readonly Clip[],
	assets: readonly {
		id: string;
		label: string;
		source?: string;
		metadata?: { duration?: number };
	}[],
): Map<string, string> {
	const past = new Map<string, string>();
	for (const clip of clips) {
		// A scene plate may hold past its footage for narration; free media may not.
		if (!clip.video && !clip.audio && !clip.vis) continue;
		const range = clipSourceRange(clip),
			asset = range && assets.find((candidate) => candidate.id === range.assetId);
		const duration = asset?.metadata?.duration;
		// Imported files only: derivatives (extracted or retimed audio) are cut to their clip by
		// construction, and their measured length may differ from it by a frame of padding.
		if (!range || !asset || !duration || (asset.source !== undefined && asset.source !== "upload"))
			continue;
		try {
			assertSourceInterval(range.start, clip.durationSec, range.rate, duration);
		} catch {
			past.set(
				clip.id,
				`${asset.label}: the clip runs past the end of its source. Trim it before export.`,
			);
		}
	}
	return past;
}
