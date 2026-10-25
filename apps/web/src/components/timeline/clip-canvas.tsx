/* Shared clip placement UI — a draggable/resizable bounding box on the preview
 * canvas, and a Controls panel of sliders. Used by every visual clip kind
 * (base scene, image/video overlay, text) so placement is uniform (clip-first). */
import type { JSX, ReactNode } from "react";
import { Fragment } from "react";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { AccordionSection } from "./inspector-section.tsx";
import type { ClipLayout, ClipTextStyle, ClipKind } from "@models/timeline/clip-layout.ts";
import { normalizeLayout } from "@models/timeline/clip-layout.ts";
import type { NumericAnimationProperty } from "@maleo/shared";
import { KeyedFieldRow, type RowKeying } from "./keyed-property-row.tsx";
import { canvasSizePatchOf } from "@models/editor-engine/canvas-document.ts";
import { faderFromGain, formatGainDb, gainFromFader } from "@models/timeline/audio-fader.ts";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Section } from "@design-system/components/panel.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import {
	AmountField,
	FieldRow,
	InspectorSection,
	PropertyRow,
} from "@design-system/patterns/inspector.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Toggle, ToggleGroup, ToggleGroupItem } from "@design-system/components/toggle-group.tsx";
import { FULL_SOURCE_CROP, sourceCropSchema } from "@maleo/shared";
export { ClipBox } from "./clip-box.tsx";

// Audio Controls: gain, ducking, and fade in/out. Lives in the compact popover.
export function AudioControls({
	volume,
	duckUnderVoice,
	showDuck,
	fadeIn,
	fadeOut,
	dur,
	onChange,
}: {
	volume: number;
	fadeIn: number;
	fadeOut: number;
	dur: number;
	/** The clip's own duck depth, or the kind's default when it states none. */
	duckUnderVoice: number;
	/** Voiceover is what everything else ducks under, so it does not duck itself. */
	showDuck: boolean;
	onChange: (patch: {
		volume?: number;
		duckUnderVoice?: number;
		fadeIn?: number;
		fadeOut?: number;
	}) => void;
}): JSX.Element {
	const maxFade = Math.max(0.5, Math.round((dur / 2) * 10) / 10);
	/* Calibrated in decibels, not in amplitude — see audio-fader.ts. The stored
	 * value is unchanged; only where it sits on the control is. A fader mapped
	 * straight onto amplitude spends most of its travel on differences the ear
	 * cannot find, which is how a working volume control came to read as an
	 * on/off switch. */
	const underVoice = volume * duckUnderVoice;
	return (
		<Section>
			<div className="tl2-dsec-h">{Ic.mic(ICON.sm)} Audio Controls</div>
			<FieldRow label="Volume">
				<AmountField
					label="Volume"
					short="Vol"
					value={Math.round(faderFromGain(volume))}
					suffix="%"
					min={0}
					max={100}
					step={1}
					onChange={(v) => onChange({ volume: gainFromFader(v) })}
				/>
				{/* What the clip drops to while someone is speaking, as a share of the
				    volume. It was a fixed 35% for music, which is why the volume control
				    read as broken on a narrated video: under continuous voiceover the bed
				    never rose above a third of whatever was set. 100% is no ducking. */}
				{showDuck && (
					<AmountField
						label="Under voice"
						short="Duck"
						value={Math.round(duckUnderVoice * 100)}
						suffix="%"
						min={0}
						max={100}
						step={1}
						onChange={(v) => onChange({ duckUnderVoice: v / 100 })}
					/>
				)}
			</FieldRow>
			{/* What the clip actually plays at, both on its own and while someone is
			    speaking. The second number is the one that surprises: a bed set to a
			    comfortable level is a different thing entirely under narration, and
			    before this the only way to discover that was to wonder why the fader
			    did nothing. */}
			<Note>
				{formatGainDb(volume)}
				{showDuck && underVoice !== volume && <> · under voice {formatGainDb(underVoice)}</>}
			</Note>
			<FieldRow label="Fades">
				<AmountField
					label="Fade in"
					short="In"
					value={fadeIn}
					suffix="s"
					min={0}
					max={maxFade}
					step={0.1}
					onChange={(v) => onChange({ fadeIn: v })}
				/>
				<AmountField
					label="Fade out"
					short="Out"
					value={fadeOut}
					suffix="s"
					min={0}
					max={maxFade}
					step={0.1}
					onChange={(v) => onChange({ fadeOut: v })}
				/>
			</FieldRow>
		</Section>
	);
}

// Source-audio gain for video overlay clips: 0% = muted b-roll (the historical
// default), anything above plays the clip's own soundtrack at that level.
export function VideoVolumeControl({
	volume,
	onChange,
}: {
	volume: number;
	onChange: (volume: number) => void;
}): JSX.Element {
	return (
		<Section>
			<div className="tl2-dsec-h">{Ic.mic(ICON.sm)} Clip Audio</div>
			{/* Same decibel calibration as the audio clip fader — one scale, so a
			    level set on b-roll means what it means on a music bed. */}
			<FieldRow label="Volume">
				<AmountField
					label="Volume"
					short="Vol"
					value={Math.round(faderFromGain(volume))}
					suffix="%"
					min={0}
					max={100}
					step={1}
					onChange={(v) => onChange(gainFromFader(v))}
				/>
			</FieldRow>
			<Note>{formatGainDb(volume)}</Note>
		</Section>
	);
}

const FITS = ["contain", "cover", "stretch"] as const;
const FIT_LABEL = { contain: "Contain", cover: "Cover", stretch: "Stretch" } satisfies Record<
	(typeof FITS)[number],
	string
>;
const ALIGNS = ["left", "center", "right"] as const;

export function ClipControls({
	layout,
	kind,
	onChange,
	style,
	onStyleChange,
}: {
	layout: ClipLayout | undefined;
	kind: ClipKind;
	onChange: (patch: Partial<ClipLayout>) => void;
	style?: ClipTextStyle;
	onStyleChange?: (patch: Partial<ClipTextStyle>) => void;
}): JSX.Element {
	const L = normalizeLayout(layout, kind);
	const isVideo = kind === "video";
	const isText = kind === "text";
	return (
		<Section>
			<div className="tl2-dsec-h">{Ic.layers(ICON.sm)} Controls</div>
			{isVideo && <PlaybackRow layout={L} onChange={onChange} />}
			<FieldRow label="Position">
				<AmountField
					label="X offset"
					short="X"
					value={L.xPct}
					suffix="%"
					min={-50}
					max={150}
					onChange={(v) => onChange({ xPct: v })}
				/>
				<AmountField
					label="Y offset"
					short="Y"
					value={L.yPct}
					suffix="%"
					min={-50}
					max={150}
					onChange={(v) => onChange({ yPct: v })}
				/>
			</FieldRow>
			<FieldRow label="Size">
				<AmountField
					label="Width"
					short="W"
					value={L.widthPct}
					suffix="%"
					min={4}
					max={200}
					onChange={(v) => onChange(canvasSizePatchOf(L, "widthPct", v))}
				/>
				<IconButton
					size="xs"
					aria-label="Lock aspect ratio"
					aria-pressed={Boolean(L.aspectLocked)}
					onClick={() => onChange({ aspectLocked: !L.aspectLocked })}
				>
					{L.aspectLocked ? Ic.lock(ICON.xs) : Ic.lockOpen(ICON.xs)}
				</IconButton>
				<AmountField
					label="Height"
					short="H"
					value={L.heightPct ?? 100}
					suffix="%"
					min={4}
					max={200}
					disabled={Boolean(L.aspectLocked)}
					onChange={(v) => onChange(canvasSizePatchOf(L, "heightPct", v))}
				/>
			</FieldRow>
			<FieldRow label="Rotation and opacity">
				<AmountField
					label="Rotation"
					short="R"
					value={L.rotationDeg ?? 0}
					suffix="°"
					min={-180}
					max={180}
					onChange={(v) => onChange({ rotationDeg: v })}
				/>
				<AmountField
					label="Opacity"
					short="α"
					value={(L.opacity ?? 1) * 100}
					suffix="%"
					min={0}
					max={100}
					onChange={(v) => onChange({ opacity: v / 100 })}
				/>
			</FieldRow>
			{!isText && <FitRow fit={L.fit} onChange={(fit) => onChange({ fit })} />}
			{isText && style && onStyleChange && (
				<>
					<FieldRow label="Size and fill">
						<AmountField
							label="Font size"
							short="Aa"
							value={style.fontSize}
							suffix="px"
							min={12}
							max={200}
							onChange={(v) => onStyleChange({ fontSize: v })}
						/>
						<AlphaColorControl
							display="value"
							label="Fill"
							value={style.fill}
							fallback="#ffffff"
							onChange={(fill) => onStyleChange({ fill })}
						/>
					</FieldRow>
					<PropertyRow label="Align">
						<Select
							size="xs"
							value={style.align}
							onValueChange={onSelect(ALIGNS, (align) => onStyleChange({ align }))}
							aria-label={"Align"}
							phoneBreakpoint={860}
							options={[...(ALIGNS.map((a) => ({ value: a, label: a })) ?? [])]}
						/>
					</PropertyRow>
				</>
			)}
		</Section>
	);
}

/* How the media fills its box. Three short options, one segmented row. */
function FitRow({
	fit,
	onChange,
}: {
	fit: ClipLayout["fit"];
	onChange: (fit: (typeof FITS)[number]) => void;
}): JSX.Element {
	return (
		<FieldRow label="Fit">
			<ToggleGroup
				aria-label="Fit"
				value={fit ?? "contain"}
				onValueChange={(next) => {
					const f = FITS.find((x) => x === next);
					if (f) onChange(f);
				}}
			>
				{FITS.map((f) => (
					<ToggleGroupItem key={f} value={f}>
						{FIT_LABEL[f]}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
		</FieldRow>
	);
}

/* Source playback as one row: rate beside reverse. */
function PlaybackRow({
	layout,
	onChange,
}: {
	layout: ClipLayout;
	onChange: (patch: Partial<ClipLayout>) => void;
}): JSX.Element {
	return (
		<FieldRow label="Playback">
			<AmountField
				label="Rate"
				short="×"
				value={(layout.playbackRate ?? 1) * 100}
				suffix="%"
				min={25}
				max={400}
				step={5}
				onChange={(v) => onChange({ playbackRate: v / 100 })}
			/>
			<Toggle
				aria-label="Reverse"
				title="Reverse"
				pressed={Boolean(layout.reverse)}
				onPressedChange={(reverse) => onChange({ reverse })}
			>
				{Ic.swap(ICON.xs)}
			</Toggle>
		</FieldRow>
	);
}

/* ── Accordion subcategory: collapsible section inside a clip-panel category.
 *    Uncontrolled open state — sections are independent (multiple can be open),
 *    matching the reference inspector. `right` renders extra header affordances
 *    (e.g. a + add button) before the chevron. ── */
// Re-export VUI primitive for existing `from "../clip-canvas"` imports.
export { AccordionSection };

/* ── Transform: the shared ClipLayout editor every visual clip kind (scene, text,
 *    image/video overlay, data callout) reuses. Values edited together share a row:
 *    Position, Size with its lock (locked, width drives and height follows the
 *    ratio), Rotation with the flips, Fit, and a collapsed Crop. ── */
export function TransformSection({
	layout,
	kind,
	onChange,
	sourceEditing = true,
	keying,
}: {
	layout: ClipLayout | undefined;
	kind: ClipKind;
	onChange: (patch: Partial<ClipLayout>) => void;
	sourceEditing?: boolean;
	/** Row key controls; absent where the clip cannot be animated. */
	keying?: RowKeying;
}): JSX.Element {
	const L = normalizeLayout(layout, kind);
	const isText = kind === "text",
		locked = Boolean(L.aspectLocked);
	const parsedCrop = sourceCropSchema.safeParse(L.crop);
	const crop = parsedCrop.success ? parsedCrop.data : FULL_SOURCE_CROP;
	/* Locked, width drives: a width edit (static or keyed) moves height by the ratio of the values shown. */
	const lockedKeys = locked
		? (v: number, current: Partial<Record<NumericAnimationProperty, number>>) =>
				canvasSizePatchOf(
					{
						...L,
						widthPct: current.widthPct ?? L.widthPct,
						heightPct: current.heightPct ?? L.heightPct,
						aspectLocked: true,
					},
					"widthPct",
					v,
				)
		: undefined;
	const size = { suffix: "%", min: 4, max: 200, step: 1 };
	return (
		<>
			<AccordionSection label="Position & Size" defaultOpen>
				<KeyedFieldRow
					label="Position"
					keying={keying}
					cells={[
						{
							property: "xPct",
							label: "X offset",
							short: "X",
							value: L.xPct,
							setStatic: (v) => onChange({ xPct: v }),
							suffix: "%",
							min: -50,
							max: 150,
							step: 1,
						},
						{
							property: "yPct",
							label: "Y offset",
							short: "Y",
							value: L.yPct,
							setStatic: (v) => onChange({ yPct: v }),
							suffix: "%",
							min: -50,
							max: 150,
							step: 1,
						},
					]}
				/>
				<KeyedFieldRow
					label="Size"
					keying={keying}
					cells={[
						{
							property: "widthPct",
							label: "Width",
							short: "W",
							value: L.widthPct,
							setStatic: (v) => onChange(canvasSizePatchOf(L, "widthPct", v)),
							keys: lockedKeys,
							...size,
						},
						<IconButton
							key="lock"
							size="xs"
							aria-label="Lock aspect ratio"
							aria-pressed={locked}
							title={locked ? "Unlock aspect ratio" : "Lock aspect ratio"}
							onClick={() => onChange({ aspectLocked: !locked })}
						>
							{locked ? Ic.lock(ICON.xs) : Ic.lockOpen(ICON.xs)}
						</IconButton>,
						{
							property: "heightPct",
							label: "Height",
							short: "H",
							value: L.heightPct ?? 100,
							setStatic: (v) => onChange(canvasSizePatchOf(L, "heightPct", v)),
							disabled: locked,
							...size,
						},
					]}
				/>
				<KeyedFieldRow
					label="Rotation"
					keying={keying}
					cells={[
						{
							property: "rotationDeg",
							label: "Rotation",
							short: "R",
							value: L.rotationDeg ?? 0,
							setStatic: (v) => onChange({ rotationDeg: v }),
							suffix: "°",
							min: -180,
							max: 180,
							step: 1,
						},
						...(!isText && sourceEditing
							? [
									<Toggle
										key="fx"
										aria-label="Flip horizontal"
										pressed={Boolean(L.flipX)}
										onPressedChange={(flipX) => onChange({ flipX })}
									>
										{Ic.flipHorizontal(ICON.xs)}
									</Toggle>,
									<Toggle
										key="fy"
										aria-label="Flip vertical"
										pressed={Boolean(L.flipY)}
										onPressedChange={(flipY) => onChange({ flipY })}
									>
										{Ic.flipVertical(ICON.xs)}
									</Toggle>,
								]
							: []),
					]}
				/>
				{!isText && <FitRow fit={L.fit} onChange={(fit) => onChange({ fit })} />}
			</AccordionSection>
			{!isText && sourceEditing && (
				<InspectorSection
					title="Crop"
					collapsible
					action={
						<Button variant="ghost" size="xs" onClick={() => onChange({ crop: undefined })}>
							Reset crop
						</Button>
					}
				>
					<FieldRow
						label="Crop position"
						onReset={() => onChange({ crop: { ...crop, xPct: 0, yPct: 0 } })}
					>
						<AmountField
							label="Crop X"
							short="X"
							suffix="%"
							value={crop.xPct}
							min={0}
							max={100 - crop.widthPct}
							onChange={(xPct) => onChange({ crop: { ...crop, xPct } })}
						/>
						<AmountField
							label="Crop Y"
							short="Y"
							suffix="%"
							value={crop.yPct}
							min={0}
							max={100 - crop.heightPct}
							onChange={(yPct) => onChange({ crop: { ...crop, yPct } })}
						/>
					</FieldRow>
					<FieldRow
						label="Crop size"
						onReset={() =>
							onChange({ crop: { ...crop, widthPct: 100 - crop.xPct, heightPct: 100 - crop.yPct } })
						}
					>
						<AmountField
							label="Crop width"
							short="W"
							suffix="%"
							value={crop.widthPct}
							min={1}
							max={100 - crop.xPct}
							onChange={(widthPct) => onChange({ crop: { ...crop, widthPct } })}
						/>
						<AmountField
							label="Crop height"
							short="H"
							suffix="%"
							value={crop.heightPct}
							min={1}
							max={100 - crop.yPct}
							onChange={(heightPct) => onChange({ crop: { ...crop, heightPct } })}
						/>
					</FieldRow>
				</InspectorSection>
			)}
		</>
	);
}

/** Blending: how the clip composites over what is beneath it, opacity and blend mode
 *  in one row. `blend` is the blend-mode control where the kind has one. */
export function BlendingSection({
	layout,
	kind,
	onChange,
	keying,
	blend,
}: {
	layout: ClipLayout | undefined;
	kind: ClipKind;
	onChange: (patch: Partial<ClipLayout>) => void;
	keying?: RowKeying;
	blend?: ReactNode;
}): JSX.Element {
	const L = normalizeLayout(layout, kind);
	return (
		<AccordionSection label="Blending" defaultOpen>
			<KeyedFieldRow
				label="Opacity"
				keying={keying}
				cells={[
					{
						property: "opacity",
						label: "Opacity",
						short: "α",
						value: L.opacity ?? 1,
						setStatic: (v) => onChange({ opacity: v }),
						suffix: "%",
						min: 0,
						max: 100,
						step: 1,
						scale: 100,
					},
					...(blend ? [<Fragment key="blend">{blend}</Fragment>] : []),
				]}
			/>
		</AccordionSection>
	);
}

/** Source playback (rate, reverse), part of Timing. `control` is the processed-source
 *  editor where the clip has one; otherwise plain rate and reverse rows. */
export function PlaybackSection({
	layout,
	kind,
	onChange,
	control,
}: {
	layout: ClipLayout | undefined;
	kind: ClipKind;
	onChange: (patch: Partial<ClipLayout>) => void;
	control?: ReactNode;
}): JSX.Element {
	const L = normalizeLayout(layout, kind);
	return (
		<AccordionSection label="Playback" defaultOpen>
			{control ?? <PlaybackRow layout={L} onChange={onChange} />}
		</AccordionSection>
	);
}
