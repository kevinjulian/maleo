import {
	AbsoluteFill,
	cancelRender,
	continueRender,
	delayRender,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import { useEffect, useRef, useState } from "react";
import type { CaptionCue } from "@maleo/shared";
import type { CaptionsConfig } from "../schema";

export interface RenderCaptionCue {
	id: string;
	startSec: number;
	durationSec: number;
	caption: CaptionCue;
}
type Props = {
	cues: RenderCaptionCue[];
	accentColor: string;
	fgColor: string;
	config?: CaptionsConfig | null;
	position?: "top" | "center" | "bottom";
};

export function captionActiveColor(
	config: CaptionsConfig | null | undefined,
	fallback: string,
): string {
	return config?.activeColor && config.activeColor !== "transparent"
		? config.activeColor
		: fallback;
}

/** Half-open intervals give a shared edge to the next cue. */
export function captionAt(
	cues: readonly RenderCaptionCue[],
	sec: number,
): RenderCaptionCue | undefined {
	return cues.find((cue) => sec >= cue.startSec && sec < cue.startSec + cue.durationSec);
}

function weightValue(weight?: string): number {
	if (weight === "Black") return 900;
	if (weight === "Bold") return 800;
	if (weight === "Medium") return 600;
	return 500;
}

function alphaColor(color: string, opacityPct = 100): string {
	if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
	return `rgba(${parseInt(color.slice(1, 3), 16)},${parseInt(color.slice(3, 5), 16)},${parseInt(color.slice(5, 7), 16)},${Math.max(0, Math.min(100, opacityPct)) / 100})`;
}

/** Align timed tokens to authored text without changing its spaces or line breaks. */
function textParts(cue: CaptionCue): Array<{ text: string; word: number | null }> {
	const out: Array<{ text: string; word: number | null }> = [];
	let cursor = 0;
	for (const [word, timing] of cue.words.entries()) {
		const start = cue.text.indexOf(timing.text, cursor);
		if (start < 0) return [{ text: cue.text, word: null }];
		if (start > cursor) out.push({ text: cue.text.slice(cursor, start), word: null });
		out.push({ text: timing.text, word });
		cursor = start + timing.text.length;
	}
	if (cursor < cue.text.length) out.push({ text: cue.text.slice(cursor), word: null });
	return out;
}

const Cue: React.FC<Omit<Props, "cues"> & { cue: RenderCaptionCue }> = ({
	cue,
	accentColor,
	fgColor,
	config,
	position,
}) => {
	const frame = useCurrentFrame();
	const { fps, width, height } = useVideoConfig();
	const localSec = frame / fps - cue.startSec;
	const style = { ...config, ...cue.caption.style };
	const fontFamily = `${style.fontFamily ?? "Inter"}, system-ui, sans-serif`;
	const weight = weightValue(style.weight);
	const configuredSize = style.fontSize ?? 56;
	const [fontSize, setFontSize] = useState(configuredSize);
	const box = useRef<HTMLDivElement>(null);
	const [handle] = useState(() => delayRender(`Caption font: ${cue.id}`));
	const maxWidth = (width * (style.maxWidth ?? 86)) / 100;
	useEffect(() => {
		let disposed = false;
		const measure = async () => {
			await document.fonts.load(
				`${style.italic ? "italic " : ""}${weight} ${configuredSize}px ${fontFamily}`,
				cue.caption.text,
			);
			await document.fonts.ready;
			if (disposed || !box.current) return;
			// Measure whole authored cue once; active word never affects wrapping or size.
			box.current.style.fontSize = `${configuredSize}px`;
			const bounds = box.current.getBoundingClientRect();
			const scale = Math.min(
				1,
				maxWidth / Math.max(1, box.current.scrollWidth),
				(height * 0.8) / Math.max(1, bounds.height),
			);
			box.current.style.fontSize = `${configuredSize * scale}px`;
			setFontSize(configuredSize * scale);
			continueRender(handle);
		};
		measure().catch((error) => {
			if (!disposed) cancelRender(error);
		});
		return () => {
			disposed = true;
			continueRender(handle);
		};
	}, [
		configuredSize,
		cue.caption.text,
		fontFamily,
		handle,
		height,
		maxWidth,
		style.italic,
		weight,
	]);
	let activeWord = -1;
	for (const [index, word] of cue.caption.words.entries()) {
		if (localSec >= word.startSec) activeWord = index;
		if (localSec >= word.startSec && localSec < word.endSec) break;
	}
	const entry = Math.min(1, Math.max(0, localSec / 0.16));
	const fill = style.fill ?? fgColor;
	const highlight = captionActiveColor(style, accentColor);
	const motion = style.motion ?? "None";
	const vertical =
		style.verticalPosition ?? (position === "top" ? 15 : position === "center" ? 50 : 88);
	const opacity = motion === "Fade" ? entry : 1;
	const shadowDistance = style.shadowDistance ?? 2;
	const angle = ((style.shadowAngle ?? 90) * Math.PI) / 180;
	const shadow =
		style.shadow && style.shadow !== "transparent"
			? `${Math.cos(angle) * shadowDistance}px ${Math.sin(angle) * shadowDistance}px ${style.shadowBlur ?? 12}px ${alphaColor(style.shadow, style.shadowOpacity)}`
			: undefined;
	return (
		<AbsoluteFill style={{ alignItems: "center", pointerEvents: "none" }}>
			<div
				data-caption-cue={cue.id}
				style={{
					position: "absolute",
					top: `${vertical}%`,
					translate: `0 calc(-100% + ${motion === "Slide Up" ? (1 - entry) * 24 : 0}px)`,
					opacity,
					scale: motion === "Pop" ? 0.9 + entry * 0.1 : 1,
					maxWidth,
					width: "max-content",
				}}
			>
				<div
					ref={box}
					style={{
						fontFamily,
						fontSize,
						fontWeight: weight,
						fontStyle: style.italic ? "italic" : "normal",
						lineHeight: 1.15,
						textAlign: "center",
						whiteSpace: "pre-wrap",
						overflowWrap: "anywhere",
						textShadow: shadow,
						color: fill,
						background: style.background,
						padding:
							style.background && style.background !== "transparent" ? "14px 24px" : undefined,
						WebkitTextStroke:
							style.stroke && style.stroke !== "transparent" ? `3px ${style.stroke}` : undefined,
					}}
				>
					{textParts(cue.caption).map((part, index) => {
						if (part.word === null)
							return <span key={index}>{style.allCaps ? part.text.toUpperCase() : part.text}</span>;
						const emphasized = part.word === activeWord;
						const typewriter = style.style === "Typewriter";
						const highlighted = style.style === "Karaoke" || style.style === "Word pop";
						return (
							<span
								key={index}
								data-caption-word={part.word}
								style={{ display: "inline-block", verticalAlign: "baseline" }}
							>
								<span
									style={{
										display: "inline-block",
										color: emphasized && highlighted ? highlight : fill,
										opacity: typewriter
											? part.word > activeWord
												? 0
												: 1
											: highlighted && !emphasized
												? Math.max(0, Math.min(100, style.inactiveOpacity ?? 55)) / 100
												: 1,
										scale: emphasized && style.style === "Word pop" ? 1.12 : 1,
									}}
								>
									{style.allCaps ? part.text.toUpperCase() : part.text}
								</span>
							</span>
						);
					})}
				</div>
			</div>
		</AbsoluteFill>
	);
};

export const Captions: React.FC<Props> = ({ cues, ...props }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	if (props.config?.enabled === false) return null;
	const cue = captionAt(cues, frame / fps);
	return cue && cue.caption.style?.enabled !== false && cue.caption.status !== "needs-refresh" ? (
		<Cue key={cue.id} cue={cue} {...props} />
	) : null;
};
