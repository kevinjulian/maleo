import { AbsoluteFill, useCurrentFrame, useVideoConfig } from "remotion";
import type { CSSProperties, JSX } from "react";
import type { VisualRevealData } from "../schema";

const DARK_PIXELS_FILTER_ID = "maleo-dark-pixels-alpha";
const DARK_PIXELS_FILTER_URL = `url(#${DARK_PIXELS_FILTER_ID})`;

export function effectiveRevealDurationFrames(
	reveal: VisualRevealData | undefined,
	clipFrames: number,
	fps: number,
): number {
	if (!reveal) return Math.max(1, clipFrames);
	const requested = reveal.durationSec == null ? clipFrames : Math.round(reveal.durationSec * fps);
	return Math.max(1, Math.min(Math.max(1, clipFrames), requested));
}

function revealProgress(
	reveal: VisualRevealData,
	frame: number,
	clipFrames: number,
	fps: number,
): number {
	const delayFrames = Math.max(0, Math.round((reveal.delaySec ?? 0) * fps));
	const durationFrames = effectiveRevealDurationFrames(reveal, clipFrames, fps);
	const raw = (frame - delayFrames) / durationFrames;
	const clamped = Math.max(0, Math.min(1, raw));
	return 1 - Math.pow(1 - clamped, 3);
}

function revealProgressAt(raw: number): number {
	const clamped = Math.max(0, Math.min(1, raw));
	return 1 - Math.pow(1 - clamped, 3);
}

function revealPhaseFrames(reveal: VisualRevealData, clipFrames: number, fps: number) {
	const delayFrames = Math.max(0, Math.round((reveal.delaySec ?? 0) * fps));
	const durationFrames = effectiveRevealDurationFrames(reveal, clipFrames, fps);
	return {
		delayFrames,
		durationFrames,
		splitFrames: Math.max(1, Math.round(durationFrames * 0.45)),
	};
}

function wipeClipPath(direction: VisualRevealData["direction"], progress: number): string {
	const hidden = (1 - progress) * 100;
	if (direction === "right") return `inset(0 0 0 ${hidden}%)`;
	if (direction === "top") return `inset(0 0 ${hidden}% 0)`;
	if (direction === "bottom") return `inset(${hidden}% 0 0 0)`;
	if (direction === "top_left_to_bottom_right")
		return `polygon(0 0, ${progress * 200}% 0, 0 ${progress * 200}%)`;
	if (direction === "draw_top_left_to_bottom_right") {
		const lead = progress * 200;
		return `polygon(0 0, ${lead}% 0, ${Math.max(0, lead - 34)}% 100%, 0 100%)`;
	}
	if (direction === "center") return `circle(${Math.max(1, progress * 75)}% at 50% 50%)`;
	return `inset(0 ${hidden}% 0 0)`;
}

function appendFilter(style: CSSProperties, filter: string): CSSProperties {
	return { ...style, filter: [style.filter, filter].filter(Boolean).join(" ") };
}

export function revealTextureStyle(
	reveal: VisualRevealData | undefined,
): CSSProperties | undefined {
	if (!reveal || reveal.texture == null || reveal.texture === "clean") return undefined;
	if (reveal.texture === "paper") {
		return {
			maskImage:
				"repeating-linear-gradient(135deg, #000 0 10px, rgba(0,0,0,0.82) 10px 12px, #000 12px 20px)",
			maskSize: "34px 34px",
		};
	}
	if (reveal.texture === "dust") {
		return {
			maskImage:
				"repeating-radial-gradient(circle at 0 0, #000 0 2px, rgba(0,0,0,0.68) 2px 3px, #000 3px 10px)",
			maskSize: "22px 22px",
		};
	}
	if (reveal.texture === "glitch") {
		return {
			filter: "drop-shadow(2px 0 rgba(0,255,255,0.22)) drop-shadow(-2px 0 rgba(255,0,120,0.18))",
		};
	}
	return { filter: "contrast(1.08) drop-shadow(0 0 2px rgba(0,0,0,0.28))" };
}

function revealClipStyleAtProgress(reveal: VisualRevealData, progress: number): CSSProperties {
	const p = Math.max(0, Math.min(1, progress));
	const intensity = reveal.intensity == null ? 1 : Math.max(0, Math.min(1, reveal.intensity));
	const texture = revealTextureStyle(reveal);
	const withTexture = (style: CSSProperties): CSSProperties => {
		if (!texture) return style;
		const { filter, ...rest } = texture;
		return filter ? appendFilter({ ...style, ...rest }, String(filter)) : { ...style, ...rest };
	};
	if (reveal.type === "fade") return withTexture({ opacity: p });
	if (reveal.type === "spotlight")
		return withTexture({
			clipPath: wipeClipPath("center", p),
			opacity: Math.min(1, 0.2 + p * (0.8 + intensity * 0.2)),
		});
	if (reveal.type === "sketch_draw") {
		return withTexture({
			clipPath: wipeClipPath(reveal.direction ?? "left", p),
			filter: `contrast(${1 + (1 - p) * intensity * 0.8}) saturate(${0.7 + p * 0.3})`,
			opacity: Math.min(1, 0.15 + p * 0.85),
		});
	}
	return withTexture({ clipPath: wipeClipPath(reveal.direction ?? "left", p) });
}

export function revealClipStyle(
	reveal: VisualRevealData | undefined,
	frame: number,
	clipFrames: number,
	fps: number,
): CSSProperties | undefined {
	if (!reveal) return undefined;
	return revealClipStyleAtProgress(reveal, revealProgress(reveal, frame, clipFrames, fps));
}

export function revealColorPhaseStyle(
	reveal: VisualRevealData | undefined,
	frame: number,
	clipFrames: number,
	fps: number,
): CSSProperties | undefined {
	if (!reveal) return undefined;
	if (reveal.phase !== "dark_pixels_first" && reveal.phase !== "black_then_color")
		return revealClipStyle(reveal, frame, clipFrames, fps);
	const { delayFrames, durationFrames, splitFrames } = revealPhaseFrames(reveal, clipFrames, fps);
	const raw = (frame - delayFrames - splitFrames) / Math.max(1, durationFrames - splitFrames);
	return revealClipStyleAtProgress(reveal, revealProgressAt(raw));
}

export function revealDarkPhaseStyle(
	reveal: VisualRevealData | undefined,
	frame: number,
	clipFrames: number,
	fps: number,
): CSSProperties | undefined {
	if (!reveal) return undefined;
	if (reveal.phase !== "black_then_color") return revealClipStyle(reveal, frame, clipFrames, fps);
	const texture = revealTextureStyle(reveal);
	if (reveal.blackDirection === "none") return texture;
	const { delayFrames, splitFrames } = revealPhaseFrames(reveal, clipFrames, fps);
	const hidden = (1 - revealProgressAt((frame - delayFrames) / splitFrames)) * 100;
	const direction = reveal.blackDirection ?? "right";
	const transform =
		direction === "left"
			? `translateX(-${hidden}%)`
			: direction === "top"
				? `translateY(-${hidden}%)`
				: direction === "bottom"
					? `translateY(${hidden}%)`
					: `translateX(${hidden}%)`;
	return mergeLayerStyles({ transform }, texture);
}

function revealColorProgress(
	reveal: VisualRevealData,
	frame: number,
	clipFrames: number,
	fps: number,
): number {
	if (reveal.phase !== "dark_pixels_first" && reveal.phase !== "black_then_color")
		return revealProgress(reveal, frame, clipFrames, fps);
	const { delayFrames, durationFrames, splitFrames } = revealPhaseFrames(reveal, clipFrames, fps);
	return revealProgressAt(
		(frame - delayFrames - splitFrames) / Math.max(1, durationFrames - splitFrames),
	);
}

export function revealColorBuildStyle(
	reveal: VisualRevealData | undefined,
	frame: number,
	clipFrames: number,
	fps: number,
): CSSProperties | undefined {
	if (!reveal || reveal.colorBuild == null || reveal.colorBuild === "none") return undefined;
	const p = revealColorProgress(reveal, frame, clipFrames, fps);
	return { filter: `saturate(${0.35 + p * 0.65}) contrast(${0.92 + p * 0.08})` };
}

function mergeLayerStyles(...styles: Array<CSSProperties | undefined>): CSSProperties | undefined {
	const out: CSSProperties = {};
	let has = false;
	const filters: string[] = [];
	for (const style of styles) {
		if (!style) continue;
		has = true;
		const { filter, ...rest } = style;
		Object.assign(out, rest);
		if (filter) filters.push(String(filter));
	}
	if (filters.length) out.filter = filters.join(" ");
	return has ? out : undefined;
}

export function RevealEffect({
	reveal,
	clipFrames,
	children,
}: {
	reveal?: VisualRevealData;
	clipFrames: number;
	children: JSX.Element;
}): JSX.Element {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	const style = revealClipStyle(reveal, frame, clipFrames, fps);
	const colorBuildStyle = revealColorBuildStyle(reveal, frame, clipFrames, fps);
	if (reveal?.phase === "dark_pixels_first" || reveal?.phase === "black_then_color") {
		const colorStyle = revealColorPhaseStyle(reveal, frame, clipFrames, fps);
		const darkStyle =
			reveal.phase === "black_then_color"
				? revealDarkPhaseStyle(reveal, frame, clipFrames, fps)
				: style;
		return (
			<AbsoluteFill>
				<svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true">
					<filter id={DARK_PIXELS_FILTER_ID} colorInterpolationFilters="sRGB">
						<feColorMatrix
							type="matrix"
							values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  -1.181 -3.973 -0.402 0 2.777"
						/>
					</filter>
				</svg>
				<AbsoluteFill style={darkStyle}>
					<AbsoluteFill style={{ filter: DARK_PIXELS_FILTER_URL }}>{children}</AbsoluteFill>
				</AbsoluteFill>
				<AbsoluteFill style={mergeLayerStyles(colorStyle, colorBuildStyle)}>
					{children}
				</AbsoluteFill>
			</AbsoluteFill>
		);
	}
	return <AbsoluteFill style={mergeLayerStyles(style, colorBuildStyle)}>{children}</AbsoluteFill>;
}
