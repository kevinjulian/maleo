import type { CSSProperties, JSX } from "react";
import { useId } from "react";
import {
	AbsoluteFill,
	Audio,
	Sequence,
	interpolate,
	useCurrentFrame,
	useVideoConfig,
} from "remotion";
import type { InfographicOverlayData, InfographicPayload, InfographicStyleData } from "../schema";

function clamp01(v: number): number {
	return Math.max(0, Math.min(1, v));
}

function easeOut(t: number): number {
	return 1 - Math.pow(1 - clamp01(t), 3);
}

function safeNumber(raw: string): { prefix: string; value: number; suffix: string } | null {
	// Comma-grouped digits ("2,300", "$1,299") parse as one number; callers
	// re-format with toLocaleString so the grouping comes back on render.
	const match = raw.match(/^([^0-9.-]*)(-?[0-9][0-9,]*(?:\.[0-9]+)?)(.*)$/);
	if (!match) return null;
	const value = Number((match[2] ?? "").replace(/,/g, ""));
	if (!Number.isFinite(value)) return null;
	return { prefix: match[1] ?? "", value, suffix: match[3] ?? "" };
}

function useClipProgress(durationInFrames: number, revealDelayFrames = 0) {
	const frame = useCurrentFrame();
	const enterFrames = Math.max(8, Math.min(18, Math.floor(durationInFrames * 0.2)));
	const exitFrames = Math.max(6, Math.min(14, Math.floor(durationInFrames * 0.16)));
	// Main build waits for the reveal point (word-timed stats): panel enters at the
	// clip edge, the count/build holds at 0 until revealDelayFrames have passed.
	const buildFrame = Math.max(0, frame - revealDelayFrames);
	const buildSpan = Math.max(1, durationInFrames - exitFrames - revealDelayFrames);
	return {
		enter: easeOut(frame / enterFrames),
		main: easeOut(buildFrame / buildSpan),
		mainLinear: clamp01(buildFrame / buildSpan),
		exit: clamp01((durationInFrames - frame) / exitFrames),
	};
}

function shellStyle(block: InfographicOverlayData, fgColor: string): CSSProperties {
	const l = block.layout;
	return {
		position: "absolute",
		left: `${l?.xPct ?? 8}%`,
		top: `${l?.yPct ?? 12}%`,
		width: `${l?.widthPct ?? 84}%`,
		height: l?.heightPct == null ? "auto" : `${l.heightPct}%`,
		rotate: l?.rotationDeg ? `${l.rotationDeg}deg` : undefined,
		color: fgColor,
		fontFamily: "Inter, sans-serif",
	};
}

function entranceStyle(block: InfographicOverlayData, enter: number, exit: number): CSSProperties {
	const mode = block.animation?.in ?? "fade";
	const opacity = (block.layout?.opacity ?? 1) * Math.min(enter, exit);
	if (mode === "slide_up") return { opacity, translate: `0 ${(1 - enter) * 34}px` };
	if (mode === "scale") return { opacity, scale: 0.94 + enter * 0.06 };
	return { opacity };
}

function hexToRgba(hex: string, opacity: number): string {
	const h = hex.replace("#", "");
	const r = parseInt(h.slice(0, 2), 16) || 8;
	const g = parseInt(h.slice(2, 4), 16) || 10;
	const b = parseInt(h.slice(4, 6), 16) || 16;
	return `rgba(${r},${g},${b},${opacity})`;
}

function panelStyle(payload: InfographicPayload, style?: InfographicStyleData): CSSProperties {
	const bgColor = style?.bgColor ?? "#080a10";
	const bgOpacity = style?.bgOpacity ?? 0.72;
	const borderColor = style?.borderColor ?? "#ffffff";
	const borderOpacity = style?.borderOpacity ?? 0.18;
	const borderRadius = style?.borderRadius ?? 8;
	const blur = style?.blur ?? 10;
	return {
		padding: payload.type === "stat_reveal" ? "34px 38px" : "28px 32px",
		borderRadius,
		background: `linear-gradient(135deg, ${hexToRgba(bgColor, Math.min(1, bgOpacity + 0.1))}, ${hexToRgba(bgColor, bgOpacity)})`,
		border: `1px solid ${hexToRgba(borderColor, borderOpacity)}`,
		boxShadow: "0 18px 46px rgba(0,0,0,0.38)",
		backdropFilter: `blur(${blur}px)`,
	};
}

function StatReveal({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "stat_reveal" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const parsed = safeNumber(payload.value);
	const value = parsed
		? `${parsed.prefix}${(parsed.value * progress).toLocaleString("en-US", { maximumFractionDigits: parsed.value % 1 ? 1 : 0 })}${parsed.suffix}${payload.suffix ?? ""}`
		: payload.value;
	return (
		<div style={{ display: "grid", gap: 14 }}>
			<div style={{ fontSize: 42, fontWeight: 800, lineHeight: 1.05 }}>{payload.title}</div>
			<div
				style={{
					fontSize: 142,
					fontWeight: 950,
					lineHeight: 0.9,
					color: accentColor,
					letterSpacing: 0,
				}}
			>
				{value}
			</div>
			{payload.comparison ? (
				<div style={{ fontSize: 34, fontWeight: 650, opacity: 0.82 }}>{payload.comparison}</div>
			) : null}
		</div>
	);
}

function BarChart({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "bar_chart" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const max = Math.max(1, ...payload.rows.map((r) => r.value));
	return (
		<div style={{ display: "grid", gap: 18 }}>
			<div style={{ fontSize: 38, fontWeight: 850 }}>{payload.title}</div>
			<div style={{ display: "grid", gap: 14 }}>
				{payload.rows.map((row, index) => {
					const rowProgress = clamp01((progress * payload.rows.length - index) / 0.9);
					const width = `${Math.max(3, (row.value / max) * 100 * easeOut(rowProgress))}%`;
					return (
						<div
							key={row.label}
							style={{
								display: "grid",
								gridTemplateColumns: "150px 1fr 86px",
								alignItems: "center",
								gap: 14,
							}}
						>
							<div
								style={{
									fontSize: 25,
									fontWeight: 720,
									overflow: "hidden",
									textOverflow: "ellipsis",
									whiteSpace: "nowrap",
								}}
							>
								{row.label}
							</div>
							<div
								style={{
									height: 34,
									background: "rgba(255,255,255,0.14)",
									overflow: "hidden",
									borderRadius: 7,
								}}
							>
								<div
									style={{
										width,
										height: "100%",
										background: row.color ?? accentColor,
										borderRadius: 7,
									}}
								/>
							</div>
							<div style={{ fontSize: 25, fontWeight: 800, textAlign: "right" }}>
								{row.value.toLocaleString("en-US")}
								{payload.unit ?? ""}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

const CHART_COLORS = ["#8b5cf6", "#2dd4bf", "#f59e0b", "#f43f5e", "#38bdf8", "#a3e635"];

function chartBounds(values: number[]) {
	const min = Math.min(0, ...values);
	const max = Math.max(1, ...values);
	return { min, max, span: Math.max(1, max - min) };
}

function polyPoints(
	points: Array<{ label: string; value: number }>,
	width: number,
	height: number,
): Array<{ x: number; y: number; label: string; value: number }> {
	const { min, span } = chartBounds(points.map((p) => p.value));
	const last = Math.max(1, points.length - 1);
	return points.map((p, i) => ({
		x: (i / last) * width,
		y: height - ((p.value - min) / span) * height,
		label: p.label,
		value: p.value,
	}));
}

function LineChart({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "line_chart" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const width = 680;
	const height = 260;
	const pts = polyPoints(payload.points, width, height);
	const d = pts
		.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
		.join(" ");
	const visible = Math.max(0.01, progress);
	return (
		<div style={{ display: "grid", gap: 18 }}>
			<div style={{ fontSize: 38, fontWeight: 850 }}>{payload.title}</div>
			<svg viewBox={`0 0 ${width} ${height + 72}`} style={{ width: "100%", overflow: "visible" }}>
				<path
					d={d}
					fill="none"
					stroke="rgba(255,255,255,0.14)"
					strokeWidth={6}
					strokeLinecap="round"
				/>
				<path
					d={d}
					fill="none"
					stroke={accentColor}
					strokeWidth={8}
					strokeLinecap="round"
					strokeDasharray={1000}
					strokeDashoffset={1000 * (1 - visible)}
				/>
				{pts.map((p, i) => {
					const dot = clamp01(progress * pts.length - i);
					return (
						<g key={i} opacity={dot}>
							<circle cx={p.x} cy={p.y} r={10} fill={accentColor} />
							<text
								x={p.x}
								y={height + 42}
								fill="currentColor"
								fontSize={22}
								fontWeight={650}
								textAnchor="middle"
							>
								{p.label}
							</text>
							<text
								x={p.x}
								y={p.y - 18}
								fill="currentColor"
								fontSize={24}
								fontWeight={800}
								textAnchor="middle"
							>
								{p.value}
								{payload.unit ?? ""}
							</text>
						</g>
					);
				})}
			</svg>
		</div>
	);
}

function AreaChart({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "area_chart" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const uid = useId();
	const width = 680;
	const height = 260;
	const pts = polyPoints(payload.points, width, height);
	const line = pts
		.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
		.join(" ");
	const area = `${line} L ${width} ${height} L 0 ${height} Z`;
	const revealWidth = width * clamp01(progress);
	return (
		<div style={{ display: "grid", gap: 18 }}>
			<div style={{ fontSize: 38, fontWeight: 850 }}>{payload.title}</div>
			<svg viewBox={`0 0 ${width} ${height + 68}`} style={{ width: "100%", overflow: "visible" }}>
				<defs>
					<clipPath id={`area-reveal-${uid}`}>
						<rect x={0} y={0} width={revealWidth} height={height + 68} />
					</clipPath>
					<linearGradient id={`area-fill-${uid}`} x1="0" y1="0" x2="0" y2="1">
						<stop offset="0%" stopColor={accentColor} stopOpacity={0.55} />
						<stop offset="100%" stopColor={accentColor} stopOpacity={0.04} />
					</linearGradient>
				</defs>
				<g clipPath={`url(#area-reveal-${uid})`}>
					<path d={area} fill={`url(#area-fill-${uid})`} />
					<path d={line} fill="none" stroke={accentColor} strokeWidth={7} strokeLinecap="round" />
				</g>
				{pts.map((p, i) => (
					<text
						key={i}
						x={p.x}
						y={height + 42}
						fill="currentColor"
						fontSize={22}
						fontWeight={650}
						textAnchor="middle"
					>
						{p.label}
					</text>
				))}
			</svg>
		</div>
	);
}

function slicePath(
	cx: number,
	cy: number,
	r: number,
	start: number,
	end: number,
	inner = 0,
): string {
	const large = end - start > Math.PI ? 1 : 0;
	const p = (ang: number, rad: number): [number, number] => [
		cx + Math.cos(ang) * rad,
		cy + Math.sin(ang) * rad,
	];
	const [x1, y1] = p(start, r);
	const [x2, y2] = p(end, r);
	if (inner <= 0) return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
	const [x3, y3] = p(end, inner);
	const [x4, y4] = p(start, inner);
	return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
}

function PieLikeChart({
	payload,
	progress,
	accentColor,
	donut = false,
}: {
	payload: Extract<InfographicPayload, { type: "pie_chart" | "donut_chart" }>;
	progress: number;
	accentColor: string;
	donut?: boolean;
}): JSX.Element {
	const slices = payload.slices;
	const total = Math.max(
		1,
		slices.reduce((sum, s) => sum + Math.max(0, s.value), 0),
	);
	let cursor = -Math.PI / 2;
	const shown = total * clamp01(progress);
	let consumed = 0;
	return (
		<div
			style={{ display: "grid", gridTemplateColumns: "310px 1fr", gap: 28, alignItems: "center" }}
		>
			<svg viewBox="0 0 300 300" style={{ width: "100%" }}>
				{slices.map((s, i) => {
					const available = Math.max(0, Math.min(s.value, shown - consumed));
					const start = cursor;
					const end = cursor + (available / total) * Math.PI * 2;
					cursor += (s.value / total) * Math.PI * 2;
					consumed += s.value;
					if (available <= 0) return null;
					return (
						<path
							key={i}
							d={slicePath(150, 150, 130, start, end, donut ? 76 : 0)}
							fill={s.color ?? CHART_COLORS[i % CHART_COLORS.length] ?? accentColor}
						/>
					);
				})}
				{donut ? (
					<>
						<text
							x={150}
							y={142}
							fill="currentColor"
							fontSize={30}
							fontWeight={900}
							textAnchor="middle"
						>
							{payload.type === "donut_chart"
								? (payload.centerLabel ?? `${Math.round(total)}${payload.unit ?? ""}`)
								: ""}
						</text>
						<text
							x={150}
							y={176}
							fill="currentColor"
							fontSize={18}
							fontWeight={650}
							opacity={0.72}
							textAnchor="middle"
						>
							total
						</text>
					</>
				) : null}
			</svg>
			<div style={{ display: "grid", gap: 14 }}>
				<div style={{ fontSize: 38, fontWeight: 850 }}>{payload.title}</div>
				{slices.map((s, i) => (
					<div
						key={s.label}
						style={{
							display: "grid",
							gridTemplateColumns: "18px 1fr auto",
							gap: 12,
							alignItems: "center",
							fontSize: 24,
							fontWeight: 680,
						}}
					>
						<span
							style={{
								width: 18,
								height: 18,
								borderRadius: 999,
								background: s.color ?? CHART_COLORS[i % CHART_COLORS.length] ?? accentColor,
							}}
						/>
						<span>{s.label}</span>
						<b>
							{s.value}
							{payload.unit ?? ""}
						</b>
					</div>
				))}
			</div>
		</div>
	);
}

function ProgressBars({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "progress_bars" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	return (
		<div style={{ display: "grid", gap: 18 }}>
			<div style={{ fontSize: 38, fontWeight: 850 }}>{payload.title}</div>
			{payload.rows.map((row, index) => {
				const rowProgress = easeOut(clamp01(progress * payload.rows.length - index));
				return (
					<div key={row.label} style={{ display: "grid", gap: 8 }}>
						<div
							style={{
								display: "flex",
								justifyContent: "space-between",
								fontSize: 25,
								fontWeight: 760,
							}}
						>
							<span>{row.label}</span>
							<span>
								{Math.round(row.value * rowProgress)}
								{payload.unit ?? "%"}
							</span>
						</div>
						<div
							style={{
								height: 22,
								borderRadius: 999,
								overflow: "hidden",
								background: "rgba(255,255,255,0.13)",
							}}
						>
							<div
								style={{
									height: "100%",
									width: `${Math.min(100, Math.max(0, row.value)) * rowProgress}%`,
									borderRadius: 999,
									background: row.color ?? accentColor,
								}}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

function CircularProgress({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "circular_progress" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const value = Math.max(0, Math.min(100, payload.value));
	const radius = 104;
	const circumference = 2 * Math.PI * radius;
	const pct = value * easeOut(progress);
	return (
		<div
			style={{ display: "grid", gridTemplateColumns: "270px 1fr", gap: 28, alignItems: "center" }}
		>
			<svg viewBox="0 0 260 260" style={{ width: "100%" }}>
				<circle
					cx={130}
					cy={130}
					r={radius}
					fill="none"
					stroke="rgba(255,255,255,0.14)"
					strokeWidth={24}
				/>
				<circle
					cx={130}
					cy={130}
					r={radius}
					fill="none"
					stroke={accentColor}
					strokeWidth={24}
					strokeLinecap="round"
					strokeDasharray={circumference}
					strokeDashoffset={circumference * (1 - pct / 100)}
					transform="rotate(-90 130 130)"
				/>
				<text
					x={130}
					y={124}
					fill="currentColor"
					fontSize={58}
					fontWeight={950}
					textAnchor="middle"
				>
					{Math.round(pct)}
					{payload.unit ?? "%"}
				</text>
				{payload.label ? (
					<text
						x={130}
						y={160}
						fill="currentColor"
						fontSize={22}
						fontWeight={680}
						opacity={0.72}
						textAnchor="middle"
					>
						{payload.label}
					</text>
				) : null}
			</svg>
			<div style={{ fontSize: 44, fontWeight: 900, lineHeight: 1.04 }}>{payload.title}</div>
		</div>
	);
}

function markGlyph(mark: "tick" | "cross", accentColor: string): JSX.Element {
	const color = mark === "tick" ? accentColor : "rgba(255,86,86,0.95)";
	return (
		<svg
			width={26}
			height={26}
			viewBox="0 0 24 24"
			fill="none"
			stroke={color}
			strokeWidth={3.4}
			strokeLinecap="round"
			strokeLinejoin="round"
		>
			{mark === "tick" ? (
				<path d="M4 12.5 9.5 18 20 6.5" />
			) : (
				<>
					<path d="M6 6l12 12" />
					<path d="M18 6L6 18" />
				</>
			)}
		</svg>
	);
}

// Row reveal is driven by LINEAR progress so per-row SFX sequences (placed at
// evenly spaced frames by the parent) land exactly when their row appears.
function TableBuild({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "table_build" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const visibleRows = Math.ceil(payload.rows.length * progress);
	return (
		<div style={{ display: "grid", gap: 16 }}>
			<div style={{ fontSize: 36, fontWeight: 850 }}>{payload.title}</div>
			<div
				style={{
					overflow: "hidden",
					border: "1px solid rgba(255,255,255,0.22)",
					borderRadius: 8,
					background: "rgba(0,0,0,0.26)",
				}}
			>
				<div
					style={{
						display: "grid",
						gridTemplateColumns: `repeat(${payload.columns.length}, 1fr)`,
						background: "rgba(255,255,255,0.12)",
					}}
				>
					{payload.columns.map((col, ci) => (
						<div key={ci} style={{ padding: "14px 16px", fontSize: 22, fontWeight: 820 }}>
							{col}
						</div>
					))}
				</div>
				{payload.rows.slice(0, visibleRows).map((row, ri) => (
					<div
						key={ri}
						style={{
							display: "grid",
							gridTemplateColumns: `repeat(${payload.columns.length}, 1fr)`,
							borderTop: "1px solid rgba(255,255,255,0.12)",
						}}
					>
						{payload.columns.map((_, ci) => {
							const hit = payload.highlight?.row === ri || payload.highlight?.col === ci;
							const mark = payload.marks?.[ri]?.[ci];
							return (
								<div
									key={ci}
									style={{
										padding: "13px 16px",
										fontSize: 21,
										fontWeight: hit ? 800 : 560,
										color: hit ? accentColor : undefined,
										display: "flex",
										alignItems: "center",
										gap: 10,
									}}
								>
									{mark && mark !== "none" ? markGlyph(mark, accentColor) : null}
									{row[ci] ?? ""}
								</div>
							);
						})}
					</div>
				))}
			</div>
		</div>
	);
}

// One-shot per row: tick rows play tickUrl, cross rows crossUrl, timed to the
// linear row-reveal schedule TableBuild uses.
function TableRowSfx({
	payload,
	buildFrames,
	revealDelayFrames,
}: {
	payload: Extract<InfographicPayload, { type: "table_build" }>;
	buildFrames: number;
	revealDelayFrames: number;
}): JSX.Element | null {
	if (!payload.rowSfx) return null;
	const rowCount = payload.rows.length;
	return (
		<>
			{payload.rows.map((_, ri) => {
				const rowMarks = payload.marks?.[ri] ?? [];
				const hasCross = rowMarks.includes("cross");
				const hasTick = rowMarks.includes("tick");
				const url = hasCross
					? payload.rowSfx?.crossUrl
					: hasTick
						? payload.rowSfx?.tickUrl
						: undefined;
				if (!url) return null;
				// Row ri appears when linear progress crosses ri/rowCount.
				const from = revealDelayFrames + Math.round((ri / rowCount) * buildFrames);
				return (
					<Sequence
						key={ri}
						from={from}
						durationInFrames={Math.max(10, Math.round(buildFrames / rowCount))}
					>
						<Audio src={url} volume={0.7} />
					</Sequence>
				);
			})}
		</>
	);
}

function StarRating({
	rating,
	progress,
	accentColor,
}: {
	rating: number;
	progress: number;
	accentColor: string;
}): JSX.Element {
	// SVG gradient ids are document-global — two social-proof overlays on screen
	// at once would cross-contaminate fills without a per-instance id.
	const uid = useId();
	return (
		<div style={{ display: "flex", gap: 8 }}>
			{[0, 1, 2, 3, 4].map((i) => {
				const starProgress = clamp01(progress * 5 - i);
				const fillPct = clamp01(rating - i);
				const scale = 0.5 + easeOut(starProgress) * 0.5;
				return (
					<svg
						key={i}
						width={54}
						height={54}
						viewBox="0 0 24 24"
						style={{ opacity: starProgress, scale: `${scale}` }}
					>
						<defs>
							<linearGradient id={`star-fill-${uid}-${i}`}>
								<stop offset={`${fillPct * 100}%`} stopColor={accentColor} />
								<stop offset={`${fillPct * 100}%`} stopColor="rgba(255,255,255,0.22)" />
							</linearGradient>
						</defs>
						<path
							fill={`url(#star-fill-${uid}-${i})`}
							d="M12 2l2.9 6.26L21.5 9.27l-4.75 4.35L18 20.5 12 17l-6 3.5 1.25-6.88L2.5 9.27l6.6-1.01L12 2z"
						/>
					</svg>
				);
			})}
		</div>
	);
}

function SocialProof({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "social_proof" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const countUp = (raw: string): string => {
		const parsed = safeNumber(raw);
		return parsed
			? `${parsed.prefix}${(parsed.value * easeOut(progress)).toLocaleString("en-US", { maximumFractionDigits: parsed.value % 1 ? 1 : 0 })}${parsed.suffix}`
			: raw;
	};
	const badgePop = easeOut(clamp01(progress * 3 - 1.6));
	return (
		<div style={{ display: "grid", gap: 16 }}>
			<div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.05 }}>{payload.title}</div>
			{payload.rating != null ? (
				<div style={{ display: "flex", alignItems: "center", gap: 18 }}>
					<StarRating rating={payload.rating} progress={progress} accentColor={accentColor} />
					<div style={{ fontSize: 52, fontWeight: 900, color: accentColor }}>
						{payload.rating.toFixed(1)}
					</div>
				</div>
			) : null}
			<div style={{ display: "flex", gap: 28, alignItems: "baseline" }}>
				{payload.reviewCount ? (
					<div style={{ fontSize: 40, fontWeight: 800 }}>
						{countUp(payload.reviewCount)}{" "}
						<span style={{ fontSize: 26, fontWeight: 620, opacity: 0.75 }}>reviews</span>
					</div>
				) : null}
				{payload.soldCount ? (
					<div style={{ fontSize: 40, fontWeight: 800 }}>
						{countUp(payload.soldCount)}{" "}
						<span style={{ fontSize: 26, fontWeight: 620, opacity: 0.75 }}>sold</span>
					</div>
				) : null}
			</div>
			{payload.badge ? (
				<div
					style={{
						justifySelf: "start",
						padding: "10px 22px",
						borderRadius: 999,
						background: accentColor,
						color: "#0b0b0f",
						fontSize: 26,
						fontWeight: 850,
						opacity: badgePop,
						scale: `${0.7 + badgePop * 0.3}`,
					}}
				>
					{payload.badge}
				</div>
			) : null}
		</div>
	);
}

function Urgency({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "urgency" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();
	// Gentle attention pulse once the build settles — compositor-safe (scale only).
	const pulse = progress >= 1 ? 1 + Math.sin((frame / fps) * Math.PI * 2) * 0.02 : 1;
	const stock =
		payload.stockCount != null
			? Math.max(1, Math.round(payload.stockCount * easeOut(progress)))
			: null;
	return (
		<div style={{ display: "grid", gap: 14, scale: `${pulse}` }}>
			<div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.05 }}>{payload.title}</div>
			{stock != null ? (
				<div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
					<div style={{ fontSize: 118, fontWeight: 950, lineHeight: 0.95, color: accentColor }}>
						{stock}
					</div>
					<div style={{ fontSize: 34, fontWeight: 700, opacity: 0.85 }}>
						{payload.stockLabel ?? "left in stock"}
					</div>
				</div>
			) : null}
			{payload.deadlineText ? (
				<div style={{ fontSize: 40, fontWeight: 850, color: accentColor }}>
					{payload.deadlineText}
				</div>
			) : null}
			{payload.note ? (
				<div style={{ fontSize: 28, fontWeight: 620, opacity: 0.8 }}>{payload.note}</div>
			) : null}
		</div>
	);
}

function PriceTagCallout({
	payload,
	progress,
	accentColor,
}: {
	payload: Extract<InfographicPayload, { type: "price_tag" }>;
	progress: number;
	accentColor: string;
}): JSX.Element {
	const pop = easeOut(Math.min(1, progress * 2.2));
	// Price anchoring: animate the number falling from compareAt down to price so
	// the drop itself is the reveal. Falls back to static price when not numeric.
	const from = payload.dropAnimation && payload.compareAt ? safeNumber(payload.compareAt) : null;
	const to = from ? safeNumber(payload.price) : null;
	const dropProgress = easeOut(clamp01(progress * 1.6));
	const displayPrice =
		from && to
			? `${to.prefix}${(from.value + (to.value - from.value) * dropProgress).toLocaleString("en-US", { maximumFractionDigits: to.value % 1 ? 2 : 0 })}${to.suffix}`
			: payload.price;
	const discountPct =
		from && to && from.value > 0 ? Math.round((1 - to.value / from.value) * 100) : null;
	const badgeText = payload.badge ?? (discountPct && discountPct > 0 ? `-${discountPct}%` : null);
	const badgePop = easeOut(clamp01(progress * 2.6 - 1.3));
	return (
		<div style={{ display: "grid", gap: 12 }}>
			<div style={{ fontSize: 38, fontWeight: 800, lineHeight: 1.05 }}>{payload.title}</div>
			<div
				style={{ display: "flex", alignItems: "baseline", gap: 20, scale: `${0.92 + pop * 0.08}` }}
			>
				<div style={{ fontSize: 116, fontWeight: 950, lineHeight: 0.95, color: accentColor }}>
					{displayPrice}
				</div>
				{payload.compareAt ? (
					<div
						style={{
							fontSize: 46,
							fontWeight: 700,
							opacity: 0.6,
							textDecoration: "line-through",
							textDecorationThickness: 4,
						}}
					>
						{payload.compareAt}
					</div>
				) : null}
				{badgeText ? (
					<div
						style={{
							padding: "8px 20px",
							borderRadius: 999,
							background: accentColor,
							color: "#0b0b0f",
							fontSize: 30,
							fontWeight: 900,
							opacity: badgePop,
							scale: `${0.6 + badgePop * 0.4}`,
							rotate: `${(1 - badgePop) * -8}deg`,
						}}
					>
						{badgeText}
					</div>
				) : null}
			</div>
			{payload.note ? (
				<div style={{ fontSize: 30, fontWeight: 650, opacity: 0.82 }}>{payload.note}</div>
			) : null}
		</div>
	);
}

export function InfographicRenderer({
	block,
	accentColor,
	fgColor,
	durationInFrames,
	infographicStyle,
}: {
	block: InfographicOverlayData;
	accentColor: string;
	fgColor: string;
	durationInFrames: number;
	infographicStyle?: InfographicStyleData;
}): JSX.Element {
	const { fps } = useVideoConfig();
	// Word-timed reveal: revealAtSec is absolute video time; this component runs
	// inside a Sequence starting at block.startSec, so convert to a local delay.
	const revealDelayFrames =
		block.revealAtSec != null
			? Math.max(0, Math.round((block.revealAtSec - block.startSec) * fps))
			: 0;
	const { enter, main, mainLinear, exit } = useClipProgress(durationInFrames, revealDelayFrames);
	const payload = block.payload;
	const progress = interpolate(main, [0, 1], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const dataColor = infographicStyle?.dataColor ?? accentColor;
	const labelColor = infographicStyle?.labelColor ?? fgColor;
	const exitFrames = Math.max(6, Math.min(14, Math.floor(durationInFrames * 0.16)));
	const buildFrames = Math.max(1, durationInFrames - exitFrames - revealDelayFrames);
	return (
		<AbsoluteFill style={{ zIndex: 35, pointerEvents: "none" }}>
			<div style={{ ...shellStyle(block, labelColor), ...entranceStyle(block, enter, exit) }}>
				<div style={panelStyle(payload, infographicStyle)}>
					{payload.type === "stat_reveal" ? (
						<StatReveal payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "bar_chart" ? (
						<BarChart payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "line_chart" ? (
						<LineChart payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "area_chart" ? (
						<AreaChart payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "pie_chart" ? (
						<PieLikeChart payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "donut_chart" ? (
						<PieLikeChart payload={payload} progress={progress} accentColor={dataColor} donut />
					) : null}
					{payload.type === "progress_bars" ? (
						<ProgressBars payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "circular_progress" ? (
						<CircularProgress payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "table_build" ? (
						<TableBuild payload={payload} progress={mainLinear} accentColor={dataColor} />
					) : null}
					{payload.type === "price_tag" ? (
						<PriceTagCallout payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "social_proof" ? (
						<SocialProof payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
					{payload.type === "urgency" ? (
						<Urgency payload={payload} progress={progress} accentColor={dataColor} />
					) : null}
				</div>
			</div>
			{payload.type === "table_build" ? (
				<TableRowSfx
					payload={payload}
					buildFrames={buildFrames}
					revealDelayFrames={revealDelayFrames}
				/>
			) : null}
		</AbsoluteFill>
	);
}
