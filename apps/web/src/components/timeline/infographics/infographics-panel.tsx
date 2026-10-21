/* Maleo — Infographics panel (data callouts). Per-type payload field editors
 * with an instant WYSIWYG preview: every AI decision is a plain editable field,
 * so changing one re-renders the preview with no regeneration round-trip. */
import { usePreviewFrame } from "@hooks/timeline/use-preview-frame.ts";
import { useMemo } from "react";
import type { JSX } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ML } from "@design-system/components/field-label.tsx";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import {
	DEFAULT_INFOGRAPHIC_STYLE,
	INFOGRAPHIC_PICKER_FALLBACKS,
} from "@models/presets/generation-defaults.ts";
import type { InfographicPayload, InfographicStyle, TableCellMark } from "@maleo/shared";
import { StoryboardReel, type Storyboard } from "@maleo/video/composition";
import { Player } from "@remotion/player";
import { DEFAULT_BRAND, type BrandPalette } from "@models/timeline/panel-brand.ts";
import { Button } from "@design-system/components/button.tsx";

/* Moved to models/timeline/element-catalogue.ts so the library catalogue can
 * list the data elements without importing this panel. */
import { INFOGRAPHIC_KINDS } from "@models/timeline/element-catalogue.ts";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { AmountField, FieldRow } from "@design-system/patterns/inspector.tsx";
import "./infographics-panel.css";

/** `still` freezes the preview on one frame — see TextPresetPreview. */
export function InfographicTypePreview({
	payload,
	style = DEFAULT_INFOGRAPHIC_STYLE,
	brand = DEFAULT_BRAND,
	still,
	compact = false,
}: {
	payload: InfographicPayload;
	style?: InfographicStyle;
	brand?: BrandPalette;
	still?: number;
	compact?: boolean;
}): JSX.Element {
	const previewFrame = usePreviewFrame(still);
	const storyboard = useMemo(
		(): Storyboard => ({
			scenes: [
				{
					image: "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
					durationSec: 4,
					label: "",
					movement: "Static",
					transition: "cut",
					voiceover: "",
					visual: "",
					camera: "",
					vignette: false,
					grain: false,
				},
			],
			accentColor: brand.accentColor,
			bgColor: brand.bgColor,
			fgColor: brand.fgColor,
			musicMood: "chill",
			showLabels: false,
			hideBase: true,
			muteBase: true,
			textOverlays: [],
			audioOverlays: [],
			videoOverlays: [],
			effects: [],
			infographicStyle: style,
			infographicOverlays: [
				{
					startSec: 0,
					durationSec: 4,
					track: 0,
					layout: { xPct: 2, yPct: 8, widthPct: 96, fit: "contain" },
					animation: {
						in: "slide_up",
						main:
							payload.type === "stat_reveal" || payload.type === "price_tag" ? "count" : "build",
						out: "fade",
					},
					payload,
				},
			],
		}),
		[payload, style, brand.accentColor, brand.bgColor, brand.fgColor],
	);
	return (
		<span className={compact ? "tl2-element-preview" : "fc-data-preview"} aria-hidden>
			<Player
				key={previewFrame ?? "loop"}
				component={StoryboardReel}
				inputProps={storyboard}
				durationInFrames={120}
				compositionWidth={1280}
				compositionHeight={640}
				fps={30}
				initialFrame={previewFrame}
				initiallyMuted
				numberOfSharedAudioTags={0}
				autoPlay={previewFrame === undefined}
				loop={previewFrame === undefined}
				/* NOT a class, and it cannot be one. `Player` renders a container it
				 * styles inline, which beats any rule a `className` could carry —
				 * moving this to `.fc-data-player` left every catalogue tile scaled
				 * wrong and overflowing its card, and the `library-elements-data`
				 * baseline caught it at all four widths. A style prop handed to a
				 * library that styles inline is not a class, the same way a computed
				 * width is not. */
				style={{ width: "100%", height: "100%" }}
			/>
		</span>
	);
}

// Per-type payload field editors. Every AI decision is a plain editable field —
// changing one re-renders the preview instantly (no regeneration round-trip).
export function InfographicFields({
	payload,
	onChange,
}: {
	payload: InfographicPayload;
	onChange: (next: InfographicPayload) => void;
}): JSX.Element {
	const text = (
		label: string,
		value: string,
		set: (v: string) => void,
		placeholder = "",
	): JSX.Element => (
		<Field as="div" key={label}>
			<ML>{label}</ML>
			<Input value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
		</Field>
	);
	if (payload.type === "stat_reveal") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text("Value", payload.value, (v) => onChange({ ...payload, value: v }), "42%")}
				{text("Suffix", payload.suffix ?? "", (v) =>
					onChange({ ...payload, suffix: v || undefined }),
				)}
				{text(
					"Comparison",
					payload.comparison ?? "",
					(v) => onChange({ ...payload, comparison: v || undefined }),
					"vs last month",
				)}
			</>
		);
	}
	if (payload.type === "price_tag") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text("Price", payload.price, (v) => onChange({ ...payload, price: v }), "Rp 1.2jt")}
				{text(
					"Was (strikethrough)",
					payload.compareAt ?? "",
					(v) => onChange({ ...payload, compareAt: v || undefined }),
					"Rp 1.8jt",
				)}
				{text(
					"Badge",
					payload.badge ?? "",
					(v) => onChange({ ...payload, badge: v || undefined }),
					"auto: -%discount",
				)}
				{text(
					"Note",
					payload.note ?? "",
					(v) => onChange({ ...payload, note: v || undefined }),
					"limited offer",
				)}
				<Field className="fc-data-check">
					<input
						type="checkbox"
						checked={payload.dropAnimation ?? false}
						onChange={(e) => onChange({ ...payload, dropAnimation: e.target.checked || undefined })}
					/>
					<ML>Animate price drop</ML>
				</Field>
			</>
		);
	}
	if (payload.type === "social_proof") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Rating (0-5)",
					payload.rating != null ? String(payload.rating) : "",
					(v) => {
						const n = Number(v);
						onChange({
							...payload,
							rating: v === "" || Number.isNaN(n) ? undefined : Math.max(0, Math.min(5, n)),
						});
					},
					"4.8",
				)}
				{text(
					"Review count",
					payload.reviewCount ?? "",
					(v) => onChange({ ...payload, reviewCount: v || undefined }),
					"2,300",
				)}
				{text(
					"Sold count",
					payload.soldCount ?? "",
					(v) => onChange({ ...payload, soldCount: v || undefined }),
					"12k",
				)}
				{text(
					"Badge",
					payload.badge ?? "",
					(v) => onChange({ ...payload, badge: v || undefined }),
					"#1 Best Seller",
				)}
			</>
		);
	}
	if (payload.type === "urgency") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Stock count",
					payload.stockCount != null ? String(payload.stockCount) : "",
					(v) => {
						const n = Number(v);
						onChange({
							...payload,
							stockCount: v === "" || Number.isNaN(n) ? undefined : Math.round(n),
						});
					},
					"7",
				)}
				{text(
					"Stock label",
					payload.stockLabel ?? "",
					(v) => onChange({ ...payload, stockLabel: v || undefined }),
					"left in stock",
				)}
				{text(
					"Deadline",
					payload.deadlineText ?? "",
					(v) => onChange({ ...payload, deadlineText: v || undefined }),
					"Sale ends tonight",
				)}
				{text("Note", payload.note ?? "", (v) => onChange({ ...payload, note: v || undefined }))}
			</>
		);
	}
	if (payload.type === "bar_chart") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Unit",
					payload.unit ?? "",
					(v) => onChange({ ...payload, unit: v || undefined }),
					"%",
				)}
				<ML>Rows</ML>
				{payload.rows.map((row, i) => (
					<div key={i} className="fc-data-row">
						<Input
							className="fc-data-row-label"
							value={row.label}
							onChange={(e) =>
								onChange({
									...payload,
									rows: payload.rows.map((r, ri) =>
										ri === i ? { ...r, label: e.target.value } : r,
									),
								})
							}
						/>
						<Input
							className="fc-data-row-value"
							type="number"
							value={row.value}
							onChange={(e) =>
								onChange({
									...payload,
									rows: payload.rows.map((r, ri) =>
										ri === i ? { ...r, value: Number(e.target.value) || 0 } : r,
									),
								})
							}
						/>
						<IconButton
							size="xs"
							title="Remove row"
							disabled={payload.rows.length <= 1}
							onClick={() =>
								onChange({ ...payload, rows: payload.rows.filter((_, ri) => ri !== i) })
							}
						>
							{Ic.x(ICON.xs)}
						</IconButton>
					</div>
				))}
				<Button
					size="sm"
					disabled={payload.rows.length >= 5}
					onClick={() =>
						onChange({
							...payload,
							rows: [...payload.rows, { label: `Item ${payload.rows.length + 1}`, value: 10 }],
						})
					}
				>
					{Ic.plus(ICON.xs)} Add row
				</Button>
			</>
		);
	}
	if (payload.type === "progress_bars") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Unit",
					payload.unit ?? "",
					(v) => onChange({ ...payload, unit: v || undefined }),
					"%",
				)}
				<ML>Progress rows</ML>
				{payload.rows.map((row, i) => (
					<div key={i} className="fc-data-row">
						<Input
							className="fc-data-row-label"
							value={row.label}
							onChange={(e) =>
								onChange({
									...payload,
									rows: payload.rows.map((r, ri) =>
										ri === i ? { ...r, label: e.target.value } : r,
									),
								})
							}
						/>
						<Input
							className="fc-data-row-value"
							type="number"
							min={0}
							max={100}
							value={row.value}
							onChange={(e) =>
								onChange({
									...payload,
									rows: payload.rows.map((r, ri) =>
										ri === i
											? { ...r, value: Math.max(0, Math.min(100, Number(e.target.value) || 0)) }
											: r,
									),
								})
							}
						/>
						<IconButton
							size="xs"
							title="Remove row"
							disabled={payload.rows.length <= 1}
							onClick={() =>
								onChange({ ...payload, rows: payload.rows.filter((_, ri) => ri !== i) })
							}
						>
							{Ic.x(ICON.xs)}
						</IconButton>
					</div>
				))}
				<Button
					size="sm"
					disabled={payload.rows.length >= 5}
					onClick={() =>
						onChange({
							...payload,
							rows: [...payload.rows, { label: `Step ${payload.rows.length + 1}`, value: 50 }],
						})
					}
				>
					{Ic.plus(ICON.xs)} Add row
				</Button>
			</>
		);
	}
	if (payload.type === "line_chart" || payload.type === "area_chart") {
		const updatePoint = (i: number, patch: Partial<{ label: string; value: number }>): void =>
			onChange({
				...payload,
				points: payload.points.map((p, pi) => (pi === i ? { ...p, ...patch } : p)),
			});
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Unit",
					payload.unit ?? "",
					(v) => onChange({ ...payload, unit: v || undefined }),
					"%",
				)}
				<ML>Points</ML>
				{payload.points.map((point, i) => (
					<div key={i} className="fc-data-row">
						<Input
							className="fc-data-row-label"
							value={point.label}
							onChange={(e) => updatePoint(i, { label: e.target.value })}
						/>
						<Input
							className="fc-data-row-value"
							type="number"
							value={point.value}
							onChange={(e) => updatePoint(i, { value: Number(e.target.value) || 0 })}
						/>
						<IconButton
							size="xs"
							title="Remove point"
							disabled={payload.points.length <= 2}
							onClick={() =>
								onChange({ ...payload, points: payload.points.filter((_, pi) => pi !== i) })
							}
						>
							{Ic.x(ICON.xs)}
						</IconButton>
					</div>
				))}
				<Button
					size="sm"
					disabled={payload.points.length >= 7}
					onClick={() =>
						onChange({
							...payload,
							points: [...payload.points, { label: `P${payload.points.length + 1}`, value: 50 }],
						})
					}
				>
					{Ic.plus(ICON.xs)} Add point
				</Button>
			</>
		);
	}
	if (payload.type === "pie_chart" || payload.type === "donut_chart") {
		const updateSlice = (i: number, patch: Partial<{ label: string; value: number }>): void =>
			onChange({
				...payload,
				slices: payload.slices.map((s, si) => (si === i ? { ...s, ...patch } : s)),
			});
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Unit",
					payload.unit ?? "",
					(v) => onChange({ ...payload, unit: v || undefined }),
					"%",
				)}
				{payload.type === "donut_chart" &&
					text(
						"Center label",
						payload.centerLabel ?? "",
						(v) => onChange({ ...payload, centerLabel: v || undefined }),
						"100%",
					)}
				<ML>Slices</ML>
				{payload.slices.map((slice, i) => (
					<div key={i} className="fc-data-row">
						<Input
							className="fc-data-row-label"
							value={slice.label}
							onChange={(e) => updateSlice(i, { label: e.target.value })}
						/>
						<Input
							className="fc-data-row-value"
							type="number"
							value={slice.value}
							onChange={(e) => updateSlice(i, { value: Math.max(0, Number(e.target.value) || 0) })}
						/>
						<IconButton
							size="xs"
							title="Remove slice"
							disabled={payload.slices.length <= 1}
							onClick={() =>
								onChange({ ...payload, slices: payload.slices.filter((_, si) => si !== i) })
							}
						>
							{Ic.x(ICON.xs)}
						</IconButton>
					</div>
				))}
				<Button
					size="sm"
					disabled={payload.slices.length >= 6}
					onClick={() =>
						onChange({
							...payload,
							slices: [
								...payload.slices,
								{ label: `Slice ${payload.slices.length + 1}`, value: 20 },
							],
						})
					}
				>
					{Ic.plus(ICON.xs)} Add slice
				</Button>
			</>
		);
	}
	if (payload.type === "circular_progress") {
		return (
			<>
				{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
				{text(
					"Label",
					payload.label ?? "",
					(v) => onChange({ ...payload, label: v || undefined }),
					"complete",
				)}
				{text(
					"Unit",
					payload.unit ?? "",
					(v) => onChange({ ...payload, unit: v || undefined }),
					"%",
				)}
				<Field as="div">
					<ML>Value</ML>
					<Input
						type="number"
						min={0}
						max={100}
						value={payload.value}
						onChange={(e) =>
							onChange({
								...payload,
								value: Math.max(0, Math.min(100, Number(e.target.value) || 0)),
							})
						}
					/>
				</Field>
			</>
		);
	}
	// table_build: columns as comma-separated, rows as one line per row with " | " cells.
	return (
		<>
			{text("Title", payload.title, (v) => onChange({ ...payload, title: v }))}
			{text("Columns (comma-separated)", payload.columns.join(", "), (v) =>
				onChange({
					...payload,
					columns: v
						.split(",")
						.map((c) => c.trim())
						.filter(Boolean)
						.slice(0, 4),
				}),
			)}
			<Field as="div">
				<ML>Rows (one per line, cells with |)</ML>
				<Textarea
					rows={4}
					value={payload.rows.map((r) => r.join(" | ")).join("\n")}
					onChange={(e) =>
						onChange({
							...payload,
							rows: e.target.value
								.split("\n")
								.map((line) => line.split("|").map((c) => c.trim()))
								.filter((r) => r.some(Boolean))
								.slice(0, 5),
						})
					}
				/>
			</Field>
			<Field as="div">
				<ML>Marks (per row, cells: tick / cross / -)</ML>
				<Textarea
					rows={3}
					placeholder={"- | tick | cross"}
					value={(payload.marks ?? [])
						.map((r) => r.map((m) => (m === "none" ? "-" : m)).join(" | "))
						.join("\n")}
					onChange={(e) => {
						const marks = e.target.value
							.split("\n")
							.map((line) =>
								line.split("|").map((c): TableCellMark => {
									const t = c.trim().toLowerCase();
									return t === "tick" || t === "✓"
										? "tick"
										: t === "cross" || t === "x" || t === "✗"
											? "cross"
											: "none";
								}),
							)
							.slice(0, 5);
						onChange({
							...payload,
							marks: marks.some((r) => r.some((m) => m !== "none")) ? marks : undefined,
						});
					}}
				/>
			</Field>
		</>
	);
}

/** Infographic style editor (colors, opacity, radius, blur). Lives on its own
 * so it can render in the Style menu as well as the data picker. `style` is the
 * effective style to show; `onChange` receives the full patched style. */
export function InfographicStyleControls({
	style,
	selected,
	onChange,
}: {
	style: InfographicStyle;
	selected: boolean;
	onChange: (next: InfographicStyle) => void;
}): JSX.Element {
	const s = style;
	const upS = (patch: Partial<InfographicStyle>): void => onChange({ ...s, ...patch });
	return (
		<div className="fc-data-style">
			<ML flush>{selected ? "Selected clip style" : "Default style for new data clips"}</ML>
			<FieldRow label="Background">
				<AlphaColorControl
					display="value"
					label="Background"
					value={s.bgColor}
					fallback="#080a10"
					onChange={(bgColor) =>
						upS({ bgColor, bgOpacity: bgColor === "transparent" ? 0 : s.bgOpacity })
					}
				/>
				<AmountField
					label="Background opacity"
					short="α"
					suffix="%"
					min={0}
					max={100}
					step={2}
					value={Math.round(s.bgOpacity * 100)}
					onChange={(v) => upS({ bgOpacity: v / 100 })}
				/>
			</FieldRow>
			<FieldRow label="Border">
				<AlphaColorControl
					display="value"
					label="Border"
					value={s.borderColor}
					fallback="#ffffff"
					onChange={(borderColor) =>
						upS({ borderColor, borderOpacity: borderColor === "transparent" ? 0 : s.borderOpacity })
					}
				/>
				<AmountField
					label="Border opacity"
					short="α"
					suffix="%"
					min={0}
					max={100}
					step={2}
					value={Math.round(s.borderOpacity * 100)}
					onChange={(v) => upS({ borderOpacity: v / 100 })}
				/>
			</FieldRow>
			<FieldRow label="Data and label">
				<AlphaColorControl
					display="value"
					label="Data"
					value={s.dataColor}
					fallback={INFOGRAPHIC_PICKER_FALLBACKS.data}
					onChange={(dataColor) => upS({ dataColor })}
				/>
				<AlphaColorControl
					display="value"
					label="Label"
					value={s.labelColor}
					fallback={INFOGRAPHIC_PICKER_FALLBACKS.label}
					onChange={(labelColor) => upS({ labelColor })}
				/>
			</FieldRow>
			<FieldRow label="Shape">
				<AmountField
					label="Radius"
					short="Rad"
					suffix="px"
					min={0}
					max={32}
					step={1}
					value={s.borderRadius}
					onChange={(borderRadius) => upS({ borderRadius })}
				/>
				<AmountField
					label="Blur"
					short="Blur"
					suffix="px"
					min={0}
					max={24}
					step={1}
					value={s.blur}
					onChange={(blur) => upS({ blur })}
				/>
			</FieldRow>
		</div>
	);
}

// Exposed so the unified Elements picker can render Data tiles without importing
// the whole panel.
export { INFOGRAPHIC_KINDS };
