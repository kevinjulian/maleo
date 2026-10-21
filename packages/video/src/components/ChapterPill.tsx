import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

export type Chapter = { label: string; startSec: number; endSec: number };

type Props = {
	chapters: Chapter[];
	accentColor: string;
	fgColor: string;
	bgColor: string;
	/** "pill" shows "2/5 · Label"; "minimal" shows only the counter. */
	variant?: "pill" | "minimal";
};

/** Retention device: a small top-left pill announcing where the viewer is in the
 *  story ("2/5 · The fracture"). Re-enters with a spring on every chapter change
 *  so the beat advance is felt. Renders nothing with fewer than two chapters —
 *  a counter over a single beat is noise, not orientation. */
export const ChapterPill: React.FC<Props> = ({
	chapters,
	accentColor,
	fgColor,
	bgColor,
	variant = "pill",
}) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	if (chapters.length < 2) return null;
	const t = frame / fps;
	const idx = chapters.findIndex((c) => t >= c.startSec && t < c.endSec);
	if (idx < 0) return null;
	const chapter = chapters[idx]!;
	const local = Math.max(0, frame - Math.floor(chapter.startSec * fps));
	const s = spring({ frame: local, fps, config: { damping: 16, stiffness: 160 } });
	const y = interpolate(s, [0, 1], [-18, 0]);
	const label = variant === "minimal" ? "" : (chapter.label || "").trim();
	return (
		<div
			style={{
				position: "absolute",
				top: "4.5%",
				left: "4%",
				display: "inline-flex",
				alignItems: "center",
				gap: 12,
				padding: "10px 22px",
				borderRadius: 999,
				background: `${bgColor}CC`,
				border: `2px solid ${accentColor}`,
				color: fgColor,
				fontFamily: "Inter, system-ui, sans-serif",
				fontWeight: 800,
				fontSize: 30,
				letterSpacing: "0.02em",
				translate: `0 ${y}px`,
				opacity: interpolate(s, [0, 1], [0, 1]),
				boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
			}}
		>
			<span style={{ color: accentColor }}>
				{idx + 1}/{chapters.length}
			</span>
			{label ? <span style={{ fontWeight: 700, opacity: 0.92 }}>{label}</span> : null}
		</div>
	);
};
