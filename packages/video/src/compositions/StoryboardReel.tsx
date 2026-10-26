import { shapePrimitiveOf } from "@maleo/shared";
import { Fragment } from "react";
import { AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, useVideoConfig } from "remotion";
import { SourceVideo, videoPremountFrames } from "../components/SourceVideo";
import { AnimatedVisual } from "../components/AnimatedVisual";
import { sampleClipProperty } from "@maleo/shared";
import type { CSSProperties, JSX } from "react";
import { TransitionSeries } from "@remotion/transitions";
import { StoryboardScene } from "../scenes/StoryboardScene";
import { CameraMotion } from "../components/CameraMotion";
import { Captions } from "../components/Captions";
import { ChapterPill } from "../components/ChapterPill";
import { ProgressBar } from "../components/ProgressBar";
import { resolveTransition } from "../lib/transitions";
import { sourceStartFrame } from "../lib/duration";
import { duckEnvelope } from "../lib/music";
import { timelineAudioGain } from "@maleo/shared";
import type { Storyboard } from "../schema";
import { useCurrentFrame } from "remotion";
// Side effect: load the shared font so render text metrics match the preview.
import "../fonts";

const MusicLayer: React.FC<{ url: string; storyboard: Storyboard }> = ({ url, storyboard }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const vo = storyboard.voiceover;
	const ranges = vo ? [{ startSec: vo.startSec, endSec: vo.endSec ?? vo.startSec + 6 }] : [];
	const volume = duckEnvelope(frame, fps, ranges);
	return <Audio src={url} volume={volume} />;
};

import {
	ShapePrimitive,
	TemplateFrame,
	plainTextCss,
	type LayoutLike,
	CompositionOverlay,
} from "./reel-text";

// Absolute box (% of canvas) for a positioned clip. Returns null when the layout
// is absent so callers fall back to the legacy full-frame render.
/** The chapter spans a chapter pill counts, from RUNS of consecutive scenes.
 *
 * Derived here rather than carried on the storyboard so a chapter's span cannot
 * disagree with the scenes in it. A run of scenes with no chapter is one span
 * labelled by its first scene, which is what the pill showed for every scene
 * before chapters existed. */
export function chapterSpans(
	scenes: ReadonlyArray<{ label?: string; chapter?: string }>,
	timings: ReadonlyArray<{ startSec: number; endSec: number }>,
): Array<{ label: string; startSec: number; endSec: number }> {
	const spans: Array<{ label: string; startSec: number; endSec: number }> = [];
	let key: string | undefined;
	scenes.forEach((scene, i) => {
		const timing = timings[i];
		if (!timing) return;
		const next = scene.chapter;
		if (spans.length === 0 || (next !== undefined && next !== key)) {
			spans.push({
				label: next ?? scene.label ?? "",
				startSec: timing.startSec,
				endSec: timing.endSec,
			});
			key = next;
			return;
		}
		spans[spans.length - 1]!.endSec = timing.endSec;
	});
	return spans;
}

export function storyboardSceneTimings(
	scenes: ReadonlyArray<{ startSec?: number | null; durationSec: number }>,
) {
	const hasExplicitStarts = scenes.some((s) => s.startSec != null);
	let cursorSec = 0;
	return scenes.map((s) => {
		const start = hasExplicitStarts ? (s.startSec ?? cursorSec) : cursorSec;
		cursorSec = start + s.durationSec;
		return { startSec: start, endSec: start + s.durationSec };
	});
}

function layoutBoxStyle(l: LayoutLike): CSSProperties | null {
	if (!l) return null;
	return {
		position: "absolute",
		left: `${l.xPct ?? 0}%`,
		top: `${l.yPct ?? 0}%`,
		width: `${l.widthPct ?? 100}%`,
		height: l.heightPct == null ? "auto" : `${l.heightPct}%`,
		rotate: l.rotationDeg ? `${l.rotationDeg}deg` : undefined,
		opacity: l.opacity == null ? 1 : l.opacity,
	};
}
function layoutObjectFit(l: LayoutLike): "contain" | "cover" | "fill" {
	return l?.fit === "stretch" ? "fill" : l?.fit === "contain" ? "contain" : "cover";
}

// Black-overlay opacity for timeline effects at absolute time t (mirrors the
// editor's effects.ts so preview + render match).
export function effectsBlackOpacity(
	effects: ReadonlyArray<{
		effect: string;
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>,
	t: number,
): number {
	let black = 0;
	for (const e of effects) {
		if (e.effect !== "fade_in" && e.effect !== "fade_out" && e.effect !== "zoom_out_from_black")
			continue;
		if (t < e.startSec || t >= e.startSec + e.durationSec) continue;
		const p = e.durationSec > 0 ? Math.max(0, Math.min(1, (t - e.startSec) / e.durationSec)) : 1;
		const k = e.intensity == null ? 1 : Math.max(0, Math.min(1, e.intensity));
		const v =
			e.effect === "fade_in"
				? 1 - p
				: e.effect === "fade_out"
					? p
					: Math.max(0, Math.min(1, 1 - p * 1.6));
		black = Math.max(black, v * k);
	}
	return black;
}

// White-flash opacity (pattern interrupt): triangular spike — fast attack over
// the first 30% of the span, decay over the rest.
export function effectsWhiteOpacity(
	effects: ReadonlyArray<{
		effect: string;
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>,
	t: number,
): number {
	let white = 0;
	for (const e of effects) {
		if (e.effect !== "flash") continue;
		if (t < e.startSec || t >= e.startSec + e.durationSec) continue;
		const p = e.durationSec > 0 ? Math.max(0, Math.min(1, (t - e.startSec) / e.durationSec)) : 1;
		const k = e.intensity == null ? 1 : Math.max(0, Math.min(1, e.intensity));
		const v = p < 0.3 ? p / 0.3 : 1 - (p - 0.3) / 0.7;
		white = Math.max(white, v * k);
	}
	return white;
}

// Whole-frame scale for zoom effects at absolute time t (mirrors the editor's
// effects.ts so the preview zoom matches the render). zoom_punch is a fast
// snap-in that eases back — a pattern interrupt.
export function effectsScale(
	effects: ReadonlyArray<{
		effect: string;
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>,
	t: number,
): number {
	let scale = 1;
	for (const e of effects) {
		if (e.effect !== "zoom_out_from_black" && e.effect !== "zoom_punch") continue;
		if (t < e.startSec || t >= e.startSec + e.durationSec) continue;
		const p = e.durationSec > 0 ? Math.max(0, Math.min(1, (t - e.startSec) / e.durationSec)) : 1;
		const k = e.intensity == null ? 1 : Math.max(0, Math.min(1, e.intensity));
		if (e.effect === "zoom_out_from_black") scale *= 1 + (1 - p) * 0.6 * k;
		else {
			const env = p < 0.25 ? p / 0.25 : 1 - (p - 0.25) / 0.75;
			scale *= 1 + env * 0.16 * k;
		}
	}
	return scale;
}

// Lateral whip offset (percent of frame width) for whip_pan at absolute time t:
// a single fast sine sweep across the span.
export function effectsWhipPct(
	effects: ReadonlyArray<{
		effect: string;
		startSec: number;
		durationSec: number;
		intensity?: number;
	}>,
	t: number,
): number {
	let x = 0;
	for (const e of effects) {
		if (e.effect !== "whip_pan") continue;
		if (t < e.startSec || t >= e.startSec + e.durationSec) continue;
		const p = e.durationSec > 0 ? Math.max(0, Math.min(1, (t - e.startSec) / e.durationSec)) : 1;
		const k = e.intensity == null ? 1 : Math.max(0, Math.min(1, e.intensity));
		x += Math.sin(p * Math.PI * 2) * 10 * k;
	}
	return x;
}

function ZoomWrap({
	effects,
	children,
}: {
	effects: ReadonlyArray<{ effect: string; startSec: number; durationSec: number }>;
	children: JSX.Element;
}): JSX.Element {
	const { fps } = useVideoConfig();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const scale = effectsScale(effects, t);
	const whip = effectsWhipPct(effects, t);
	const style: CSSProperties = {};
	if (scale !== 1) {
		style.scale = String(scale);
		style.transformOrigin = "center center";
	}
	if (whip !== 0) style.translate = `${whip}% 0`;
	return (
		<AbsoluteFill style={scale !== 1 || whip !== 0 ? style : undefined}>{children}</AbsoluteFill>
	);
}

function EffectsLayer({
	effects,
}: {
	effects: ReadonlyArray<{ effect: string; startSec: number; durationSec: number }>;
}): JSX.Element | null {
	const { fps } = useVideoConfig();
	const frame = useCurrentFrame();
	const t = frame / fps;
	const black = effectsBlackOpacity(effects, t);
	const white = effectsWhiteOpacity(effects, t);
	if (black <= 0.001 && white <= 0.001) return null;
	return (
		<>
			{black > 0.001 ? (
				<AbsoluteFill style={{ background: "#000", opacity: black, zIndex: 60 }} />
			) : null}
			{white > 0.001 ? (
				<AbsoluteFill style={{ background: "#fff", opacity: white, zIndex: 61 }} />
			) : null}
		</>
	);
}

// Entrance effect for a scene rendered as an absolute Sequence (gaps mode). The
// frame is sequence-local, so the effect plays over the first `durFrames` frames.
// Mirrors the editor's incoming-transition look so preview and export match.
// Exit effect for the OUTGOING clip while it holds under the next clip's
// entrance: slide pushes it out, zoom/flip scale-rotate it away (matching the
// TransitionSeries presentations); fade/wipe/clock/pixel hold it static and
// let the incoming clip cover it. Frame is sequence-local; the exit window is
// [fromFrame, fromFrame + durFrames).
export function sceneExitStyle(
	type: string | undefined,
	frame: number,
	fromFrame: number,
	durFrames: number,
): CSSProperties | undefined {
	if (!type || type === "cut" || durFrames <= 0 || frame < fromFrame) return undefined;
	const q = Math.min(1, Math.max(0, (frame - fromFrame) / Math.max(1, durFrames)));
	const style: CSSProperties = {};
	if (type === "slide") style.transform = `translateX(${-q * 100}%)`;
	else if (type === "zoom") {
		style.transform = `scale(${1 + 0.12 * q})`;
		style.opacity = 1 - q;
	} else if (type === "flip") {
		style.transform = `perspective(1000px) rotateY(${q * 90}deg)`;
		style.opacity = 1 - q;
	}
	return Object.keys(style).length ? style : undefined;
}

function SceneExit({
	type,
	fromFrame,
	durFrames,
	children,
}: {
	type?: string;
	fromFrame: number;
	durFrames: number;
	children: JSX.Element;
}): JSX.Element {
	const frame = useCurrentFrame();
	const style = sceneExitStyle(type, frame, fromFrame, durFrames);
	return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

export function sceneEntranceStyle(
	type: string | undefined,
	frame: number,
	durFrames: number,
): CSSProperties | undefined {
	const d = Math.max(1, durFrames);
	const p = Math.min(1, Math.max(0, frame / d));
	const pixelP = Math.floor(p * 7) / 7;
	const style: CSSProperties = {};
	if (
		type === "fade" ||
		type === "zoom" ||
		type === "wipe" ||
		type === "flip" ||
		type === "clock_wipe" ||
		type === "pixel"
	)
		style.opacity = type === "pixel" ? pixelP : p;
	if (type === "zoom") style.transform = `scale(${1.15 - 0.15 * p})`;
	else if (type === "slide") style.transform = `translateX(${(1 - p) * 100}%)`;
	else if (type === "wipe") style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
	else if (type === "flip") style.transform = `perspective(1000px) rotateY(${(1 - p) * -90}deg)`;
	// Entrance approximation of the clock wipe: a circular reveal from center.
	else if (type === "clock_wipe") style.clipPath = `circle(${p * 75}% at 50% 50%)`;
	else if (type === "pixel") {
		style.transform = `scale(${1.04 - 0.04 * pixelP})`;
		style.imageRendering = "pixelated";
	}
	return Object.keys(style).length ? style : undefined;
}

export function sceneBoundaryHold(input: {
	startSec: number;
	endSec: number;
	nextStartSec?: number;
	transitionFrames: number;
	fps: number;
}) {
	if (input.nextStartSec == null || input.transitionFrames <= 0)
		return { exitFromFrame: 0, holdFrames: 0 };
	const startFrame = Math.floor(input.startSec * input.fps);
	const endFrame =
		startFrame + Math.max(1, Math.round((input.endSec - input.startSec) * input.fps));
	const nextStartFrame = Math.floor(input.nextStartSec * input.fps);
	const exitFromFrame = Math.max(0, nextStartFrame - startFrame);
	const holdFrames = Math.max(0, nextStartFrame - endFrame) + input.transitionFrames;
	return { exitFromFrame, holdFrames };
}

function SceneEntrance({
	type,
	durFrames,
	children,
}: {
	type?: string;
	durFrames: number;
	children: JSX.Element;
}): JSX.Element {
	const frame = useCurrentFrame();
	const style = sceneEntranceStyle(type, frame, durFrames);
	return <AbsoluteFill style={style}>{children}</AbsoluteFill>;
}

export const StoryboardReel: React.FC<Storyboard> = (storyboard) => {
	const { fps, width, height } = useVideoConfig();

	const sceneDurations = storyboard.scenes.map((s) => Math.max(1, Math.floor(s.durationSec * fps)));

	// When any scene carries an absolute startSec the timeline has been edited as
	// free clips (movable, gaps allowed): honor those starts. Otherwise pack scenes
	// sequentially as before. sceneTimings drives per-scene audio/caption sync too.
	const hasExplicitStarts = storyboard.scenes.some((s) => s.startSec != null);
	const sceneTimings = storyboardSceneTimings(storyboard.scenes);

	// Absolute voiceover spans — a continuous music bed ducks under these and swells
	// back up in the gaps between them (the story inter-section pauses).
	const voiceoverRanges = (storyboard.audioOverlays ?? [])
		.filter((a) => a.kind === "voiceover")
		.map((a) => ({ startSec: a.startSec, endSec: a.startSec + a.durationSec }))
		.sort((a, b) => a.startSec - b.startSec);

	return (
		<AbsoluteFill style={{ isolation: "isolate" }}>
			<ZoomWrap effects={storyboard.effects ?? []}>
				<AbsoluteFill style={{ opacity: storyboard.hideBase ? 0 : 1 }}>
					{storyboard.visualTimeline?.length ? (
						// Pure clip render: every base visual (primary + beat extras) is a top-level
						// absolute Sequence — scenes contribute no Sequence, only audio/caption timing.
						// Payload semantics (buildRenderStoryboard): a visualTimeline clip's
						// `transition` is its INCOMING edge — it plays as this clip's entrance,
						// while the PREVIOUS contiguous clip holds underneath for that window.
						// Stacking is DOM order (sorted by start) — no zIndex, so overlays and
						// captions rendered later still paint above the base visuals.
						<AbsoluteFill style={{ background: "#000" }}>
							{[...storyboard.visualTimeline]
								.sort((a, b) => a.startSec - b.startSec)
								.map((v, i, sorted) => {
									const frames = Math.max(1, Math.floor(v.durationSec * fps));
									const end = v.startSec + v.durationSec;
									// Boundary neighbor: the nearest clip starting at (or up to 1s after)
									// my end — small deliberate gaps (story inter-section pauses)
									// still count as a boundary, and I hold THROUGH the gap so the
									// transition never plays over black.
									const next = sorted
										.filter((o) => o !== v && o.startSec >= end - 1 / fps && o.startSec - end <= 1)
										.sort((a, b) => a.startSec - b.startSec)[0];
									// Entrance = my own incoming edge.
									const entranceType =
										v.transition && v.transition !== "cut" ? v.transition : undefined;
									const trDur = entranceType
										? v.transitionDurSec
											? Math.round(v.transitionDurSec * fps)
											: 12
										: 0;
									// Hold = gap (if any) + the NEXT clip's incoming window.
									const nextTr =
										next && next.transition && next.transition !== "cut"
											? next.transitionDurSec
												? Math.round(next.transitionDurSec * fps)
												: 12
											: 0;
									const holdFrames =
										nextTr > 0 ? Math.max(0, Math.round((next!.startSec - end) * fps)) + nextTr : 0;
									const fit = layoutObjectFit(v.layout);
									const gain = (f: number) =>
										sampleClipProperty(v.layout?.animation, "volume", f / fps, v.volume ?? 0);
									const audible =
										(v.volume ?? 0) > 0 || v.layout?.animation?.tracks.volume?.some((k) => k.v > 0);
									const media =
										v.kind === "video" ? (
											<AbsoluteFill style={{ overflow: "hidden" }}>
												{!v.layout?.reverse && (
													<SourceVideo
														sourceDurationSec={v.sourceDurationSec}
														src={v.url}
														startFrom={sourceStartFrame(v.mediaStartSec, fps)}
														playbackRate={v.layout?.playbackRate ?? 1}
														muted={!audible}
														volume={
															v.layout?.animation?.tracks.volume?.length ? gain : (v.volume ?? 0)
														}
														style={{ width: "100%", height: "100%", objectFit: fit }}
													/>
												)}
											</AbsoluteFill>
										) : (
											<CameraMotion
												src={v.url}
												durationInFrames={frames}
												movement={v.movement}
												motion={v.motion}
												focalPoint={v.focalPoint}
											/>
										);
									const inner = (
										<AnimatedVisual
											src={v.url}
											kind={v.kind}
											layout={v.layout}
											reveal={v.reveal}
											clipFrames={frames}
										>
											{media}
										</AnimatedVisual>
									);
									const entered =
										trDur > 0 ? (
											<SceneEntrance type={entranceType} durFrames={trDur}>
												{inner}
											</SceneEntrance>
										) : (
											inner
										);
									return (
										<Sequence
											key={`vt-${i}`}
											premountFor={v.kind === "video" ? videoPremountFrames(fps) : undefined}
											from={Math.floor(v.startSec * fps)}
											durationInFrames={frames + holdFrames}
											style={{ mixBlendMode: v.layout?.blendMode }}
										>
											{holdFrames > 0 ? (
												<SceneExit
													type={next?.transition ?? undefined}
													fromFrame={frames}
													durFrames={holdFrames}
												>
													{entered}
												</SceneExit>
											) : (
												entered
											)}
										</Sequence>
									);
								})}
						</AbsoluteFill>
					) : hasExplicitStarts ? (
						// Absolute layout: scenes positioned over black, gaps render black.
						// Payload semantics (buildRenderStoryboard, moved path): a scene's
						// `transition` is its INCOMING edge — this scene's entrance — while the
						// PREVIOUS contiguous scene holds underneath for that window. Stacking
						// is DOM order (sorted by start) — no zIndex.
						<AbsoluteFill style={{ background: "#000" }}>
							{storyboard.scenes
								.map((scene, i) => ({ scene, i }))
								.sort((a, b) => sceneTimings[a.i]!.startSec - sceneTimings[b.i]!.startSec)
								.map(({ scene, i }) => {
									const frames = sceneDurations[i]!;
									const start = sceneTimings[i]!.startSec;
									const end = sceneTimings[i]!.endSec;
									// Boundary neighbor: nearest scene starting at (or up to 1s after)
									// my end — inter-scene pauses still form a boundary; I hold
									// THROUGH the gap so the transition never plays over black.
									const nextIdx =
										storyboard.scenes
											.map((_, j) => j)
											.filter(
												(j) =>
													j !== i &&
													sceneTimings[j]!.startSec >= end - 1 / fps &&
													sceneTimings[j]!.startSec - end <= 1,
											)
											.sort((a, b) => sceneTimings[a]!.startSec - sceneTimings[b]!.startSec)[0] ??
										-1;
									const nextScene = nextIdx >= 0 ? storyboard.scenes[nextIdx] : undefined;
									const entranceType =
										scene.transition && scene.transition !== "cut" ? scene.transition : undefined;
									const durFrames = entranceType
										? scene.transitionDurSec
											? Math.round(scene.transitionDurSec * fps)
											: 12
										: 0;
									const nextTr =
										nextScene && nextScene.transition && nextScene.transition !== "cut"
											? nextScene.transitionDurSec
												? Math.round(nextScene.transitionDurSec * fps)
												: 12
											: 0;
									const { exitFromFrame, holdFrames } = sceneBoundaryHold({
										startSec: start,
										endSec: end,
										nextStartSec: nextIdx >= 0 ? sceneTimings[nextIdx]!.startSec : undefined,
										transitionFrames: nextTr,
										fps,
									});
									return (
										<Sequence
											key={`scene-${i}`}
											from={Math.floor(start * fps)}
											durationInFrames={frames + holdFrames}
										>
											<SceneExit
												type={nextScene?.transition ?? undefined}
												fromFrame={exitFromFrame}
												durFrames={nextTr}
											>
												<SceneEntrance type={entranceType ?? "cut"} durFrames={durFrames}>
													<StoryboardScene
														scene={scene}
														durationInFrames={frames}
														holdInFrames={holdFrames}
														accentColor={storyboard.accentColor}
														bgColor={storyboard.bgColor}
														fgColor={storyboard.fgColor}
														showLabel={storyboard.showLabels}
													/>
												</SceneEntrance>
											</SceneExit>
										</Sequence>
									);
								})}
						</AbsoluteFill>
					) : (
						<TransitionSeries>
							{storyboard.scenes.map((scene, i) => {
								const frames = sceneDurations[i]!;
								const isLast = i === storyboard.scenes.length - 1;
								const transition = isLast
									? null
									: resolveTransition(
											scene.transition,
											scene.transitionDurSec ? Math.round(scene.transitionDurSec * fps) : undefined,
											{ width, height },
										);

								return (
									<Fragment key={`scene-block-${i}`}>
										<TransitionSeries.Sequence durationInFrames={frames}>
											<StoryboardScene
												scene={scene}
												durationInFrames={frames}
												accentColor={storyboard.accentColor}
												bgColor={storyboard.bgColor}
												fgColor={storyboard.fgColor}
												showLabel={storyboard.showLabels}
											/>
										</TransitionSeries.Sequence>
										{transition ? (
											<TransitionSeries.Transition
												presentation={transition.presentation}
												timing={transition.timing}
											/>
										) : null}
									</Fragment>
								);
							})}
						</TransitionSeries>
					)}
				</AbsoluteFill>
			</ZoomWrap>

			{/* Pacing devices + captions live ABOVE every clip row (rows use
          zIndex 10 + track; these pin far higher so no track can cover them). */}
			{storyboard.pacingDevices?.chapterPills ? (
				<AbsoluteFill style={{ zIndex: 900, pointerEvents: "none" }}>
					<ChapterPill
						chapters={chapterSpans(storyboard.scenes, sceneTimings)}
						accentColor={storyboard.accentColor}
						fgColor={storyboard.fgColor}
						bgColor={storyboard.bgColor}
						variant={storyboard.pacingDevices.variant}
					/>
				</AbsoluteFill>
			) : null}
			{storyboard.pacingDevices?.progressBar ? (
				<AbsoluteFill style={{ zIndex: 900, pointerEvents: "none" }}>
					<ProgressBar accentColor={storyboard.accentColor} fgColor={storyboard.fgColor} />
				</AbsoluteFill>
			) : null}

			{storyboard.captionCues?.length ? (
				<AbsoluteFill style={{ zIndex: 920, pointerEvents: "none" }}>
					<Captions
						cues={storyboard.captionCues}
						accentColor={storyboard.accentColor}
						fgColor={storyboard.fgColor}
						config={storyboard.captions}
					/>
				</AbsoluteFill>
			) : null}

			{storyboard.voiceover?.audioUrl && !storyboard.muteBase ? (
				<Sequence from={Math.floor(storyboard.voiceover.startSec * fps)}>
					<Audio src={storyboard.voiceover.audioUrl} volume={1} />
				</Sequence>
			) : null}

			{storyboard.musicUrl && !storyboard.muteBase ? (
				<Sequence from={0}>
					<MusicLayer url={storyboard.musicUrl} storyboard={storyboard} />
				</Sequence>
			) : null}
			{(storyboard.muteBase ? [] : storyboard.scenes).flatMap((scene, sceneIndex) => {
				const timing = sceneTimings[sceneIndex];
				if (!timing || !scene.audioClips?.length) return [];
				return scene.audioClips
					.filter((clip) => clip.kind !== "voiceover" && clip.url)
					.map((clip, clipIndex) => (
						<Sequence
							key={`scene-audio-${sceneIndex}-${clipIndex}`}
							from={Math.floor((timing.startSec + (clip.startSec ?? 0)) * fps)}
							durationInFrames={Math.max(
								1,
								Math.floor((clip.durationSec ?? scene.durationSec) * fps),
							)}
						>
							<Audio src={clip.url!} volume={clip.kind === "music" ? 0.45 : 0.8} />
						</Sequence>
					));
			})}

			{/* B-roll / video overlays — composited over the base reel for their span.
          A contiguous same-track neighbor's incoming transition makes this clip
          hold + exit underneath it, same boundary behavior as the base track. */}
			{storyboard.videoOverlays?.map((ov, i, all) => {
				const fit = layoutObjectFit(ov.layout);
				const rate =
					ov.layout?.playbackRate && ov.layout.playbackRate > 0 ? ov.layout.playbackRate : 1;
				// Per-clip source-audio gain: 0 (default) keeps b-roll muted as before.
				const ovVol = ov.volume ?? 0;
				const gain = (f: number) =>
					sampleClipProperty(ov.layout?.animation, "volume", f / fps, ovVol);
				const audible = ovVol > 0 || ov.layout?.animation?.tracks.volume?.some((k) => k.v > 0);
				const media =
					ov.kind === "video" ? (
						!ov.layout?.reverse && (
							<OffthreadVideo
								src={ov.url}
								muted={!audible}
								volume={ov.layout?.animation?.tracks.volume?.length ? gain : ovVol}
								playbackRate={rate}
								trimBefore={sourceStartFrame(ov.mediaStartSec, fps)}
								style={{ width: "100%", height: "100%", objectFit: fit }}
							/>
						)
					) : (
						<Img src={ov.url} style={{ width: "100%", height: "100%", objectFit: fit }} />
					);
				const trDur =
					ov.transition && ov.transition !== "cut"
						? ov.transitionDurSec
							? Math.round(ov.transitionDurSec * fps)
							: 12
						: 0;
				const frames = Math.max(1, Math.floor(ov.durationSec * fps));
				const end = ov.startSec + ov.durationSec;
				// Nearest same-track neighbor within 1s forms the boundary; hold spans
				// the gap + its entrance so the transition never plays over black.
				const next = all
					.filter(
						(o) =>
							o !== ov &&
							(o.track ?? 0) === (ov.track ?? 0) &&
							o.startSec >= end - 1 / fps &&
							o.startSec - end <= 1,
					)
					.sort((a, b) => a.startSec - b.startSec)[0];
				const nextTr =
					next && next.transition && next.transition !== "cut"
						? next.transitionDurSec
							? Math.round(next.transitionDurSec * fps)
							: 12
						: 0;
				const holdFrames =
					nextTr > 0 ? Math.max(0, Math.round((next!.startSec - end) * fps)) + nextTr : 0;
				const inner = (
					<AnimatedVisual
						src={ov.url}
						kind={ov.kind}
						layout={ov.layout}
						reveal={ov.reveal}
						clipFrames={frames}
					>
						{media}
					</AnimatedVisual>
				);
				const entered =
					trDur > 0 ? (
						<SceneEntrance type={ov.transition ?? "cut"} durFrames={trDur}>
							{inner}
						</SceneEntrance>
					) : (
						inner
					);
				return (
					<Sequence
						key={`vov-${i}`}
						premountFor={ov.kind === "video" ? videoPremountFrames(fps) : undefined}
						from={Math.floor(ov.startSec * fps)}
						durationInFrames={frames + holdFrames}
					>
						<AbsoluteFill
							style={{ zIndex: 10 + (ov.track ?? 0), mixBlendMode: ov.layout?.blendMode }}
						>
							{holdFrames > 0 ? (
								<SceneExit
									type={next?.transition ?? undefined}
									fromFrame={frames}
									durFrames={holdFrames}
								>
									{entered}
								</SceneExit>
							) : (
								entered
							)}
						</AbsoluteFill>
					</Sequence>
				);
			})}

			{/* Free-form audio overlays (extra voiceover / music tracks) with per-clip
          gain + fade in/out. */}
			{storyboard.audioOverlays
				?.filter((a) => a.url)
				.map((a, i) => {
					const frames = Math.max(1, Math.floor(a.durationSec * fps));
					const startFrame = Math.floor(a.startSec * fps);
					return (
						<Sequence key={`aov-${i}`} from={startFrame} durationInFrames={frames}>
							<Audio
								src={a.url!}
								loop={a.kind === "music" && a.loopSource !== false}
								// Keep fades and ducking continuous across music loops.
								loopVolumeCurveBehavior="extend"
								volume={(frame) => timelineAudioGain(a, frame, fps, voiceoverRanges)}
								trimBefore={sourceStartFrame(a.mediaStartSec, fps)}
							/>
						</Sequence>
					);
				})}

			{/* Text / title overlays (top layer). */}
			{storyboard.textOverlays?.map((t, i) => {
				const box = layoutBoxStyle(t.layout);
				const st = t.style;
				const align = st?.align ?? "center";
				const content = st?.casing === "upper" ? t.content.toUpperCase() : t.content;
				const plainTextStyle = (sampledStyle: typeof st): CSSProperties =>
					plainTextCss(sampledStyle, storyboard.fgColor);
				const textStyle: CSSProperties = plainTextStyle(st);
				const tovFrames = Math.max(1, Math.floor(t.durationSec * fps));
				// One-clip Motion Studio composition: sub-overlays scale to the clip.
				if (t.preset === "motion-comp") {
					return (
						<Sequence
							key={`tov-${i}`}
							from={Math.floor(t.startSec * fps)}
							durationInFrames={tovFrames}
						>
							<TemplateFrame
								style={st}
								zIndex={t.track != null ? 10 + t.track : 40}
								layout={t.layout}
								anim={t.anim}
								frames={tovFrames}
							>
								{(sampledStyle) => (
									<CompositionOverlay
										config={t.params}
										frames={tovFrames}
										fps={fps}
										zIndex={1}
										accentColor={sampledStyle?.accent ?? storyboard.accentColor}
										bgColor={sampledStyle?.background ?? storyboard.bgColor}
										fgColor={sampledStyle?.fill ?? storyboard.fgColor}
									/>
								)}
							</TemplateFrame>
						</Sequence>
					);
				}
				const shape = shapePrimitiveOf(t.preset);
				if (shape)
					return (
						<Sequence
							key={`tov-${i}`}
							from={Math.floor(t.startSec * fps)}
							durationInFrames={tovFrames}
						>
							<TemplateFrame
								style={st}
								zIndex={t.track != null ? 10 + t.track : 40}
								layout={t.layout}
								anim={t.anim}
								frames={tovFrames}
							>
								<ShapePrimitive
									preset={shape.preset}
									params={t.params}
									accentColor={storyboard.accentColor}
								/>
							</TemplateFrame>
						</Sequence>
					);
				if (t.preset !== "plain")
					throw new Error(`Unsupported visual preset: ${t.preset ?? "missing"}`);
				// Positioned text: the layout box defines the text block bounds.
				if (box) {
					return (
						<Sequence
							key={`tov-${i}`}
							from={Math.floor(t.startSec * fps)}
							durationInFrames={tovFrames}
						>
							<TemplateFrame
								style={st}
								zIndex={t.track != null ? 10 + t.track : 40}
								layout={t.layout}
								anim={t.anim}
								frames={tovFrames}
							>
								{(sampledStyle) => (
									<>
										<AbsoluteFill
											style={{
												display: "flex",
												alignItems: "center",
												justifyContent:
													align === "left"
														? "flex-start"
														: align === "right"
															? "flex-end"
															: "center",
											}}
										>
											<div style={plainTextStyle(sampledStyle)}>{content}</div>
										</AbsoluteFill>
									</>
								)}
							</TemplateFrame>
						</Sequence>
					);
				}
				return (
					<Sequence
						key={`tov-${i}`}
						from={Math.floor(t.startSec * fps)}
						durationInFrames={tovFrames}
					>
						<AbsoluteFill
							style={{
								zIndex: t.track != null ? 10 + t.track : 40,
								justifyContent: "center",
								alignItems: "center",
								padding: 64,
							}}
						>
							<>
								<AbsoluteFill
									style={{
										justifyContent: "center",
										alignItems: "center",
										padding: 64,
									}}
								>
									<div style={textStyle}>{content}</div>
								</AbsoluteFill>
							</>
						</AbsoluteFill>
					</Sequence>
				);
			})}

			{storyboard.effects?.length ? <EffectsLayer effects={storyboard.effects} /> : null}
		</AbsoluteFill>
	);
};
