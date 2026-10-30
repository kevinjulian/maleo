import { trackVisibility } from "./track-visibility.ts";
/* Render-storyboard projection (shared source of truth).
 *
 * Projects the editing state (or the canonical clip document) into the flat
 * `StoryboardForRender` the Remotion composition consumes. Lives in shared so the
 * dashboard (WYSIWYG preview + submit) and the render worker both run the exact
 * same projection — the worker can build directly from the persisted clip
 * document without the dashboard editor.
 */
import { nativeAudioVolume } from "./timeline-audio.ts";
import { applyDirector } from "./director.ts";
import { CaptionClipSchema, type CaptionCue } from "./caption-cues.ts";
import {
	clipId,
	parseClipId,
	type AudioOverlay,
	type BrandKit,
	type Config,
	type EffectClip,
	type PacingDevices,
	type RefsState,
	type Scene,
	type TextOverlay,
	type TrackFlags,
	type TransitionClip,
	type VideoOverlay,
	type VisualRevealEffect,
} from "./timeline-model.ts";
import { fromTimelineDoc, type Chapter, type TimelineDoc } from "./timeline-doc.ts";
import { staleScenes, type StaleScene } from "./asset-staleness.ts";
import type { CaptionConfig } from "./caption-config.ts";
import type { ExplainerVisualType } from "./video-blueprint.ts";
import { processedAudioSource, mediaHasAudio } from "./processed-audio.ts";
import { reversePlaybackSource } from "./reverse-media.ts";
import { sceneVisualSourceDuration } from "./source-interval.ts";
import type { ClipLayout } from "./timeline-model.ts";
import type { AudioAnimation } from "./clip-animation.ts";
import type { KeyframeEasing } from "./animation-properties.ts";
import { validTransition, type VisualBoundaryClip } from "./transition-boundary.ts";

/** Source/track mute suppresses keyed gain as well as static gain in projection. */
function silentSourceLayout<T extends Partial<ClipLayout>>(layout: T | undefined): T | undefined {
	return layout?.animation?.tracks.volume
		? {
				...layout,
				animation: {
					...layout.animation,
					tracks: { ...layout.animation.tracks, volume: undefined },
				},
			}
		: layout;
}

function projectReverseSource<
	T extends { url: string; mediaStartSec?: number; layout?: Partial<ClipLayout> },
>(clip: T, duration: number, layout: Partial<ClipLayout> | undefined = clip.layout): T {
	if (!layout?.reverse) return clip;
	const source = reversePlaybackSource(clip.url, clip.mediaStartSec ?? 0, duration, layout);
	return source
		? { ...clip, ...source, layout: { ...layout, reverse: false, reverseMedia: undefined } }
		: clip;
}

type RenderTransition =
	| "cut"
	| "fade"
	| "slide"
	| "zoom"
	| "wipe"
	| "flip"
	| "clock_wipe"
	| "pixel";
type RenderMotionEasing = "linear" | "in" | "out" | "in-out" | "bezier";
type RenderMotionKeyframe = {
	t: number;
	scale: number;
	x: number;
	y: number;
	rotate?: number;
	easing?: RenderMotionEasing;
};
type RenderMotion = { keyframes: RenderMotionKeyframe[] };
type RenderReveal = VisualRevealEffect;
export interface StoryboardForRender {
	scenes: Array<{
		image: string;
		endImage?: string | null;
		label: string;
		/* The title of the chapter this scene is in, when it has one. The renderer
		 * groups RUNS of scenes sharing it, so the storyboard carries no chapter
		 * list and nothing can fall out of step with the scenes. */
		chapter?: string;
		movement: string;
		motion?: RenderMotion | null;
		focalPoint?: { xPct: number; yPct: number } | null;
		transition: RenderTransition;
		transitionDurSec?: number;
		durationSec: number;
		voiceover: string;
		visual: string;
		camera: string;
		explainer?: {
			question?: string;
			claim?: string;
			evidence?: string;
			sourceEvidence?: Array<{ url: string; quote: string }>;
			analogy?: string;
			visualType?: ExplainerVisualType;
			onScreenText?: string;
		};
		sectionTransition?: {
			type?:
				| "question_card"
				| "timeline_advance"
				| "evidence_stamp"
				| "diagram_wipe"
				| "match_cut"
				| "chapter_card";
			plateId?: string;
			text?: string;
			motion?: "line_draw" | "paper_wipe" | "stamp" | "push" | "zoom_cut" | "none";
			durationSec?: number;
			plateImageUrl?: string;
			sfx?: string;
		};
		startSec?: number;
		layout?: unknown;
		sfxUrl?: string;
		visualClips?: Array<{
			sourceDurationSec?: number;
			volume?: number;
			mediaStartSec?: number;
			url: string;
			primary?: boolean;
			kind?: "image" | "video";
			label?: string;
			startSec?: number;
			durationSec?: number;
			movement?: string;
			motion?: RenderMotion | null;
			layout?: unknown;
			reveal?: RenderReveal;
		}>;
		audioClips?: Array<{
			kind: "voiceover" | "sfx" | "music";
			content: string;
			label?: string;
			url?: string;
			startSec?: number;
			durationSec?: number;
		}>;
		vignette: boolean;
		grain: boolean;
	}>;
	accentColor: string;
	bgColor: string;
	fgColor: string;
	musicUrl?: string;
	musicMood: "upbeat" | "chill" | "luxury" | "energetic" | "minimal";
	showLabels: boolean;
	hideBase?: boolean;
	muteBase?: boolean;
	targetDurationSec?: number;
	textOverlays?: Array<{
		content: string;
		startSec: number;
		durationSec: number;
		preset?: string;
		track?: number;
		layout?: unknown;
		style?: unknown;
		params?: Record<string, unknown>;
		anim?: {
			tracks: Partial<
				Record<
					| "x"
					| "y"
					| "scale"
					| "rotate"
					| "opacity"
					| "width"
					| "height"
					| "blur"
					| "bgOpacity"
					| "fontSize"
					| "letterSpacing"
					| "lineHeight",
					Array<{ t: number; v: number; easing?: KeyframeEasing }>
				>
			>;
			colorTracks?: Partial<
				Record<
					"fill" | "bodyFill" | "accent" | "background",
					Array<{ t: number; v: string; easing?: KeyframeEasing }>
				>
			>;
		} | null;
	}>;
	audioOverlays?: Array<{
		kind: "voiceover" | "music" | "sfx" | "ambient" | "accent_hit";
		content: string;
		url?: string;
		startSec: number;
		durationSec: number;
		volume?: number;
		animation?: AudioAnimation;
		duckUnderVoice?: number;
		fadeInSec?: number;
		fadeOutSec?: number;
		mediaStartSec?: number;
		loopSource?: boolean;
	}>;
	videoOverlays?: Array<{
		url: string;
		thumb?: string;
		kind: "image" | "video";
		track?: number;
		startSec: number;
		durationSec: number;
		layout?: unknown;
		transition?: RenderTransition;
		transitionDurSec?: number;
		mediaStartSec?: number;
		volume?: number;
		reveal?: RenderReveal;
	}>;
	visualTimeline?: Array<{
		sourceDurationSec?: number;
		volume?: number;
		mediaStartSec?: number;
		url: string;
		kind: "image" | "video";
		startSec: number;
		durationSec: number;
		movement?: string;
		motion?: RenderMotion | null;
		focalPoint?: { xPct: number; yPct: number } | null;
		layout?: unknown;
		transition?: RenderTransition;
		transitionDurSec?: number;
		reveal?: RenderReveal;
	}>;
	effects?: Array<{
		effect: "fade_in" | "fade_out" | "zoom_out_from_black" | "flash" | "zoom_punch" | "whip_pan";
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>;
	captions?: Record<string, unknown> | null;
	captionCues?: Array<{
		id: string;
		type: "caption";
		startSec: number;
		durationSec: number;
		track: number;
		caption: CaptionCue;
	}>;
	pacingDevices?: { chapterPills?: boolean; progressBar?: boolean; variant?: "pill" | "minimal" };
	voiceover?: {
		text: string;
		startSec?: number;
		words: Array<{ text: string; startSec: number; endSec: number }>;
	};
}

function presetForFormat(format: string | undefined): string {
	if (format === "16:9") return "storyboard-wide";
	if (format === "1:1") return "storyboard-square";
	return "storyboard-tiktok";
}

function firstSceneImage(scene: Scene, refs: RefsState): string {
	const candidates = refs.images.filter(
		(ref) => ref.primary || (scene.refIds ?? []).includes(ref.id),
	);
	return candidates.find((ref) => ref.imageUrl)?.imageUrl ?? "";
}

// The image the render should use for a scene: prefer the scene's own generated
// frame (scene.src), then any attached/default reference image.
export function sceneRenderImage(scene: Scene, refs: RefsState): string {
	const primaryClip = scene.visualClips?.find((clip) => clip.primary) ?? scene.visualClips?.[0];
	return primaryClip?.url ?? scene.src ?? firstSceneImage(scene, refs);
}

export interface BuildRenderStoryboardExtra {
	mediaAssets?: unknown;
	trackFlags?: TrackFlags;
	overlays?: TextOverlay[];
	audioOverlays?: AudioOverlay[];
	videoOverlays?: VideoOverlay[];
	effects?: EffectClip[];
	transitions?: TransitionClip[];
	// reads `enabled`/`fontFamily` and spreads it). `object` accepts the dashboard's
	// CaptionConfig interface, which has no index signature.
	captions?: object;
	pacingDevices?: PacingDevices;
	/* The document's chapters, so a rendered chapter pill can count chapters
	 * rather than scenes. Only the titles are read; a chapter's span is derived
	 * from the scenes that name it, at render time, the same way it is on the
	 * timeline ruler. */
	chapters?: Chapter[] | null;
	brand?: BrandKit;
}

/** A storyboard ready to hand to the renderer, with the preset it was built
 *  against. The preset travels alongside rather than inside because the renderer
 *  selects the composition from it before reading the storyboard. */
export interface BuiltRenderStoryboard {
	preset: string;
	storyboard: StoryboardForRender;
	/* Scenes whose generated assets no longer match what the scene now says.
	 * REPORTED, never blocking: the storyboard is built either way, and an
	 * operator who wants the cut with a slightly out-of-date frame is not making
	 * a mistake. Empty when nothing is stale, which is every project that has
	 * never had a hash recorded. */
	stale: StaleScene[];
}

/** The chapter title a scene renders under, if its chapter has one. */
function chapterTitleFor(scene: Scene, chapters: Chapter[] | null | undefined): string | undefined {
	if (!scene.sectionId || !chapters?.length) return undefined;
	return chapters.find((c) => c.id === scene.sectionId)?.title;
}

export function buildRenderStoryboard(
	config: Config,
	refs: RefsState,
	scenesIn: Scene[],
	extra?: BuildRenderStoryboardExtra,
): BuiltRenderStoryboard {
	// Video Director: when a style is chosen, resolve camera/transition per scene
	// from its emotion/beat before the render maps the storyboard.
	const style = config.style ?? undefined;
	const scenes = applyDirector(scenesIn, style);
	const totalDuration = scenes.reduce((sum, scene) => sum + Math.max(1, scene.dur || 0), 0);
	const targetDurationSec = Number(config.length) || totalDuration || undefined;
	const music = refs.style.music.toLowerCase();
	const musicMood: StoryboardForRender["musicMood"] = style
		? style.musicMood
		: music.includes("energetic")
			? "energetic"
			: music.includes("luxury")
				? "luxury"
				: music.includes("minimal")
					? "minimal"
					: music.includes("upbeat")
						? "upbeat"
						: "chill";
	const anyMoved = scenes.some((s) => s.start != null);
	let _cur = 0;
	const sceneStarts = scenes.map((s) => {
		const st = s.start ?? _cur;
		_cur = st + Math.max(1, s.dur || 0);
		return st;
	});
	const boundarySpans: VisualBoundaryClip[] = [
		...scenes.flatMap((s, i) => {
			const visuals = s.visualClips ?? [],
				multi = visuals.length > 1,
				primary = Math.max(
					0,
					visuals.findIndex((v) => v.primary),
				);
			return multi
				? visuals.map((v, j) => ({
						id: j === primary ? clipId("scene", s.id) : `vis:${s.id}:${v.id}`,
						start: sceneStarts[i]! + (v.startSec ?? 0),
						dur: v.durationSec ?? s.dur,
						track: -1,
					}))
				: [
						{
							id: clipId("scene", s.id),
							start: sceneStarts[i]!,
							dur: Math.max(1, s.dur),
							track: -1,
						},
					];
		}),
		...(extra?.videoOverlays ?? []).map((v) => ({
			id: clipId("video", v.id),
			start: v.start,
			dur: v.dur,
			track: v.track ?? 0,
		})),
	];
	const rawTransitions = extra?.transitions ?? [];
	const allTransitions = rawTransitions.filter((t) => validTransition(t, boundarySpans));
	const brokenFrom = new Set(
		rawTransitions.filter((t) => !validTransition(t, boundarySpans)).map((t) => t.fromClipId),
	);
	const fallbackTransition = (s: Scene | undefined) =>
		s && !brokenFrom.has(clipId("scene", s.id)) ? s.transition : "cut";
	const transitions = allTransitions.filter(
		(t) =>
			parseClipId(t.fromClipId)?.source === "scene" && parseClipId(t.toClipId)?.source === "scene",
	);
	const transOut = (sceneId: number): TransitionClip | undefined =>
		transitions.find((t) => t.fromClipId === clipId("scene", sceneId));
	const transIn = (sceneId: number): TransitionClip | undefined =>
		transitions.find((t) => t.toClipId === clipId("scene", sceneId));
	type VisualTimelineItem = {
		sourceDurationSec?: number;
		volume?: number;
		mediaStartSec?: number;
		url: string;
		kind: "image" | "video";
		startSec: number;
		durationSec: number;
		movement?: string;
		motion?: Scene["motion"];
		focalPoint?: { xPct: number; yPct: number };
		layout?: unknown;
		transition?: RenderTransition;
		transitionDurSec?: number;
		reveal?: VisualRevealEffect;
	};
	const visualTimeline: VisualTimelineItem[] = [];
	const sourceAudioTracks: NonNullable<StoryboardForRender["audioOverlays"]> = [];
	const projectVideoAudio = (
		url: string,
		start: number,
		duration: number,
		layout: Partial<ClipLayout> | undefined,
		volume: number,
		timelineStart: number,
	) => {
		const keys = layout?.animation?.tracks.volume;
		if (
			layout?.preservePitch === undefined ||
			(layout.playbackRate ?? 1) === 1 ||
			(volume <= 0 && !keys?.some((k) => k.v > 0)) ||
			mediaHasAudio(extra?.mediaAssets, url) === false
		)
			return undefined;
		const source = processedAudioSource(url, start, duration, layout);
		if (source)
			sourceAudioTracks.push({
				kind: "sfx",
				content: "",
				...source,
				startSec: timelineStart,
				durationSec: duration,
				volume,
				...(keys?.length ? { animation: { tracks: { volume: keys } } } : {}),
				duckUnderVoice: 1,
				loopSource: false,
			});
		// Unresolved derived audio never falls back to a differently pitched source.
		return 0;
	};
	const anyMultiVisual = scenes.some((s) => (s.visualClips?.length ?? 0) > 1);
	return {
		stale: staleScenes(scenes, { stylePreset: config.styleName }),
		preset: presetForFormat(config.format),
		storyboard: {
			scenes: scenes.map((scene, idx) => ({
				image: sceneRenderImage(scene, refs),
				endImage: scene.endSrc ?? null,
				label: scene.name,
				chapter: chapterTitleFor(scene, extra?.chapters),
				movement: scene.move,
				motion: scene.motion ?? undefined,
				focalPoint: scene.focalPoint ?? undefined,
				transition:
					(anyMoved ? transIn(scene.id) : transOut(scene.id))?.type ??
					fallbackTransition(anyMoved ? scenes[idx - 1] : scene) ??
					"cut",
				transitionDurSec: (anyMoved ? transIn(scene.id) : transOut(scene.id))?.dur ?? undefined,
				startSec: anyMoved ? sceneStarts[idx] : undefined,
				durationSec: Math.max(1, scene.dur || 0),
				voiceover:
					(scene.audioClips ?? [])
						.filter((clip) => clip.kind === "voiceover")
						.map((clip) => clip.content)
						.join(" ")
						.trim() || scene.vo,
				visual: scene.vis,
				camera: scene.shot,
				explainer: undefined,
				sectionTransition: undefined,
				visualClips: (() => {
					const raw = scene.visualClips ?? [];
					const single = raw.length === 1 && (raw[0]?.startSec ?? 0) <= 0;
					const vcs = raw.map((clip) => {
						if (clip.kind !== "video") return clip;
						const layout =
							scene.layout || clip.layout ? { ...scene.layout, ...clip.layout } : undefined;
						const duration = single
							? sceneVisualSourceDuration(clip.durationSec, scene.dur, layout)
							: clip.durationSec;
						const silentBase = extra?.trackFlags?.[-1]?.hidden || extra?.trackFlags?.[-1]?.muted;
						const volume =
							silentBase || layout?.sourceAudioExtraction
								? 0
								: projectVideoAudio(
										clip.url,
										clip.mediaStartSec ?? 0,
										duration,
										layout,
										nativeAudioVolume(clip.volume, single ? 1 : 0, layout),
										sceneStarts[idx]! + (clip.startSec ?? 0),
									);
						const projectedLayout = volume === 0 ? silentSourceLayout(layout) : layout;
						return projectReverseSource(
							{
								...clip,
								...(projectedLayout ? { layout: projectedLayout } : {}),
								...(volume == null ? {} : { volume }),
								...(single && (layout?.preservePitch !== undefined || layout?.reverseMedia)
									? { sourceDurationSec: duration }
									: {}),
							},
							duration,
							projectedLayout,
						);
					});
					const singleSceneVisual = vcs.length === 1 && (vcs[0]?.startSec ?? 0) <= 0;
					for (const clip of vcs) {
						const tin = clip.primary
							? transIn(scene.id)
							: allTransitions.find((t) => t.toClipId === `vis:${scene.id}:${clip.id}`);
						visualTimeline.push({
							...("sourceDurationSec" in clip && typeof clip.sourceDurationSec === "number"
								? { sourceDurationSec: clip.sourceDurationSec }
								: {}),
							...(clip.volume == null ? {} : { volume: clip.volume }),
							mediaStartSec: clip.mediaStartSec,
							url: clip.url,
							kind: clip.kind === "video" ? "video" : "image",
							startSec: sceneStarts[idx]! + (clip.startSec ?? 0),
							durationSec: Math.max(
								0.5,
								singleSceneVisual ? scene.dur : (clip.durationSec ?? scene.dur),
							),
							movement: scene.move,
							motion: clip.motion ?? scene.motion ?? undefined,
							focalPoint: scene.focalPoint ?? undefined,
							layout: scene.layout || clip.layout ? { ...scene.layout, ...clip.layout } : undefined,
							transition: tin?.type,
							transitionDurSec: tin?.dur,
							reveal: clip.reveal,
						});
					}
					return vcs.map((clip) => ({
						...("sourceDurationSec" in clip && typeof clip.sourceDurationSec === "number"
							? { sourceDurationSec: clip.sourceDurationSec }
							: {}),
						...(clip.volume == null
							? {}
							: {
									volume: clip.volume,
								}),
						mediaStartSec: clip.mediaStartSec,
						layout: clip.layout,
						url: clip.url,
						primary: clip.primary,
						kind: clip.kind,
						label: clip.label,
						startSec: clip.startSec,
						durationSec: singleSceneVisual ? scene.dur : clip.durationSec,
						motion: clip.motion ?? undefined,
						reveal: clip.reveal,
					}));
				})(),
				audioClips: scene.audioClips?.map((clip) => ({
					kind: clip.kind,
					content: clip.content,
					label: clip.label,
					startSec: clip.startSec,
					durationSec: clip.durationSec,
				})),
				vignette: Boolean(scene.vignette),
				grain: Boolean(scene.grain),
				layout: scene.layout ?? undefined,
			})),
			accentColor: extra?.brand?.accentColor || "#FF3E6C",
			bgColor: "#0B0B0F",
			fgColor: "#FFFFFF",
			musicMood,
			showLabels: false,
			targetDurationSec,
			textOverlays: (extra?.overlays ?? []).map((o) => ({
				content: o.content,
				startSec: o.start,
				track: o.track,
				durationSec: o.dur,
				preset: o.preset,
				layout: o.layout ?? undefined,
				style: o.style ?? undefined,
				params: o.params ?? undefined,
			})),
			videoOverlays: [
				...(extra?.videoOverlays ?? []).map((clip) => {
					const volume = clip.layout?.sourceAudioExtraction
						? 0
						: clip.kind === "video"
							? projectVideoAudio(
									clip.url,
									clip.mediaStartSec ?? 0,
									clip.dur,
									clip.layout,
									nativeAudioVolume(clip.volume, 0, clip.layout),
									clip.start,
								)
							: undefined;
					const v =
						clip.kind === "video"
							? projectReverseSource(
									volume == null
										? clip
										: { ...clip, volume, layout: silentSourceLayout(clip.layout) },
									clip.dur,
								)
							: clip;
					const tin = allTransitions.find((t) => t.toClipId === clipId("video", v.id));
					return {
						url: v.url,
						thumb: v.thumb,
						sourceDurationSec: v.sourceDurationSec,
						kind: v.kind,
						track: v.track,
						startSec: v.start,
						durationSec: v.dur,
						layout: v.layout ?? undefined,
						transition: tin?.type ?? undefined,
						transitionDurSec: tin?.dur ?? undefined,
						mediaStartSec: v.mediaStartSec,
						volume: v.volume ?? 0,
						reveal: v.reveal,
					};
				}),
				...(extra?.brand?.logoUrl
					? [
							{
								url: extra.brand.logoUrl,
								kind: "image" as const,
								track: 0,
								startSec: 0,
								durationSec: Math.max(1, targetDurationSec ?? totalDuration),
								layout: { xPct: 76, yPct: 3, widthPct: 20, fit: "contain" as const, opacity: 0.9 },
							},
						]
					: []),
			],
			audioOverlays: [
				...(extra?.audioOverlays ?? []).map((a) => {
					const retimed = (a.playbackRate ?? 1) !== 1 || a.reverse;
					const source =
						a.url && retimed
							? processedAudioSource(a.url, a.mediaStartSec ?? 0, a.dur, a)
							: undefined;
					return {
						kind: a.kind,
						content: a.content,
						url: retimed ? source?.url : a.url,
						startSec: a.start,
						durationSec: a.dur,
						volume: a.volume ?? 1,
						...(a.animation ? { animation: a.animation } : {}),
						...(a.duckUnderVoice == null ? {} : { duckUnderVoice: a.duckUnderVoice }),
						fadeInSec: a.fadeIn ?? 0,
						fadeOutSec: a.fadeOut ?? 0,
						mediaStartSec: retimed ? source?.mediaStartSec : a.mediaStartSec,
						...(retimed ? { loopSource: false } : {}),
					};
				}),
				...sourceAudioTracks,
			],
			visualTimeline: anyMultiVisual
				? visualTimeline.map((v) => ({
						...(v.sourceDurationSec == null ? {} : { sourceDurationSec: v.sourceDurationSec }),
						...(v.volume == null ? {} : { volume: v.volume }),
						mediaStartSec: v.mediaStartSec,
						url: v.url,
						kind: v.kind,
						startSec: v.startSec,
						durationSec: v.durationSec,
						movement: v.movement,
						motion: v.motion ?? undefined,
						focalPoint: v.focalPoint,
						layout: v.layout,
						transition: v.transition,
						transitionDurSec: v.transitionDurSec,
						reveal: v.reveal,
					}))
				: undefined,
			effects: (extra?.effects ?? []).map((e) => ({
				effect: e.effect,
				startSec: e.start,
				durationSec: e.dur,
				intensity: e.intensity ?? 1,
			})),
			captions: extra?.captions
				? (() => {
						const c = extra.captions as unknown as Record<string, unknown>;
						const useBrandFont =
							extra?.brand?.fontFamily && (!c.fontFamily || c.fontFamily === "Inter");
						return useBrandFont ? { ...c, fontFamily: extra.brand!.fontFamily } : c;
					})()
				: null,
			pacingDevices: extra?.pacingDevices,
		},
	};
}

/** What a track's flags mean for a render: a hidden track contributes nothing,
 *  and a muted one contributes no sound. Exported because the fast client-side
 *  draft applies the same rule to its own inputs -- it used to spell the two
 *  predicates out again, so a change to what "hidden" means moved the MP4 and the
 *  draft apart.
 *
 *  Track -1 is the scene reel (the base track), which is why the base flags are
 *  read from the same map rather than passed separately. */
/** Track-flag predicates, resolved once so a build pass asks `shown(track)`
 *  instead of re-deriving the base-track rules at every call site. */
export { trackVisibility, type TrackVisibility } from "./track-visibility.ts";

// Clip-native render source: build the render storyboard straight from the
// canonical TimelineDoc (clips[] + markers[]). Track visibility/mute filtering +
// base-track flags are applied here (once) so the WYSIWYG preview, the export,
// and the render worker share one path. Output is byte-identical to the array
// path for the same document.
export function buildRenderStoryboardFromDoc(
	config: Config,
	refs: RefsState,
	doc: TimelineDoc,
	extra?: {
		mediaAssets?: unknown;
		trackFlags?: TrackFlags;
		captions?: CaptionConfig;
		pacingDevices?: PacingDevices;
		brand?: BrandKit;
		backgroundFill?: string;
	},
): BuiltRenderStoryboard {
	const { scenes, videoOverlays, textOverlays, audioOverlays, effects, transitions } =
		fromTimelineDoc(doc);
	const flags = extra?.trackFlags ?? {};
	const { shown, audible } = trackVisibility(flags);
	const built = buildRenderStoryboard(config, refs, scenes, {
		overlays: textOverlays.filter((o) => shown(o.track)),
		audioOverlays: audioOverlays.filter((a) => audible(a.track)),
		videoOverlays: videoOverlays
			.filter((v) => shown(v.track))
			.map((v) =>
				flags[v.track ?? 0]?.muted ? { ...v, volume: 0, layout: silentSourceLayout(v.layout) } : v,
			),
		effects: effects.filter((e) => shown(e.track)),
		chapters: doc.chapters,
		mediaAssets: extra?.mediaAssets,
		trackFlags: flags,
		transitions,
		captions: extra?.captions ?? doc.captions,
		pacingDevices: extra?.pacingDevices,
		brand: extra?.brand,
	});
	const captionCues = renderCaptionClips(doc.clips, extra?.captions ?? doc.captions, flags);
	const storyboard: StoryboardForRender = {
		...built.storyboard,
		...(captionCues.length ? { captionCues } : {}),
	};
	if (extra?.backgroundFill) storyboard.bgColor = extra.backgroundFill;
	const base = trackVisibility(flags);
	if (base.baseHidden) storyboard.hideBase = true;
	if (base.baseMuted) storyboard.muteBase = true;
	return { preset: built.preset, storyboard, stale: built.stale };
}

/** Canonical caption projection shared by production preview/export and simplified draft. */
export function renderCaptionClips(
	clips: readonly import("./timeline-doc.ts").Clip[],
	captions?: CaptionConfig,
	flags: TrackFlags = {},
) {
	if (captions?.enabled === false) return [];
	const visibility = trackVisibility(flags);
	return clips
		.filter(
			(clip) =>
				clip.type === "caption" &&
				visibility.shown(clip.track) &&
				clip.caption?.style?.enabled !== false &&
				clip.caption?.status !== "needs-refresh",
		)
		.map((clip) => CaptionClipSchema.parse(clip));
}

export function captionOutputBlockers(
	clips: readonly import("./timeline-doc.ts").Clip[],
	captions?: CaptionConfig,
	flags: TrackFlags = {},
): string[] {
	if (captions?.enabled === false) return [];
	const visibility = trackVisibility(flags);
	return clips
		.filter(
			(clip) =>
				clip.type === "caption" &&
				visibility.shown(clip.track) &&
				clip.caption?.style?.enabled !== false &&
				clip.caption?.status === "needs-refresh",
		)
		.map(
			(clip) =>
				`Caption ${clip.id} needs refresh. Refresh captions or disable captions before exporting.`,
		);
}
