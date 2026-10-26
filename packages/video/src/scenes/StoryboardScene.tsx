import { VisualMediaFrame } from "../components/VisualMediaFrame";
import {
	AbsoluteFill,
	Audio,
	Sequence,
	staticFile,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { SourceVideo, videoPremountFrames } from "../components/SourceVideo";
import { AnimatedVisual } from "../components/AnimatedVisual";
import { hasClipCompositing, sampleClipProperty } from "@maleo/shared";
import type { CSSProperties, JSX } from "react";
import { CameraMotion } from "../components/CameraMotion";
import { AnimatedText } from "../components/AnimatedText";
import { RevealEffect } from "../components/RevealEffect";
import type { StoryboardSceneData } from "../schema";
import { sourceStartFrame } from "../lib/duration";

// Entrance for one visual clip inside a beat (image A -> image B). Sequence-local
// frame, so it plays over the clip's first `durFrames` frames.
function VisualEntrance({
	type,
	durFrames,
	children,
}: {
	type?: string | null;
	durFrames: number;
	children: JSX.Element;
}): JSX.Element {
	const frame = useCurrentFrame();
	return (
		<AbsoluteFill style={visualEntranceStyle(type, frame, durFrames)}>{children}</AbsoluteFill>
	);
}

export function visualEntranceStyle(
	type: string | null | undefined,
	frame: number,
	durFrames: number,
): CSSProperties {
	const d = Math.max(1, durFrames);
	const p = Math.min(1, Math.max(0, frame / d));
	const pixelP = Math.floor(p * 7) / 7;
	const style: CSSProperties = {};
	if (type === "fade" || type === "zoom" || type === "pixel")
		style.opacity = type === "pixel" ? pixelP : p;
	if (type === "zoom") style.transform = `scale(${1.1 - 0.1 * p})`;
	else if (type === "slide") style.transform = `translateX(${(1 - p) * 100}%)`;
	else if (type === "wipe") style.clipPath = `inset(0 ${(1 - p) * 100}% 0 0)`;
	else if (type === "pixel") {
		style.transform = `scale(${1.03 - 0.03 * pixelP})`;
		style.imageRendering = "pixelated";
	}
	return style;
}

type Props = {
	scene: StoryboardSceneData;
	durationInFrames: number;
	holdInFrames?: number;
	accentColor: string;
	bgColor: string;
	fgColor: string;
	showLabel?: boolean;
};

export function visualClipDurationFrames(input: {
	clipDurationSec?: number;
	clipStartSec?: number;
	durationInFrames: number;
	fps: number;
	holdInFrames?: number;
	visualClipCount: number;
}): number {
	const startsAtScene = (input.clipStartSec ?? 0) <= 0;
	if (input.visualClipCount === 1 && startsAtScene)
		return Math.max(1, input.durationInFrames + (input.holdInFrames ?? 0));
	return Math.max(
		1,
		Math.floor((input.clipDurationSec ?? input.durationInFrames / input.fps) * input.fps),
	);
}

type SceneLayout = NonNullable<StoryboardSceneData["layout"]>;

/** A scene visual fills the frame: without its own height it takes the frame's,
 *  as the static full-frame path does, so a keyed visual never collapses to 0px. */
export function sceneVisualLayout(
	scene: SceneLayout | undefined,
	clip: SceneLayout | undefined,
): SceneLayout {
	const layout = { ...scene, ...clip };
	return { ...layout, heightPct: layout.heightPct ?? 100 };
}

const VIGNETTE_STYLE: React.CSSProperties = {
	position: "absolute",
	inset: 0,
	background: "radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)",
	pointerEvents: "none",
};

export const GRAIN_STYLE: React.CSSProperties = {
	position: "absolute",
	inset: 0,
	opacity: 0.12,
	mixBlendMode: "overlay",
	pointerEvents: "none",
	backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")`,
	backgroundSize: "200px 200px",
};

export const StoryboardScene: React.FC<Props> = ({
	scene,
	durationInFrames,
	holdInFrames = 0,
	accentColor,
	bgColor,
	fgColor,
	showLabel = false,
}) => {
	const { fps } = useVideoConfig();
	const sceneSfx = scene.audioClips?.filter((clip) => clip.kind === "sfx" && clip.url) ?? [];
	const visualClips = scene.visualClips?.length
		? scene.visualClips
		: scene.image
			? [
					{
						url: scene.image,
						primary: true,
						kind: "image" as const,
						startSec: 0,
						durationSec: durationInFrames / fps,
					},
				]
			: [];
	const resolveMediaSrc = (src: string): string =>
		/^(https?:|data:|blob:|file:)/.test(src) ? src : staticFile(src);
	// Optional placement of the base scene frame within the canvas (clip-first).
	// Absent or full-frame → render edge-to-edge as before.
	const L = scene.layout;
	const hasTransformKeys = visualClips.some((clip) =>
		Object.entries((clip.layout?.animation ?? L?.animation)?.tracks ?? {}).some(
			([property, keys]) => property !== "volume" && Boolean(keys?.length),
		),
	);
	const individualVisuals =
		hasTransformKeys ||
		visualClips.some(
			(clip) => clip.layout?.widthPct !== undefined || hasClipCompositing({ ...L, ...clip.layout }),
		);
	const positioned =
		L &&
		!(
			(L.xPct ?? 0) === 0 &&
			(L.yPct ?? 0) === 0 &&
			(L.widthPct ?? 100) === 100 &&
			(L.heightPct ?? 100) === 100 &&
			!(L.rotationDeg ?? 0) &&
			(L.opacity ?? 1) === 1
		);
	const boxStyle = positioned
		? {
				position: "absolute" as const,
				left: `${L!.xPct ?? 0}%`,
				top: `${L!.yPct ?? 0}%`,
				width: `${L!.widthPct ?? 100}%`,
				height: L!.heightPct == null ? "100%" : `${L!.heightPct}%`,
				overflow: "hidden" as const,
				rotate: L!.rotationDeg ? `${L!.rotationDeg}deg` : undefined,
				opacity: L!.opacity == null ? 1 : L!.opacity,
			}
		: undefined;
	const visuals = (
		<>
			{visualClips.length ? (
				visualClips.map((clip, index) => {
					const from = Math.max(0, Math.floor((clip.startSec ?? 0) * fps));
					const clipFrames = visualClipDurationFrames({
						clipDurationSec: clip.durationSec,
						clipStartSec: clip.startSec,
						durationInFrames,
						fps,
						holdInFrames,
						visualClipCount: visualClips.length,
					});
					const motionFrames = Math.max(1, clipFrames - holdInFrames);
					const animation = clip.layout?.animation ?? L?.animation;
					const gain = (f: number) =>
						sampleClipProperty(animation, "volume", f / fps, clip.volume ?? 1);
					const audible = (clip.volume ?? 1) > 0 || animation?.tracks.volume?.some((k) => k.v > 0);
					const media =
						clip.kind === "video" ? (
							<AbsoluteFill style={{ overflow: "hidden" }}>
								{!(clip.layout?.reverse ?? scene.layout?.reverse) && (
									<SourceVideo
										sourceDurationSec={clip.sourceDurationSec}
										src={resolveMediaSrc(clip.url)}
										startFrom={sourceStartFrame(clip.mediaStartSec, fps)}
										playbackRate={clip.layout?.playbackRate ?? scene.layout?.playbackRate ?? 1}
										volume={animation?.tracks.volume?.length ? gain : (clip.volume ?? 1)}
										muted={!audible}
										style={{ width: "100%", height: "100%", objectFit: "cover" }}
									/>
								)}
							</AbsoluteFill>
						) : (
							<CameraMotion
								src={clip.url}
								durationInFrames={motionFrames}
								movement={scene.movement}
								motion={clip.motion ?? scene.motion}
								focalPoint={scene.focalPoint}
							/>
						);
					const transformed = (
						<VisualMediaFrame
							src={clip.url}
							kind={clip.kind ?? "image"}
							layout={{ ...scene.layout, ...clip.layout }}
						>
							{media}
						</VisualMediaFrame>
					);
					const revealed = individualVisuals ? (
						<AnimatedVisual
							src={clip.url}
							kind={clip.kind ?? "image"}
							layout={sceneVisualLayout(L, clip.layout)}
							reveal={clip.reveal}
							clipFrames={motionFrames}
						>
							{media}
						</AnimatedVisual>
					) : clip.reveal ? (
						<RevealEffect reveal={clip.reveal} clipFrames={motionFrames}>
							{transformed}
						</RevealEffect>
					) : (
						transformed
					);
					// The first visual's entrance (if any) is the beat-level transition, handled
					// by the reel; only inner visuals (index>0) play their own incoming transition.
					const trDur =
						index > 0 && clip.transition && clip.transition !== "cut"
							? clip.transitionDurSec
								? Math.round(clip.transitionDurSec * fps)
								: 12
							: 0;
					return (
						<Sequence
							key={`${clip.url}-${index}`}
							premountFor={clip.kind === "video" ? videoPremountFrames(fps) : undefined}
							from={from}
							durationInFrames={clipFrames}
							style={{ mixBlendMode: clip.layout?.blendMode ?? L?.blendMode }}
						>
							{trDur > 0 ? (
								<VisualEntrance type={clip.transition} durFrames={trDur}>
									{revealed}
								</VisualEntrance>
							) : (
								revealed
							)}
						</Sequence>
					);
				})
			) : (
				<AbsoluteFill style={{ background: bgColor }} />
			)}
		</>
	);
	return (
		<AbsoluteFill style={{ background: bgColor, isolation: "isolate" }}>
			{positioned && !individualVisuals ? <div style={boxStyle}>{visuals}</div> : visuals}

			{/* Bottom legibility gradient — only under a visible label; a bare scene
          shows its art unshaded (previously this darkened every frame). */}
			{showLabel && scene.label ? (
				<AbsoluteFill
					style={{
						background:
							"linear-gradient(180deg, rgba(0,0,0,0.0) 0%, rgba(0,0,0,0.35) 60%, rgba(0,0,0,0.75) 100%)",
					}}
				/>
			) : null}

			{scene.vignette ? <div style={VIGNETTE_STYLE} /> : null}
			{scene.grain ? <div style={GRAIN_STYLE} /> : null}

			{scene.sfxUrl ? <Audio src={scene.sfxUrl} volume={0.8} /> : null}
			{sceneSfx.map((clip, index) => (
				<Audio key={`${clip.url}-${index}`} src={clip.url!} volume={0.8} />
			))}

			{showLabel && scene.label ? (
				<AbsoluteFill
					style={{
						padding: 80,
						justifyContent: "flex-end",
						alignItems: "flex-start",
						gap: 12,
					}}
				>
					<AnimatedText text={scene.label} size={48} color={accentColor} weight={700} delay={2} />
					{scene.visual ? (
						<AnimatedText text={scene.visual} size={36} color={fgColor} weight={500} delay={8} />
					) : null}
				</AbsoluteFill>
			) : null}
		</AbsoluteFill>
	);
};
