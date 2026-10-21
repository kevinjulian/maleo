import type { ReactNode } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { sampleClipTransform } from "@maleo/shared";
import type { Storyboard, VisualRevealData } from "../schema";
import { ClipCompositingFrame } from "./ClipCompositing";
import { VisualMediaFrame } from "./VisualMediaFrame";
import { RevealEffect } from "./RevealEffect";

type Layout = NonNullable<Storyboard["videoOverlays"]>[number]["layout"];

/** Crop/flip/color/mask wrappers are absolutely positioned and cannot size an auto-height
 *  box, so a wrapped visual without a height fills the frame height its mask and crop already assume. */
export function visualBoxHeight(layout: Layout): string {
	if (layout?.heightPct != null) return `${layout.heightPct}%`;
	const color = layout?.color;
	const wrapped = Boolean(
		layout?.crop ||
		layout?.flipX ||
		layout?.flipY ||
		layout?.mask ||
		(color && Object.values(color).some((v) => v !== 1)),
	);
	return wrapped ? "100%" : "auto";
}

/** One crop -> color -> mask -> reveal -> animated/static transform path for ordinary visuals. */
export function AnimatedVisual({
	src,
	kind,
	layout,
	reveal,
	clipFrames,
	children,
}: {
	src: string;
	kind: "image" | "video";
	layout?: Layout;
	reveal?: VisualRevealData;
	clipFrames: number;
	children: ReactNode;
}) {
	const frame = useCurrentFrame(),
		{ fps } = useVideoConfig(),
		sampled = sampleClipTransform(layout, frame / fps);
	const cropped = (
		<VisualMediaFrame src={src} kind={kind} layout={layout}>
			{children}
		</VisualMediaFrame>
	);
	const composited = <ClipCompositingFrame layout={layout}>{cropped}</ClipCompositingFrame>;
	const body = reveal ? (
		<RevealEffect reveal={reveal} clipFrames={clipFrames}>
			{composited}
		</RevealEffect>
	) : (
		composited
	);
	if (!layout) return body;
	return (
		<div
			style={{
				position: "absolute",
				lineHeight: 0,
				left: `${sampled.xPct}%`,
				top: `${sampled.yPct}%`,
				width: `${layout.widthPct ?? 100}%`,
				height: visualBoxHeight(layout),
				scale: sampled.scale === 1 ? undefined : sampled.scale,
				rotate: sampled.rotationDeg ? `${sampled.rotationDeg}deg` : undefined,
				opacity: sampled.opacity,
			}}
		>
			{body}
		</div>
	);
}
