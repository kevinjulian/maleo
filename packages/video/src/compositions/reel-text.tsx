/* Retained plain text, shape primitives and user compositions. */
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties, JSX, ReactNode } from "react";
import { createContext, useContext } from "react";
import type { TemplateParams } from "../schema";
import { evalColorTrack, evalTrack, type OverlayAnim } from "../lib/motion-keyframes";
import { sampleTextAnimation } from "../lib/text-animation";
import {
	compositionConfigSchema,
	compositionLayerTiming,
	retimeClipAnimation,
	PLAIN_TEXT_STYLE,
	shapeGeometry,
	shapePrimitiveOf,
	type ShapePrimitiveId,
	type Animation,
} from "@maleo/shared";

const TemplateBoxContext = createContext<{ width: number; height: number } | null>(null);

export type LayoutLike =
	| {
			xPct?: number;
			yPct?: number;
			widthPct?: number;
			heightPct?: number | null;
			fit?: "contain" | "cover" | "stretch";
			rotationDeg?: number;
			opacity?: number;
			/** Timeline text animation in clip-local seconds (keyframe-animation). */
			animation?: Animation;
	  }
	| null
	| undefined;

export type ClipTextRenderStyle = {
	fill?: string;
	background?: string;
	accent?: string;
	bodyFill?: string;
	fontFamily?: string;
	fontSize?: number;
	weight?: number;
	bgOpacity?: number;
	scale?: number;
	align?: "left" | "center" | "right";
	casing?: "none" | "upper";
	lineHeight?: number;
	letterSpacing?: number;
};

/** Plain text style shared by standalone clips and composition layers. */
export function plainTextCss(
	style: ClipTextRenderStyle | undefined,
	fgColor: string,
): CSSProperties {
	return style
		? {
				fontFamily: style.fontFamily,
				fontSize: style.fontSize,
				fontWeight: style.weight,
				color: style.fill,
				background:
					style.background && style.background !== "transparent" ? style.background : undefined,
				textAlign: style.align ?? "center",
				lineHeight: style.lineHeight ?? 1.1,
				letterSpacing: style.letterSpacing != null ? style.letterSpacing : undefined,
				padding: style.background && style.background !== "transparent" ? "12px 22px" : undefined,
				borderRadius: 12,
				textShadow: "0 4px 16px rgba(0,0,0,0.5)",
			}
		: { ...PLAIN_TEXT_STYLE, color: fgColor };
}

function PlainTextBody({
	content,
	style,
	fgColor,
}: {
	content: string;
	style?: ClipTextRenderStyle;
	fgColor: string;
}) {
	const align = style?.align ?? "center";
	return (
		<AbsoluteFill
			style={{
				display: "flex",
				alignItems: "center",
				justifyContent: align === "left" ? "flex-start" : align === "right" ? "flex-end" : "center",
			}}
		>
			<div style={plainTextCss(style, fgColor)}>
				{style?.casing === "upper" ? content.toUpperCase() : content}
			</div>
		</AbsoluteFill>
	);
}
type TemplateFrameChildren = ReactNode | ((style: ClipTextRenderStyle | undefined) => ReactNode);

// Apply a background alpha to any color. 0 → transparent, 1 → the color as-is,
// in between → mixed toward transparent so a motion clip can dial a translucent
// backdrop rather than only fully on/off.
function withAlpha(color: string, opacity: number): string {
	if (opacity >= 1) return color;
	if (opacity <= 0) return "transparent";
	return `color-mix(in srgb, ${color} ${Math.round(opacity * 100)}%, transparent)`;
}

// Positioned box for a motion template: the clip `layout` maps 1:1 to left/top/
// width/height (% of canvas), IDENTICAL to the editor's ClipBox, so the selection
// rectangle always frames the rendered content (WYSIWYG). The template fills this
// box; `scale` zooms the content INSIDE the box without changing the box itself.
function templateBoxStyle(
	style: ClipTextRenderStyle | undefined,
	zIndex: number,
	layout: LayoutLike,
	sampled?: { widthPct?: number; heightPct?: number; bgOpacity?: number },
): CSSProperties {
	const width = sampled?.widthPct ?? layout?.widthPct ?? 100;
	const hasHeight = sampled?.heightPct != null || layout?.heightPct != null;
	const height = sampled?.heightPct ?? layout?.heightPct ?? 100;
	const bgOpacity = sampled?.bgOpacity ?? style?.bgOpacity ?? 0;
	const background =
		style?.background && style.background !== "transparent" && bgOpacity > 0
			? withAlpha(style.background, bgOpacity)
			: undefined;
	return {
		position: "absolute",
		left: `${layout?.xPct ?? 0}%`,
		top: `${layout?.yPct ?? 0}%`,
		width: `${width}%`,
		height: hasHeight ? `${height}%` : "100%",
		zIndex,
		fontFamily: style?.fontFamily,
		rotate: layout?.rotationDeg ? `${layout.rotationDeg}deg` : undefined,
		opacity: layout?.opacity == null ? 1 : layout.opacity,
		background,
	};
}

// Frames a motion template inside its layout box. The template renders as an
// AbsoluteFill relative to THIS box (not the full canvas), so its internal
// centering lands in the selection rectangle. `scale` is a content-only zoom.
/* Samples per-property keyframe tracks at the current frame and applies them as
 * one transform. x/y are percent-of-frame offsets from the base layout; scale
 * multiplies; rotate is degrees; opacity 0..1. Identical math in preview and
 * export because both mount this component. */
function OverlayAnimBox({
	anim,
	frames,
	children,
}: {
	anim: OverlayAnim;
	frames: number;
	children: ReactNode;
}): JSX.Element {
	const frame = useCurrentFrame();
	const p = frames > 0 ? frame / frames : 1;
	const x = evalTrack(anim.tracks.x, p, 0);
	const y = evalTrack(anim.tracks.y, p, 0);
	const scale = evalTrack(anim.tracks.scale, p, 1);
	const rotate = evalTrack(anim.tracks.rotate, p, 0);
	const opacity = evalTrack(anim.tracks.opacity, p, 1);
	const blur = evalTrack(anim.tracks.blur, p, 0);
	return (
		<AbsoluteFill
			style={{
				transform: `translate(${x}%, ${y}%)${scale !== 1 ? ` scale(${scale})` : ""}${rotate ? ` rotate(${rotate}deg)` : ""}`,
				transformOrigin: "center",
				opacity,
				filter: blur > 0 ? `blur(${blur}px)` : undefined,
			}}
		>
			{children}
		</AbsoluteFill>
	);
}

type TemplateFrameProps = {
	style: ClipTextRenderStyle | undefined;
	zIndex: number;
	layout: LayoutLike;
	anim?: OverlayAnim | null;
	frames?: number;
	children: TemplateFrameChildren;
};

/** Timeline text: `layout.animation` sampled at frame / fps. Box properties move the
 *  whole box (background included); blur stays on the content. */
function KeyedTemplateFrame({
	style,
	zIndex,
	layout,
	animation,
	children,
}: TemplateFrameProps & { animation: Animation }): JSX.Element {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const canvas = useVideoConfig();
	const parent = useContext(TemplateBoxContext) ?? canvas;
	const {
		box,
		blur,
		style: animatedStyle,
	} = sampleTextAnimation(animation, layout, style, frame / fps);
	const s = style?.scale ?? 1;
	const sampledTextStyle: ClipTextRenderStyle | undefined = style
		? {
				...style,
				...animatedStyle,
				...(animation.tracks.bgOpacity ? { bgOpacity: box.bgOpacity } : {}),
			}
		: undefined;
	const sampledCss: CSSProperties = {
		...(sampledTextStyle?.fontSize ? { fontSize: sampledTextStyle.fontSize } : {}),
		...(sampledTextStyle?.letterSpacing != null
			? { letterSpacing: sampledTextStyle.letterSpacing }
			: {}),
		...(sampledTextStyle?.lineHeight != null ? { lineHeight: sampledTextStyle.lineHeight } : {}),
	};
	const bodyContent = typeof children === "function" ? children(sampledTextStyle) : children;
	const boxLayout = {
		...layout,
		xPct: box.xPct,
		yPct: box.yPct,
		rotationDeg: box.rotationDeg,
		opacity: box.opacity,
	};
	return (
		<TemplateBoxContext.Provider
			value={{
				width: (parent.width * box.widthPct) / 100,
				height: (parent.height * (box.heightPct ?? 100)) / 100,
			}}
		>
			<div
				style={{
					...templateBoxStyle(sampledTextStyle ?? style, zIndex, boxLayout, {
						widthPct: box.widthPct,
						heightPct: box.heightPct,
						bgOpacity: box.bgOpacity,
					}),
					scale: box.scale !== 1 ? box.scale : undefined,
				}}
			>
				<AbsoluteFill
					style={{
						transform: s !== 1 ? `scale(${s})` : undefined,
						transformOrigin: "center",
						filter: blur > 0 ? `blur(${blur}px)` : undefined,
						...sampledCss,
					}}
				>
					{bodyContent}
				</AbsoluteFill>
			</div>
		</TemplateBoxContext.Provider>
	);
}

export function TemplateFrame(props: TemplateFrameProps): JSX.Element {
	return props.layout?.animation ? (
		<KeyedTemplateFrame {...props} animation={props.layout.animation} />
	) : (
		<NormalizedTemplateFrame {...props} />
	);
}

/** Motion Studio preview layers and composition clips: normalized `anim` over `frames`. */
function NormalizedTemplateFrame({
	style,
	zIndex,
	layout,
	anim,
	frames,
	children,
}: TemplateFrameProps): JSX.Element {
	const frame = useCurrentFrame();
	const canvas = useVideoConfig();
	const parent = useContext(TemplateBoxContext) ?? canvas;
	const p = (frames ?? 1) > 0 ? frame / (frames ?? 1) : 1;
	const s = style?.scale ?? 1;
	const widthPct = evalTrack(anim?.tracks.width, p, layout?.widthPct ?? 100);
	const heightPct = evalTrack(anim?.tracks.height, p, layout?.heightPct ?? 100);
	const bgOpacity = evalTrack(anim?.tracks.bgOpacity, p, style?.bgOpacity ?? 0);
	const sampledTextStyle: ClipTextRenderStyle | undefined = style
		? {
				...style,
				...(anim?.tracks.bgOpacity ? { bgOpacity } : {}),
				...(anim?.tracks.fontSize
					? { fontSize: evalTrack(anim.tracks.fontSize, p, style.fontSize ?? 64) }
					: {}),
				...(anim?.tracks.letterSpacing
					? { letterSpacing: evalTrack(anim.tracks.letterSpacing, p, style.letterSpacing ?? 0) }
					: {}),
				...(anim?.tracks.lineHeight
					? { lineHeight: evalTrack(anim.tracks.lineHeight, p, style.lineHeight ?? 1.1) }
					: {}),
				...(anim?.colorTracks?.fill
					? { fill: evalColorTrack(anim.colorTracks.fill, p, style.fill ?? "#ffffff") }
					: {}),
				...(anim?.colorTracks?.bodyFill
					? {
							bodyFill: evalColorTrack(
								anim.colorTracks.bodyFill,
								p,
								style.bodyFill ?? style.fill ?? "#ffffff",
							),
						}
					: {}),
				...(anim?.colorTracks?.accent
					? { accent: evalColorTrack(anim.colorTracks.accent, p, style.accent ?? "#7C66FF") }
					: {}),
				...(anim?.colorTracks?.background
					? {
							background: evalColorTrack(
								anim.colorTracks.background,
								p,
								style.background ?? "#000000",
							),
						}
					: {}),
			}
		: undefined;
	const sampledCss: CSSProperties = {
		...(sampledTextStyle?.fontSize ? { fontSize: sampledTextStyle.fontSize } : {}),
		...(sampledTextStyle?.letterSpacing != null
			? { letterSpacing: sampledTextStyle.letterSpacing }
			: {}),
		...(sampledTextStyle?.lineHeight != null ? { lineHeight: sampledTextStyle.lineHeight } : {}),
	};
	const bodyContent = typeof children === "function" ? children(sampledTextStyle) : children;
	const body = (
		<AbsoluteFill
			style={{
				transform: s !== 1 ? `scale(${s})` : undefined,
				transformOrigin: "center",
				...sampledCss,
			}}
		>
			{bodyContent}
		</AbsoluteFill>
	);
	return (
		<TemplateBoxContext.Provider
			value={{ width: (parent.width * widthPct) / 100, height: (parent.height * heightPct) / 100 }}
		>
			<div
				style={templateBoxStyle(sampledTextStyle ?? style, zIndex, layout, {
					widthPct,
					heightPct,
					bgOpacity,
				})}
			>
				{anim &&
				(Object.keys(anim.tracks).length > 0 || Object.keys(anim.colorTracks ?? {}).length > 0) ? (
					<OverlayAnimBox anim={anim} frames={frames ?? 1}>
						{body}
					</OverlayAnimBox>
				) : (
					body
				)}
			</div>
		</TemplateBoxContext.Provider>
	);
}

export function paramStr(
	params: TemplateParams | undefined,
	key: string,
	fallback: string,
): string {
	const v = params?.[key];
	return typeof v === "string" ? v : fallback;
}
export function shapeNumber(
	params: TemplateParams | undefined,
	key: string,
	fallback: number,
): number {
	const raw = params?.[key];
	const value =
		typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() ? Number(raw) : NaN;
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}
export function ShapePrimitive({
	preset,
	params,
	accentColor,
}: {
	preset: ShapePrimitiveId;
	params?: TemplateParams;
	accentColor: string;
}): JSX.Element | null {
	const canvas = useVideoConfig();
	const box = useContext(TemplateBoxContext) ?? canvas;
	const fill = paramStr(params, "fill", "") || accentColor;
	const stroke = paramStr(params, "stroke", "");
	const strokeWidth = shapeNumber(params, "strokeWidth", 0);
	const opacity = Math.min(1, shapeNumber(params, "opacity", 1));
	const radius = shapeNumber(params, "radius", 0);
	// Preserve the existing CSS border rasterization for saved Rectangle/Circle clips.
	if (preset === "shape-rect" || preset === "shape-circle")
		return (
			<div
				style={{
					width: "100%",
					height: "100%",
					background: fill,
					opacity,
					borderRadius: preset === "shape-circle" ? "50%" : radius,
					border: stroke && strokeWidth > 0 ? `${strokeWidth}px solid ${stroke}` : undefined,
					boxSizing: "border-box",
				}}
			/>
		);
	if (box.width <= 0 || box.height <= 0) return null;
	const geometry = shapeGeometry(preset, box.width, box.height, stroke ? strokeWidth : 0);
	if (geometry.kind !== "polygon") throw new Error("Expected polygon primitive");
	return (
		<svg
			width="100%"
			height="100%"
			viewBox={`0 0 ${box.width} ${box.height}`}
			preserveAspectRatio="none"
			style={{ display: "block", opacity }}
		>
			<polygon
				points={geometry.points.map(([x, y]) => `${x},${y}`).join(" ")}
				fill={fill}
				stroke={stroke || "none"}
				strokeWidth={geometry.strokeWidth}
				strokeLinejoin="round"
			/>
		</svg>
	);
}

// ── Motion composition overlay ──
// A saved Motion Studio composition placed as ONE clip. Sub-overlays store
// timing relative to the authored span; rendering scales every start/duration
// (and therefore every keyframe, since keyframe t is normalized to its clip)
// by clipDur/spanSec — stretching the clip stretches the whole motion.
export function CompositionOverlay({
	config,
	frames,
	fps,
	zIndex,
	accentColor,
	fgColor,
}: {
	config: unknown;
	frames: number;
	fps: number;
	zIndex: number;
	accentColor: string;
	bgColor: string;
	fgColor: string;
}): JSX.Element {
	const parsed = compositionConfigSchema.parse(config);
	const scale = frames / fps / parsed.spanSec;
	return (
		<AbsoluteFill style={{ zIndex }}>
			{parsed.overlays.map((o, i) => {
				const { from, durationInFrames: dur } = compositionLayerTiming(
					o,
					parsed.spanSec,
					frames,
					fps,
				);
				const preset = o.preset;
				const shape = shapePrimitiveOf(preset);
				return (
					<Sequence key={i} from={from} durationInFrames={dur}>
						<TemplateFrame
							style={o.style}
							zIndex={(o.track ?? 0) + 1}
							layout={
								o.layout?.animation
									? { ...o.layout, animation: retimeClipAnimation(o.layout.animation, scale) }
									: o.layout
							}
							anim={o.anim}
							frames={dur}
						>
							{(sampledStyle) =>
								shape ? (
									<ShapePrimitive
										preset={shape.preset}
										params={o.params}
										accentColor={accentColor}
									/>
								) : (
									<PlainTextBody content={o.content} style={sampledStyle} fgColor={fgColor} />
								)
							}
						</TemplateFrame>
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
}
