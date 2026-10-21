/* Maleo — StoryboardReel text/template renderers. Static caption presets
 * (title/subtitle/stat/quote…), the explainer/section motion cards, and the
 * full rve-* animated template family. All brand-palette aware so a clip with
 * no per-clip style overrides adopts the project accent/bg/fg. */
import {
	AbsoluteFill,
	Img,
	interpolate,
	Sequence,
	spring,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import type { CSSProperties, JSX, ReactNode } from "react";
import type { TemplateParams } from "../schema";
import { evalColorTrack, evalTrack, type OverlayAnim } from "../lib/motion-keyframes";
import { sampleTextAnimation } from "../lib/text-animation";
import { fieldOf, type Animation } from "@maleo/shared";

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
	lineHeight?: number;
	letterSpacing?: number;
};
type TemplateFrameChildren = ReactNode | ((style: ClipTextRenderStyle | undefined) => ReactNode);

export function textPresetStyle(preset?: string): CSSProperties {
	if (preset === "plain")
		return { fontSize: 64, fontWeight: 400, textAlign: "center", lineHeight: 1.2 };
	if (preset === "subtitle")
		return {
			fontSize: 48,
			fontWeight: 600,
			textShadow: "0 2px 8px rgba(0,0,0,0.6)",
			textAlign: "center",
		};
	if (preset === "lower-third")
		return {
			fontSize: 52,
			fontWeight: 700,
			background: "rgba(0,0,0,0.55)",
			padding: "14px 26px",
			borderRadius: 14,
		};
	// Text Director taxonomy — distinct treatments per on-screen text role.
	if (preset === "stat")
		return {
			fontSize: 160,
			fontWeight: 900,
			letterSpacing: "-0.02em",
			textShadow: "0 6px 24px rgba(0,0,0,0.7)",
			textAlign: "center",
			lineHeight: 0.95,
		};
	if (preset === "quote")
		return {
			fontSize: 64,
			fontWeight: 600,
			fontStyle: "italic",
			textShadow: "0 3px 12px rgba(0,0,0,0.6)",
			textAlign: "center",
			lineHeight: 1.25,
			padding: "0 60px",
		};
	if (preset === "location")
		return {
			fontSize: 40,
			fontWeight: 700,
			letterSpacing: "0.18em",
			textTransform: "uppercase",
			textShadow: "0 2px 8px rgba(0,0,0,0.7)",
			textAlign: "center",
		};
	if (preset === "timeline")
		return {
			fontSize: 56,
			fontWeight: 800,
			fontFamily: "monospace",
			letterSpacing: "0.06em",
			textShadow: "0 3px 12px rgba(0,0,0,0.65)",
			textAlign: "center",
		};
	if (preset === "chapter")
		return {
			fontSize: 110,
			fontWeight: 900,
			letterSpacing: "0.02em",
			textShadow: "0 5px 20px rgba(0,0,0,0.7)",
			textAlign: "center",
			lineHeight: 1.0,
		};
	return {
		fontSize: 92,
		fontWeight: 800,
		textShadow: "0 4px 16px rgba(0,0,0,0.65)",
		textAlign: "center",
		lineHeight: 1.05,
	};
}

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
	);
}

function resolveTextColors(
	style: ClipTextRenderStyle | undefined,
	fallback: { text: string; accent: string; background?: string; body?: string },
): ResolvedTextColors {
	// "transparent" is a real, honored value (lets the scene show through); only an
	// absent override falls back to the brand/scene background.
	const background =
		style?.background === "transparent"
			? "transparent"
			: (style?.background ?? fallback.background);
	return {
		text: style?.fill ?? fallback.text,
		accent: style?.accent ?? fallback.accent,
		background,
		body: style?.bodyFill ?? style?.fill ?? fallback.body ?? fallback.text,
	};
}

// Structured content params (see dashboard clip-templates/*.ts field schemas)
// take priority; the newline-joined `content` string is the legacy fallback
// for overlays saved before per-template fields existed.
/** The four colors a text card paints with, after a clip override is folded
 *  over the brand/scene fallback. `background` stays optional because "no
 *  background" and "transparent" are different answers; `body` does not,
 *  because it always resolves — to `text` when nothing overrides it. */
interface ResolvedTextColors {
	text: string;
	accent: string;
	background?: string;
	body: string;
}

export function paramStr(
	params: TemplateParams | undefined,
	key: string,
	fallback: string,
): string {
	const v = params?.[key];
	return typeof v === "string" ? v : fallback;
}
function paramNum(params: TemplateParams | undefined, key: string, fallback: number): number {
	const v = params?.[key];
	return typeof v === "number" && Number.isFinite(v) ? v : fallback;
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
function paramRows(
	params: TemplateParams | undefined,
	key: string,
): Array<{ role: string; name: string }> | undefined {
	const v = params?.[key];
	if (!Array.isArray(v)) return undefined;
	const rows = v.filter(
		(r): r is { role: string; name: string } =>
			Boolean(r) &&
			typeof r === "object" &&
			typeof fieldOf(r, "role") === "string" &&
			typeof fieldOf(r, "name") === "string",
	);
	return rows.length ? rows : undefined;
}

export function ExplainerTextCard({
	content,
	params,
	frames,
	accentColor,
	fgColor,
	bgColor,
	style,
}: {
	content: string;
	params?: TemplateParams;
	frames: number;
	accentColor: string;
	fgColor: string;
	bgColor: string;
	style?: ClipTextRenderStyle;
}): JSX.Element {
	const frame = useCurrentFrame();
	const inF = Math.min(14, Math.max(1, Math.floor(frames / 3)));
	const outF = Math.min(8, Math.max(1, Math.floor(frames / 3)));
	const p = Math.min(1, Math.max(0, frame / inF));
	const out = Math.min(1, Math.max(0, (frames - frame) / outF));
	const vis = Math.min(p, out);
	const [legacyPrimary = "", ...legacyRest] = content
		.split(/\n+/)
		.map((line) => line.trim())
		.filter(Boolean);
	const primary = paramStr(params, "claim", legacyPrimary);
	const secondary = paramStr(params, "analogy", legacyRest.join(" "));
	const colors = resolveTextColors(style, {
		text: fgColor,
		accent: accentColor,
		background: bgColor,
	});
	const cardBg =
		colors.background && colors.background !== "transparent" ? colors.background : bgColor;
	const surface = withAlpha(cardBg, style?.bgOpacity ?? 0);
	return (
		<AbsoluteFill
			style={{
				justifyContent: "flex-end",
				alignItems: "center",
				padding: "0 72px 108px",
				opacity: vis,
				translate: `0 ${(1 - p) * 26}px`,
			}}
		>
			<div
				style={{
					width: "100%",
					maxWidth: 900,
					padding: "28px 32px",
					borderRadius: 18,
					background: surface,
					border: "1px solid rgba(255,255,255,0.18)",
					boxShadow: "0 18px 60px rgba(0,0,0,0.38)",
					color: colors.text,
				}}
			>
				<div
					style={{
						fontSize: 26,
						fontWeight: 800,
						color: colors.accent,
						textTransform: "uppercase",
						letterSpacing: "0.08em",
						marginBottom: 12,
					}}
				>
					Reveal
				</div>
				{primary ? (
					<div
						style={{
							fontSize: primary.length > 48 ? 48 : 58,
							fontWeight: 900,
							lineHeight: 1.02,
							marginBottom: secondary ? 14 : 0,
							color: colors.text,
						}}
					>
						{primary}
					</div>
				) : null}
				{secondary ? (
					<div
						style={{
							fontSize: 32,
							fontWeight: 650,
							lineHeight: 1.16,
							opacity: 0.92,
							color: colors.body,
						}}
					>
						{secondary}
					</div>
				) : null}
				<div
					style={{
						marginTop: 18,
						height: 5,
						width: "100%",
						borderRadius: 99,
						background: "rgba(255,255,255,0.14)",
						overflow: "hidden",
					}}
				>
					<div
						style={{ width: `${Math.round(100 * p)}%`, height: "100%", background: colors.accent }}
					/>
				</div>
			</div>
		</AbsoluteFill>
	);
}

export function SectionTextCard({
	content,
	params,
	frames,
	accentColor,
	fgColor,
	bgColor,
	style,
}: {
	content: string;
	params?: TemplateParams;
	frames: number;
	accentColor: string;
	fgColor: string;
	bgColor: string;
	style?: ClipTextRenderStyle;
}): JSX.Element {
	const frame = useCurrentFrame();
	const inF = Math.min(16, Math.max(1, Math.floor(frames / 3)));
	const outF = Math.min(8, Math.max(1, Math.floor(frames / 3)));
	const p = Math.min(1, Math.max(0, frame / inF));
	const out = Math.min(1, Math.max(0, (frames - frame) / outF));
	const vis = Math.min(p, out);
	const question = paramStr(params, "question", content);
	const colors = resolveTextColors(style, {
		text: fgColor,
		accent: accentColor,
		background: bgColor,
	});
	const bgOpacity = style?.bgOpacity ?? 0;
	const bg = colors.background && colors.background !== "transparent" ? colors.background : bgColor;
	const cardBackground =
		bgOpacity <= 0
			? "transparent"
			: bg.includes("gradient(")
				? bg
				: `linear-gradient(135deg, ${withAlpha(bg, bgOpacity)} 0%, ${withAlpha("#ffffff", bgOpacity * 0.1)} 100%)`;
	return (
		<AbsoluteFill style={{ opacity: vis, background: cardBackground, overflow: "hidden" }}>
			<div
				style={{
					position: "absolute",
					left: 84,
					right: 84,
					top: "42%",
					translate: `${(1 - p) * 80}px 0`,
					color: colors.text,
				}}
			>
				<div
					style={{
						fontSize: 24,
						fontWeight: 900,
						textTransform: "uppercase",
						letterSpacing: "0.12em",
						color: colors.accent,
						marginBottom: 16,
					}}
				>
					Question
				</div>
				<div
					style={{
						fontSize: question.length > 42 ? 56 : 70,
						fontWeight: 950,
						lineHeight: 0.98,
						maxWidth: 820,
					}}
				>
					{question}
				</div>
				<div
					style={{
						marginTop: 26,
						height: 8,
						width: `${Math.round(72 * p)}%`,
						maxWidth: 560,
						borderRadius: 99,
						background: colors.accent,
					}}
				/>
			</div>
			<div
				style={{
					position: "absolute",
					left: 0,
					right: 0,
					bottom: 88,
					height: 2,
					background: "rgba(255,255,255,0.14)",
				}}
			/>
			<div
				style={{
					position: "absolute",
					left: `${Math.round(8 + 72 * p)}%`,
					bottom: 76,
					width: 24,
					height: 24,
					borderRadius: 99,
					background: colors.accent,
				}}
			/>
		</AbsoluteFill>
	);
}

function lines(content: string): string[] {
	return content
		.split(/\n+/)
		.map((x) => x.trim())
		.filter(Boolean);
}

export function RveTemplateText({
	preset,
	content,
	params,
	frames,
	style,
	accentColor,
	bgColor,
	fgColor,
}: {
	preset?: string;
	content: string;
	params?: TemplateParams;
	frames: number;
	style?: ClipTextRenderStyle;
	accentColor: string;
	bgColor: string;
	fgColor: string;
}): JSX.Element | null {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	if (!preset || !(preset.startsWith("rve-") || preset.startsWith("shape-"))) return null;
	// Legacy fallback: overlays saved before per-template `params` existed still
	// carry their fields packed into `content` as newline-joined positional lines.
	const legacy = lines(content);
	const get = (key: string, idx: number, fallback: string): string =>
		paramStr(params, key, legacy[idx] || fallback);
	const p = Math.min(1, Math.max(0, frame / Math.max(1, Math.min(frames, 30))));
	const titleIn = spring({ frame, fps, from: 50, to: 0, config: { damping: 12, stiffness: 80 } });
	// Brand palette is the fallback: a template with no per-clip style overrides
	// adopts the project's accent/bg/fg so every motion template stays on-brand
	// (same rule the explainer/section cards already follow).
	// Text/accent follow the brand palette; the backdrop color also defaults to
	// brand but its visibility is governed by bgOpacity (default 0 = transparent,
	// so a fresh motion clip shows the scene through).
	const colors = resolveTextColors(style, {
		text: fgColor,
		accent: accentColor,
		background: bgColor,
		body: fgColor,
	});
	const purple = style?.bodyFill ?? accentColor;
	// Secondary tones derived from the resolved palette so a single color edit
	// restyles the whole template. The backdrop (solid or gradient) is alpha-mixed
	// by bgOpacity; derived tones always use the opaque base so they stay legible.
	const bgOpacity = style?.bgOpacity ?? 0;
	const baseBg =
		colors.background && colors.background !== "transparent" ? colors.background : bgColor;
	const rootBg = withAlpha(baseBg, bgOpacity);
	const bgDeep = `color-mix(in oklch, ${baseBg} 82%, black)`;
	const rootGrad = (deg: number): string =>
		bgOpacity <= 0
			? "transparent"
			: `linear-gradient(${deg}deg, ${withAlpha(baseBg, bgOpacity)} 0%, ${withAlpha(bgDeep, bgOpacity)} 100%)`;
	const trackTone = `color-mix(in oklch, ${baseBg} 68%, white)`;
	const dimText = `color-mix(in oklch, ${colors.text} 55%, transparent)`;
	// Shape primitives (Motion Studio building blocks). Static bodies — motion
	// comes from overlay keyframes, not baked-in springs. Params over brand:
	// fill defaults to the accent so a bare shape still lands on-brand.
	if (preset === "shape-rect" || preset === "shape-circle") {
		const fill = paramStr(params, "fill", "") || accentColor;
		const stroke = paramStr(params, "stroke", "");
		const strokeWidth = shapeNumber(params, "strokeWidth", 0);
		const opacity = Math.min(1, shapeNumber(params, "opacity", 1));
		const radius = shapeNumber(params, "radius", 0);
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
	}
	if (preset === "rve-cinematic-title-intro") {
		const title = get("title", 0, "Your Story Begins");
		const subtitle = get("subtitle", 1, "A Cinematic Experience");
		const underlineWidth = interpolate(frame, [25, 50], [0, 320], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		const subOpacity = interpolate(frame, [40, 60], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		return (
			<AbsoluteFill
				style={{ background: rootGrad(135), justifyContent: "center", alignItems: "center" }}
			>
				<h1
					style={{
						color: colors.text,
						fontSize: "4rem",
						fontWeight: "bold",
						margin: 0,
						transform: `translateY(${titleIn}px)`,
						opacity: p,
					}}
				>
					{title}
				</h1>
				<div
					style={{
						width: underlineWidth,
						height: 4,
						marginTop: 18,
						background: `linear-gradient(90deg, ${colors.accent}, ${purple})`,
						borderRadius: 2,
					}}
				/>
				<p
					style={{
						color: colors.body,
						fontSize: "1.5rem",
						fontWeight: 300,
						marginTop: 18,
						opacity: subOpacity,
					}}
				>
					{subtitle}
				</p>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-lower-third") {
		const name = get("name", 0, "John Smith");
		const role = get("role", 1, "Senior Producer");
		const x = spring({ frame, fps, from: -480, to: 0, config: { damping: 12, stiffness: 80 } });
		const tx = spring({
			frame: Math.max(frame - 10, 0),
			fps,
			config: { damping: 14, stiffness: 80 },
		});
		return (
			<AbsoluteFill style={{ background: rootGrad(180) }}>
				<div
					style={{
						position: "absolute",
						left: 48,
						bottom: 70,
						transform: `translateX(${x}px)`,
						display: "flex",
						alignItems: "stretch",
					}}
				>
					<div style={{ width: 8, background: colors.accent, borderRadius: "2px 0 0 2px" }} />
					<div
						style={{
							background:
								style?.background && style.background !== "transparent"
									? style.background
									: "rgba(0, 0, 0, 0.7)",
							borderRadius: "0 4px 4px 0",
							padding: "16px 30px",
							borderTop: `3px solid ${colors.accent}`,
						}}
					>
						<div
							style={{ color: colors.text, fontSize: "1.6rem", fontWeight: "bold", opacity: tx }}
						>
							{name}
						</div>
						<div
							style={{
								color: colors.body,
								fontSize: "1rem",
								fontWeight: 300,
								marginTop: 4,
								opacity: tx,
							}}
						>
							{role}
						</div>
					</div>
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-end-card") {
		const title = get("title", 0, "Thanks for Watching");
		const cta = get("cta", 1, "Subscribe for More");
		const studio = get("studio", 2, "STUDIO CREATIVE");
		const glowOpacity = interpolate(Math.sin(frame / 18), [-1, 1], [0.3, 0.7]);
		const ctaSpring = spring({
			frame: Math.max(frame - 20, 0),
			fps,
			config: { damping: 12, stiffness: 80 },
		});
		const dots = spring({
			frame: Math.max(frame - 30, 0),
			fps,
			config: { damping: 12, stiffness: 80 },
		});
		return (
			<AbsoluteFill
				style={{ background: rootGrad(135), justifyContent: "center", alignItems: "center" }}
			>
				<div
					style={{
						padding: 48,
						borderRadius: 16,
						border: `2px solid ${colors.accent}`,
						background:
							style?.background && style.background !== "transparent"
								? style.background
								: "rgba(17, 24, 39, 0.8)",
						boxShadow: `0 0 40px rgba(67, 97, 238, ${0.3 * glowOpacity})`,
						textAlign: "center",
					}}
				>
					<h1 style={{ color: colors.text, fontSize: "3.5rem", fontWeight: "bold", margin: 0 }}>
						{title}
					</h1>
					<div
						style={{
							opacity: ctaSpring,
							marginTop: 32,
							padding: "14px 40px",
							background: `linear-gradient(90deg, ${colors.accent}, ${purple})`,
							borderRadius: 8,
							display: "inline-block",
						}}
					>
						<span
							style={{
								color: colors.text,
								fontSize: "1.2rem",
								fontWeight: 600,
								letterSpacing: "0.05em",
							}}
						>
							{cta}
						</span>
					</div>
					<div
						style={{
							display: "flex",
							gap: 16,
							justifyContent: "center",
							marginTop: 32,
							opacity: dots,
						}}
					>
						{[colors.accent, purple, colors.accent, purple].map((color, i) => (
							<div
								key={i}
								style={{ width: 40, height: 40, borderRadius: "50%", background: color }}
							/>
						))}
					</div>
					<p
						style={{
							color: colors.body,
							fontSize: "0.9rem",
							marginTop: 28,
							letterSpacing: "0.1em",
							fontWeight: 300,
						}}
					>
						{studio}
					</p>
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-chapter-title") {
		const number = get("number", 0, "1");
		const label = get("label", 1, "The Beginning");
		const subOpacity = interpolate(frame, [20, 40], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		return (
			<AbsoluteFill
				style={{ backgroundColor: rootBg, justifyContent: "center", alignItems: "center" }}
			>
				<div
					style={{
						color: colors.body,
						fontSize: "1rem",
						fontWeight: 500,
						letterSpacing: "0.3em",
						marginBottom: 12,
					}}
				>
					CHAPTER
				</div>
				<div style={{ color: colors.text, fontSize: "8rem", fontWeight: 800, lineHeight: 1 }}>
					{number}
				</div>
				<div style={{ display: "flex", gap: 10, margin: "14px 0" }}>
					<span style={{ width: 80, height: 2, backgroundColor: colors.accent }} />
					<span
						style={{ width: 5, height: 5, borderRadius: "50%", backgroundColor: colors.accent }}
					/>
					<span style={{ width: 80, height: 2, backgroundColor: colors.accent }} />
				</div>
				<div
					style={{ color: colors.body, fontSize: "1.5rem", fontWeight: 300, opacity: subOpacity }}
				>
					{label}
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-quote-card") {
		const quote = get("quote", 0, "Design is not just what it looks like. Design is how it works.");
		const author = get("author", 1, "Steve Jobs");
		const textOpacity = interpolate(frame, [10, 30], [0, 1], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		return (
			<AbsoluteFill
				style={{
					backgroundColor: rootBg,
					justifyContent: "center",
					alignItems: "center",
					textAlign: "center",
					padding: "0 160px",
				}}
			>
				<div style={{ color: colors.accent, fontSize: "6rem", fontWeight: 700, lineHeight: 0.8 }}>
					“
				</div>
				<div
					style={{
						color: colors.text,
						fontSize: "1.8rem",
						fontWeight: 400,
						fontFamily: "Georgia, serif",
						fontStyle: "italic",
						lineHeight: 1.35,
						opacity: textOpacity,
					}}
				>
					{quote}
				</div>
				<div style={{ color: colors.body, fontSize: "1.1rem", fontWeight: 500, marginTop: 28 }}>
					— {author}
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-credits-roll") {
		const structuredRows = paramRows(params, "rows");
		const rows = structuredRows?.length
			? structuredRows.flatMap((r) => [r.role, r.name])
			: legacy.length >= 2
				? legacy
				: ["DIRECTOR", "Jane Smith", "PRODUCER", "John Doe", "EDITOR", "Maleo Studio"];
		const y = interpolate(frame, [0, Math.max(frames - 1, 1)], [420, -420], {
			extrapolateLeft: "clamp",
			extrapolateRight: "clamp",
		});
		return (
			<AbsoluteFill
				style={{
					backgroundColor: rootBg,
					justifyContent: "center",
					alignItems: "center",
					overflow: "hidden",
				}}
			>
				<div
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						height: 150,
						background: `linear-gradient(180deg, ${colors.background ?? "#111827"} 0%, rgba(17, 24, 39, 0) 100%)`,
						zIndex: 2,
					}}
				/>
				<div
					style={{
						position: "absolute",
						bottom: 0,
						left: 0,
						right: 0,
						height: 150,
						background: `linear-gradient(0deg, ${colors.background ?? "#111827"} 0%, rgba(17, 24, 39, 0) 100%)`,
						zIndex: 2,
					}}
				/>
				<div style={{ transform: `translateY(${y}px)`, textAlign: "center" }}>
					{rows.map((line, i) => {
						const isRole = i % 2 === 0;
						return (
							<div
								key={`${line}-${i}`}
								style={{
									color: isRole ? colors.accent : colors.text,
									fontSize: isRole ? "0.9rem" : "1.5rem",
									fontWeight: isRole ? 700 : 600,
									letterSpacing: isRole ? "0.18em" : "0.02em",
									textTransform: isRole ? "uppercase" : "none",
									marginTop: isRole ? 34 : 8,
									opacity: isRole ? 0.95 : 1,
								}}
							>
								{line}
							</div>
						);
					})}
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-countdown-intro") {
		const seconds = paramNum(params, "seconds", 3);
		const count = Math.max(seconds - Math.floor(frame / fps), 0);
		const done = frame >= seconds * fps;
		const prog = done ? 1 : (frame % fps) / fps;
		const circumference = 2 * Math.PI * 70;
		return (
			<AbsoluteFill
				style={{ backgroundColor: rootBg, justifyContent: "center", alignItems: "center" }}
			>
				<div style={{ position: "relative", width: 180, height: 180 }}>
					<svg width={180} height={180} style={{ transform: "rotate(-90deg)" }}>
						<circle cx={90} cy={90} r={70} fill="none" stroke={trackTone} strokeWidth={6} />
						{!done ? (
							<circle
								cx={90}
								cy={90}
								r={70}
								fill="none"
								stroke={colors.accent}
								strokeWidth={6}
								strokeDasharray={circumference}
								strokeDashoffset={circumference * (1 - prog)}
								strokeLinecap="round"
							/>
						) : null}
					</svg>
					<span
						style={{
							position: "absolute",
							inset: 0,
							display: "flex",
							alignItems: "center",
							justifyContent: "center",
							color: done ? colors.accent : colors.text,
							fontSize: done ? "3.5rem" : "4rem",
							fontWeight: done ? 800 : 700,
						}}
					>
						{done ? "GO!" : count}
					</span>
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-title-split") {
		const text = get("text", 0, "REVEALED");
		const top = spring({ frame, fps, from: -120, to: 0, config: { damping: 14, stiffness: 80 } });
		const bot = spring({ frame, fps, from: 120, to: 0, config: { damping: 14, stiffness: 80 } });
		return (
			<AbsoluteFill
				style={{ backgroundColor: rootBg, justifyContent: "center", alignItems: "center" }}
			>
				<h1
					style={{
						color: "transparent",
						fontSize: "5rem",
						fontWeight: 800,
						margin: 0,
						letterSpacing: "0.15em",
						WebkitTextStroke: `2px ${colors.text}`,
						transform: `translateY(${top}px)`,
					}}
				>
					{text}
				</h1>
				<h1
					style={{
						color: colors.text,
						fontSize: "5rem",
						fontWeight: 800,
						margin: 0,
						letterSpacing: "0.15em",
						transform: `translateY(${bot}px)`,
					}}
				>
					{text}
				</h1>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-subscribe-reminder") {
		const label = get("label", 0, "Subscribe");
		const handle = get("handle", 1, "@CreativeStudio");
		const y = spring({
			frame: Math.max(frame - 10, 0),
			fps,
			from: 100,
			to: 0,
			config: { damping: 14, stiffness: 100 },
		});
		const beat = interpolate(Math.sin(frame * 0.15), [-1, 1], [1, 1.15]);
		return (
			<AbsoluteFill
				style={{ backgroundColor: rootBg, justifyContent: "center", alignItems: "center" }}
			>
				<span style={{ color: dimText, fontSize: "1.5rem" }}>Your Video Content</span>
				<div
					style={{
						position: "absolute",
						bottom: 24,
						right: 24,
						display: "flex",
						alignItems: "center",
						gap: "0.75rem",
						backgroundColor: "rgba(0, 0, 0, 0.75)",
						backdropFilter: "blur(8px)",
						padding: "0.6rem 1.2rem",
						borderRadius: "999px",
						transform: `translateY(${y}px)`,
						border: "1px solid rgba(255, 255, 255, 0.1)",
					}}
				>
					<div
						style={{
							width: 28,
							height: 28,
							borderRadius: "50%",
							backgroundColor: colors.accent,
							display: "flex",
							justifyContent: "center",
							alignItems: "center",
							transform: `scale(${beat})`,
						}}
					>
						<span style={{ color: colors.text, fontSize: "0.8rem" }}>🔔</span>
					</div>
					<div style={{ display: "flex", flexDirection: "column" }}>
						<span style={{ color: colors.text, fontSize: "0.85rem", fontWeight: 600 }}>
							{label}
						</span>
						<span style={{ color: colors.body, fontSize: "0.65rem" }}>{handle}</span>
					</div>
				</div>
			</AbsoluteFill>
		);
	}
	if (preset.includes("logo")) {
		const logoUrl =
			typeof params?.logoUrl === "string" && params.logoUrl ? params.logoUrl : undefined;
		const logoText = get("logoText", 0, "LOGO");
		const name = get("name", 1, preset === "rve-logo-typewriter" ? logoText : "Company Name");
		const tagline = get("tagline", 2, "Your tagline here");
		const spin =
			preset === "rve-logo-spin-reveal" ? `rotateY(${interpolate(p, [0, 1], [180, 0])}deg)` : "";
		const scale = spring({
			frame,
			fps,
			from: preset === "rve-logo-bounce-drop" ? 1.2 : 0.8,
			to: 1,
			config: { damping: 10, stiffness: 80 },
		});
		const blur =
			preset === "rve-logo-blur-reveal" ? `blur(${interpolate(p, [0, 1], [18, 0])}px)` : undefined;
		const glitch = preset === "rve-logo-glitch-reveal" ? Math.sin(frame / 4) * 6 : 0;
		const badgeRadius =
			preset === "rve-logo-spin-reveal" ||
			preset === "rve-logo-scale-rotate" ||
			preset === "rve-logo-typewriter"
				? "50%"
				: "24px";
		return (
			<AbsoluteFill
				style={{
					backgroundColor: rootBg,
					justifyContent: "center",
					alignItems: "center",
					overflow: "hidden",
					perspective: 900,
				}}
			>
				<div
					style={{
						width: 120,
						height: 120,
						borderRadius: badgeRadius,
						background: logoUrl
							? undefined
							: `linear-gradient(135deg, ${colors.accent}, ${purple})`,
						display: "flex",
						justifyContent: "center",
						alignItems: "center",
						overflow: "hidden",
						opacity: p,
						transform: `translate(${glitch}px, ${-glitch}px) scale(${scale}) ${spin} rotate(${preset === "rve-logo-scale-rotate" ? interpolate(p, [0, 1], [-180, 0]) : 0}deg)`,
						filter: blur,
						boxShadow: "0 0 40px rgba(67, 97, 238, 0.3)",
					}}
				>
					{logoUrl ? (
						<Img src={logoUrl} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
					) : (
						<span
							style={{
								color: colors.text,
								fontSize: "1.8rem",
								fontWeight: "800",
								letterSpacing: "0.1em",
							}}
						>
							{logoText.slice(0, 4)}
						</span>
					)}
				</div>
				<h2
					style={{
						color: colors.text,
						fontSize: "2rem",
						fontWeight: "700",
						marginTop: "1.5rem",
						marginBottom: 0,
						letterSpacing: "0.05em",
						opacity: p,
						transform: `translateY(${20 * (1 - p)}px)`,
					}}
				>
					{name}
				</h2>
				<p style={{ color: colors.body, fontSize: "1rem", marginTop: "0.5rem", opacity: p }}>
					{tagline}
				</p>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-floating-bubble-text") {
		const text = get("text", 0, "Floating");
		const float = Math.sin(frame / 30) * 20;
		const scale = spring({ frame, fps, from: 0, to: 1, config: { damping: 12, mass: 0.5 } });
		return (
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
				<div
					style={{
						transform: `translateY(${float}px) scale(${scale})`,
						fontSize: "4.5rem",
						fontWeight: "bold",
						color: colors.text,
						padding: "2rem 3.5rem",
						borderRadius: "24px",
						background: `linear-gradient(45deg, ${colors.background ?? "#1e3a8a"}, ${colors.accent})`,
						border: "3px solid transparent",
						boxShadow: "0 8px 32px rgba(30, 58, 138, 0.2)",
					}}
				>
					{text}
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-glitch-text") {
		const gi = Math.sin(frame / 10) * 10,
			rgb = Math.sin(frame / 5) * 5;
		const txt = get("text", 0, "GLITCH");
		return (
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: rootBg }}>
				<div
					style={{
						position: "relative",
						fontSize: "5rem",
						fontWeight: "bold",
						fontFamily: "monospace",
					}}
				>
					<div
						style={{
							position: "absolute",
							color: colors.accent,
							transform: `translate(${rgb}px, ${gi}px)`,
							mixBlendMode: "screen",
						}}
					>
						{txt}
					</div>
					<div
						style={{
							position: "absolute",
							color: purple,
							transform: `translate(${-rgb}px, ${-gi}px)`,
							mixBlendMode: "screen",
						}}
					>
						{txt}
					</div>
					<div style={{ color: colors.text, opacity: 0.8 }}>{txt}</div>
				</div>
			</AbsoluteFill>
		);
	}
	if (preset === "rve-typewriter-subtitle") {
		const txt = get("text", 0, "I like typing...");
		const count = Math.min(txt.length, Math.floor(frame / 3));
		return (
			<AbsoluteFill style={{ justifyContent: "center", alignItems: "center", background: rootBg }}>
				<div style={{ color: colors.text, fontSize: "3rem", fontWeight: "bold" }}>
					{txt.slice(0, count)}
					<span style={{ color: colors.accent }}>|</span>
				</div>
			</AbsoluteFill>
		);
	}
	const txt = get(
		"text",
		0,
		preset === "rve-popping-text"
			? "BINO!"
			: preset === "rve-bubble-pop-text"
				? "HELLO"
				: "Hello Remotion",
	);
	const palette = [colors.background ?? "#1e3a8a", colors.accent, colors.body];
	return (
		<AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
			<div style={{ display: "flex", gap: preset === "rve-bubble-pop-text" ? "0.5rem" : 0 }}>
				{txt.split("").map((ch, i) => {
					const delay = i * (preset === "rve-popping-text" ? 7 : 5);
					const s = spring({
						frame: frame - delay,
						fps,
						from: 0,
						to: 1,
						config: { mass: 0.4, damping: 8, stiffness: 100 },
					});
					if (preset === "rve-bubble-pop-text")
						return (
							<span
								key={i}
								style={{
									display: "inline-block",
									transform: `scale(${s})`,
									fontSize: "4rem",
									fontWeight: "bold",
									color: colors.text,
									border: "4px solid rgba(255, 255, 255, 0.2)",
									borderRadius: "50%",
									width: 100,
									height: 100,
									lineHeight: "92px",
									textAlign: "center",
									background: `linear-gradient(45deg, ${colors.background ?? "#1e3a8a"}, ${colors.accent})`,
									boxShadow: "0 4px 15px rgba(59, 130, 246, 0.5)",
								}}
							>
								{ch}
							</span>
						);
					return (
						<span
							key={i}
							style={{
								display: "inline-block",
								opacity: s,
								color: preset === "rve-popping-text" ? palette[i % palette.length] : colors.text,
								fontSize: preset === "rve-popping-text" ? "8rem" : "5rem",
								fontWeight: preset === "rve-popping-text" ? 900 : "bold",
								transform: `translateY(${(1 - s) * -50}px) scale(${preset === "rve-popping-text" ? s * 1.2 : 1})`,
								textShadow:
									preset === "rve-popping-text"
										? `0 0 12px ${palette[i % palette.length]}80, -2px -2px 0 ${colors.text}, 2px 2px 0 ${colors.text}`
										: undefined,
							}}
						>
							{ch === " " ? "\u00a0" : ch}
						</span>
					);
				})}
			</div>
		</AbsoluteFill>
	);
}

// ── Motion composition overlay ──
// A saved Motion Studio composition placed as ONE clip. Sub-overlays store
// timing relative to the authored span; rendering scales every start/duration
// (and therefore every keyframe, since keyframe t is normalized to its clip)
// by clipDur/spanSec — stretching the clip stretches the whole motion.
export type CompositionOverlayConfig = {
	spanSec?: number;
	overlays?: Array<{
		relStart?: number;
		dur?: number;
		preset?: string;
		content?: string;
		track?: number;
		params?: TemplateParams;
		style?: ClipTextRenderStyle;
		layout?: LayoutLike;
		anim?: OverlayAnim | null;
	}>;
};

export function CompositionOverlay({
	config,
	frames,
	fps,
	zIndex,
	accentColor,
	bgColor,
	fgColor,
}: {
	config: CompositionOverlayConfig;
	frames: number;
	fps: number;
	zIndex: number;
	accentColor: string;
	bgColor: string;
	fgColor: string;
}): JSX.Element {
	const span = Math.max(
		0.001,
		config.spanSec ??
			Math.max(...(config.overlays ?? []).map((o) => (o.relStart ?? 0) + (o.dur ?? 0)), 1),
	);
	const scale = frames / fps / span;
	return (
		<AbsoluteFill style={{ zIndex }}>
			{(config.overlays ?? []).map((o, i) => {
				const from = Math.max(0, Math.floor((o.relStart ?? 0) * scale * fps));
				const dur = Math.max(1, Math.floor((o.dur ?? span) * scale * fps));
				const preset = o.preset ?? "title";
				const isTemplate = preset.startsWith("rve-") || preset.startsWith("shape-");
				return (
					<Sequence key={i} from={from} durationInFrames={dur}>
						<TemplateFrame
							style={o.style}
							zIndex={(o.track ?? 0) + 1}
							layout={o.layout}
							anim={o.anim}
							frames={dur}
						>
							{(sampledStyle) =>
								isTemplate ? (
									<RveTemplateText
										preset={preset}
										content={o.content ?? ""}
										params={o.params}
										frames={dur}
										style={sampledStyle}
										accentColor={accentColor}
										bgColor={bgColor}
										fgColor={fgColor}
									/>
								) : (
									<AbsoluteFill style={{ justifyContent: "center", alignItems: "center" }}>
										<div
											style={{
												...textPresetStyle(preset),
												color: sampledStyle?.fill ?? fgColor,
												fontFamily: sampledStyle?.fontFamily,
												fontSize: sampledStyle?.fontSize,
											}}
										>
											{o.content ?? ""}
										</div>
									</AbsoluteFill>
								)
							}
						</TemplateFrame>
					</Sequence>
				);
			})}
		</AbsoluteFill>
	);
}
