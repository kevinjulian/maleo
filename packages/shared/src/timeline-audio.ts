import { audioAnimationSchema, type AudioAnimation } from "./clip-animation.ts";
import type { Clip, TimelineDoc } from "./timeline-doc.ts";
import type { ClipLayout, TrackFlags } from "./timeline-model.ts";
import { editableRate, sceneVisualSourceDuration } from "./source-interval.ts";
import { trackVisibility } from "./track-visibility.ts";
import type { DialoguePriorityKind } from "./audio-gain.ts";

export interface TimelineAudioSource {
	clipId: string;
	visualId?: string;
	url: string;
	mediaAssetId?: string;
	startSec: number;
	durationSec: number;
	mediaStartSec: number;
	playbackRate: number;
	preservePitch: boolean;
	reverse: boolean;
	kind: DialoguePriorityKind;
	volume: number;
	fadeInSec: number;
	fadeOutSec: number;
	duckUnderVoice?: number;
	animation?: AudioAnimation;
	loop: boolean;
}

/** Native video gain shares production's extraction and default-volume rules. */
export function nativeAudioVolume(
	volume: number | undefined,
	fallback: number,
	layout?: Partial<ClipLayout>,
	silent = false,
): number {
	return silent || layout?.sourceAudioExtraction ? 0 : (volume ?? fallback);
}

/** Explicit audible document sources; no script words or display-name matching. */
export function timelineAudioSources(
	doc: TimelineDoc,
	flags: TrackFlags = {},
): TimelineAudioSource[] {
	const { audible } = trackVisibility(flags);
	const sources: TimelineAudioSource[] = [];
	const native = (
		clip: Clip,
		visual: {
			id?: string;
			kind: string;
			url: string;
			mediaAssetId?: string;
			mediaStartSec?: number;
			volume?: number;
			layout?: Partial<ClipLayout>;
		},
		start: number,
		duration: number,
		fallback: number,
		inherited?: Partial<ClipLayout>,
	) => {
		const layout = { ...inherited, ...visual.layout };
		if (
			visual.kind !== "video" ||
			layout.sourceAudioExtraction ||
			!audible(clip.scene || clip.vis ? -1 : clip.track)
		)
			return;
		const volume = nativeAudioVolume(visual.volume, fallback, layout);
		const animation = layout.animation?.tracks.volume
			? audioAnimationSchema.parse({ tracks: { volume: layout.animation.tracks.volume } })
			: undefined;
		if (volume <= 0 && !animation?.tracks.volume?.some((key) => key.v > 0)) return;
		sources.push({
			clipId: clip.id,
			...(visual.id ? { visualId: visual.id } : {}),
			url: visual.url,
			mediaAssetId: visual.mediaAssetId,
			startSec: start,
			durationSec: duration,
			mediaStartSec: visual.mediaStartSec ?? 0,
			playbackRate: editableRate(layout.playbackRate),
			preservePitch: layout.preservePitch ?? false,
			reverse: layout.reverse ?? false,
			kind: "sfx",
			volume,
			fadeInSec: 0,
			fadeOutSec: 0,
			duckUnderVoice: 1,
			animation,
			loop: false,
		});
	};
	for (const clip of doc.clips) {
		const audio = clip.audio;
		if (
			audio?.url &&
			audible(clip.track) &&
			((audio.volume ?? 1) > 0 || audio.animation?.tracks.volume?.some((key) => key.v > 0))
		) {
			sources.push({
				clipId: clip.id,
				url: audio.url,
				mediaAssetId: audio.mediaAssetId,
				startSec: clip.startSec,
				durationSec: clip.durationSec,
				mediaStartSec: audio.mediaStartSec ?? 0,
				playbackRate: editableRate(audio.playbackRate),
				preservePitch: audio.preservePitch ?? false,
				reverse: audio.reverse ?? false,
				kind: audio.kind,
				volume: audio.volume ?? 1,
				fadeInSec: audio.fadeIn ?? 0,
				fadeOutSec: audio.fadeOut ?? 0,
				duckUnderVoice: audio.duckUnderVoice,
				animation: audio.animation,
				loop: audio.kind === "music" && (audio.playbackRate ?? 1) === 1 && !audio.reverse,
			});
		}
		if (clip.video)
			native(clip, { ...clip.video, id: undefined }, clip.startSec, clip.durationSec, 0);
		if (clip.vis) native(clip, clip.vis.vclip, clip.startSec, clip.durationSec, 0);
		const visuals = clip.scene?.visualClips ?? [];
		for (const visual of visuals) {
			const single = visuals.length === 1 && visual.startSec <= 0;
			const duration = single
				? sceneVisualSourceDuration(visual.durationSec, clip.durationSec, {
						...clip.scene?.layout,
						...visual.layout,
					})
				: Math.min(visual.durationSec, clip.durationSec - visual.startSec);
			if (duration > 0)
				native(
					clip,
					visual,
					clip.startSec + visual.startSec,
					duration,
					single ? 1 : 0,
					clip.scene?.layout,
				);
		}
	}
	return sources;
}
