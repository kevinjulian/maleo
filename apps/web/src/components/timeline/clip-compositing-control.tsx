import { useState } from "react";
import {
	CLIP_BLEND_MODES,
	clipCompositingBlockers,
	normalizeSceneClips,
	fromTimelineDoc,
	type ClipLayout,
	type ClipMask,
} from "@maleo/shared";
import {
	canvasClipLayout,
	patchCanvasLayout,
	type CanvasTarget,
} from "@models/timeline/canvas-transform.ts";
import {
	useDocumentSelector,
	type TimelineDocumentStore,
} from "@stores/timeline-document-store.ts";
import { useChromeField, type EditorChromeStore } from "@stores/editor-chrome-store.ts";
import type { DocumentWriters } from "@stores/document-writers.ts";
import { FieldRow, InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Toggle } from "@design-system/components/toggle-group.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { NumberField } from "@design-system/components/number-field.tsx";
import { Select, onSelect } from "@design-system/components/select.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Note } from "@design-system/components/note.tsx";

const DEFAULT_MASK: ClipMask = {
	shape: "rectangle",
	xPct: 25,
	yPct: 25,
	widthPct: 50,
	heightPct: 50,
	rotationDeg: 0,
	featherPct: 0,
	inverted: false,
};
const NEUTRAL_COLOR = { brightness: 1, contrast: 1, saturation: 1 };

/** Which slice of compositing a group shows: Masks, Blending's blend mode, or Adjust. */
export type CompositingPart = "mask" | "blend" | "color";

/** Pure feature controls also supply the Storybook contract fixture (all parts by default).
 *  `inline` renders the blend part as a bare select for Blending's opacity row. */
export function ClipCompositingFields({
	layout,
	onChange,
	onEditMask,
	maskEditing = false,
	disabled = false,
	error,
	beginGesture,
	endGesture,
	parts = ["mask", "blend", "color"],
	inline = false,
}: {
	layout?: Partial<ClipLayout>;
	onChange: (patch: Partial<ClipLayout>) => void;
	onEditMask?: () => void;
	maskEditing?: boolean;
	disabled?: boolean;
	error?: string | null;
	beginGesture?: () => void;
	endGesture?: () => void;
	parts?: readonly CompositingPart[];
	inline?: boolean;
}) {
	const mask = layout?.mask,
		color = layout?.color ?? NEUTRAL_COLOR;
	const [maskLocked, setMaskLocked] = useState(false);
	const maskField = (
		key: "xPct" | "yPct" | "widthPct" | "heightPct" | "rotationDeg" | "featherPct",
		label: string,
		short: string,
		min: number,
		max: number,
		write?: (value: number) => Partial<ClipMask>,
		locked = false,
	) =>
		mask && (
			<NumberField
				aria-label={label}
				icon={short}
				value={mask[key]}
				min={min}
				max={max}
				step={1}
				suffix={key === "rotationDeg" ? "°" : "%"}
				disabled={disabled || locked}
				onFocus={beginGesture}
				onBlur={endGesture}
				onScrubEnd={endGesture}
				onValueChange={(value) =>
					onChange({ mask: { ...mask, ...(write ? write(value) : { [key]: value }) } })
				}
			/>
		);
	/* A locked mask keeps its ratio, inside the frame, with width driving and height
	   following. The lock is editor state only. */
	const lockedWidth =
		maskLocked && mask
			? (width: number) => {
					const ratio = mask.heightPct / mask.widthPct;
					const k = Math.min(1, (100 - mask.xPct) / width, (100 - mask.yPct) / (width * ratio));
					return { widthPct: width * k, heightPct: width * ratio * k };
				}
			: undefined;
	const blendSelect = (
		<Select
			size="xs"
			aria-label="Blend mode"
			disabled={disabled}
			value={layout?.blendMode ?? "normal"}
			onValueChange={onSelect(CLIP_BLEND_MODES, (blendMode) => onChange({ blendMode }))}
			phoneBreakpoint={860}
			options={[...(CLIP_BLEND_MODES.map((mode) => ({ value: mode, label: mode })) ?? [])]}
		/>
	);
	if (inline)
		return (
			<>
				{blendSelect}
				{error && <Note tone="error">{error}</Note>}
			</>
		);
	return (
		<>
			{parts.includes("mask") && (
				<InspectorSection title="Mask" collapsible defaultOpen>
					<FieldRow label="Shape">
						<Select
							size="xs"
							aria-label="Mask shape"
							disabled={disabled}
							value={mask?.shape ?? "none"}
							onValueChange={onSelect(["none", "rectangle", "ellipse"] as const, (shape) =>
								onChange({
									mask: shape === "none" ? null : { ...(mask ?? DEFAULT_MASK), shape },
								}),
							)}
							phoneBreakpoint={860}
							options={[
								{ value: "none", label: "None" },
								{ value: "rectangle", label: "Rectangle" },
								{ value: "ellipse", label: "Ellipse" },
							]}
						/>
						{mask && (
							<Toggle
								aria-label="Invert mask"
								title="Invert mask"
								disabled={disabled}
								pressed={mask.inverted}
								onPressedChange={(inverted) => onChange({ mask: { ...mask, inverted } })}
							>
								{Ic.swap(ICON.xs)}
							</Toggle>
						)}
					</FieldRow>
					{mask && (
						<>
							<FieldRow
								label="Position"
								onReset={() =>
									onChange({
										mask: {
											...mask,
											xPct: Math.min(DEFAULT_MASK.xPct, 100 - mask.widthPct),
											yPct: Math.min(DEFAULT_MASK.yPct, 100 - mask.heightPct),
										},
									})
								}
							>
								{maskField("xPct", "Mask X", "X", 0, 100 - mask.widthPct)}
								{maskField("yPct", "Mask Y", "Y", 0, 100 - mask.heightPct)}
							</FieldRow>
							<FieldRow
								label="Size"
								onReset={() =>
									onChange({
										mask: {
											...mask,
											widthPct: Math.min(DEFAULT_MASK.widthPct, 100 - mask.xPct),
											heightPct: Math.min(DEFAULT_MASK.heightPct, 100 - mask.yPct),
										},
									})
								}
							>
								{maskField("widthPct", "Mask width", "W", 0.01, 100 - mask.xPct, lockedWidth)}
								<IconButton
									size="xs"
									aria-label="Lock mask aspect ratio"
									aria-pressed={maskLocked}
									disabled={disabled}
									onClick={() => setMaskLocked(!maskLocked)}
								>
									{maskLocked ? Ic.lock(ICON.xs) : Ic.lockOpen(ICON.xs)}
								</IconButton>
								{maskField(
									"heightPct",
									"Mask height",
									"H",
									0.01,
									100 - mask.yPct,
									undefined,
									maskLocked,
								)}
							</FieldRow>
							<FieldRow
								label="Rotation and feather"
								onReset={() => onChange({ mask: { ...mask, rotationDeg: 0, featherPct: 0 } })}
							>
								{maskField("rotationDeg", "Mask rotation", "R", -180, 180)}
								{maskField("featherPct", "Mask feather", "F", 0, 50)}
							</FieldRow>
							{onEditMask && (
								<Button size="sm" disabled={disabled} onClick={onEditMask}>
									{maskEditing ? "Finish mask editing" : "Edit mask on canvas"}
								</Button>
							)}
							<Button size="sm" disabled={disabled} onClick={() => onChange({ mask: null })}>
								Remove mask
							</Button>
							<Button
								size="sm"
								disabled={disabled}
								onClick={() => onChange({ mask: { ...DEFAULT_MASK, shape: mask.shape } })}
							>
								Reset mask
							</Button>
						</>
					)}
					{error && <Note tone="error">{error}</Note>}
				</InspectorSection>
			)}
			{parts.includes("blend") && (
				<InspectorSection title="Blend" collapsible defaultOpen>
					<FieldRow label="Blend mode" onReset={() => onChange({ blendMode: "normal" })}>
						{blendSelect}
					</FieldRow>
					{error && !parts.includes("mask") && <Note tone="error">{error}</Note>}
				</InspectorSection>
			)}
			{parts.includes("color") && (
				<InspectorSection title="Color adjustment" collapsible defaultOpen>
					<FieldRow label="Adjust" onReset={() => onChange({ color: NEUTRAL_COLOR })}>
						{(["brightness", "contrast", "saturation"] as const).map((key) => (
							<NumberField
								key={key}
								aria-label={key}
								icon={key[0]!.toUpperCase()}
								suffix="%"
								value={color[key] * 100}
								min={0}
								max={key === "saturation" ? 300 : 200}
								step={1}
								disabled={disabled}
								onFocus={beginGesture}
								onBlur={endGesture}
								onScrubEnd={endGesture}
								onValueChange={(value) => onChange({ color: { ...color, [key]: value / 100 } })}
							/>
						))}
					</FieldRow>
					<Button size="sm" disabled={disabled} onClick={() => onChange({ color: NEUTRAL_COLOR })}>
						Reset color adjustment
					</Button>
					{error && parts.length === 1 && <Note tone="error">{error}</Note>}
				</InspectorSection>
			)}
		</>
	);
}

export function ClipCompositingControl({
	target: requested,
	store,
	writers,
	chromeStore,
	parts,
	inline = false,
}: {
	target: CanvasTarget;
	store: TimelineDocumentStore;
	writers: DocumentWriters;
	chromeStore: EditorChromeStore;
	parts?: readonly CompositingPart[];
	/** The bare blend select for Blending's opacity row; the scene visual follows the current choice. */
	inline?: boolean;
}) {
	const doc = useDocumentSelector(store, (value) => value.getDoc());
	const [choice, setChoice] = useChromeField(chromeStore, "clipKeyVisual"),
		[maskEditing, setMaskEditing] = useChromeField(chromeStore, "clipMaskEditing");
	const [, setBottomSheet] = useChromeField(chromeStore, "bottomSheet");
	const [error, setError] = useState<string | null>(null);
	const scene =
		requested.source === "scene"
			? fromTimelineDoc(doc).scenes.find((s) => s.id === requested.id)
			: undefined;
	const visuals = scene && normalizeSceneClips(scene).visualClips;
	const visual =
		visuals?.find((v) => choice?.sceneId === scene?.id && choice?.visualId === v.id) ??
		visuals?.find((v) => v.primary) ??
		visuals?.[0];
	const target = visual ? { ...requested, visualId: visual.id } : requested;
	const resolved = canvasClipLayout(doc, target);
	const write = (patch: Partial<ClipLayout>) => {
		const issues = clipCompositingBlockers({ layout: patch });
		if (issues.length) {
			setError(issues.join(" "));
			return;
		}
		writers.mutate((live) => patchCanvasLayout(live, target, patch));
		setError(null);
		if ("mask" in patch && !patch.mask) setMaskEditing(false);
	};
	return (
		<>
			{!inline && scene && visuals && visuals.length > 1 && (
				<InspectorSection title="Compositing source">
					<PropertyRow label="Visual source">
						<Select
							size="xs"
							value={visual?.id}
							onValueChange={(event) => {
								setChoice({
									sceneId: scene.id,
									visualId: event,
								});
								setMaskEditing(false);
								setError(null);
							}}
							aria-label={"Visual source"}
							phoneBreakpoint={860}
							options={[...(visuals.map((v) => ({ value: v.id, label: v.label || v.id })) ?? [])]}
						/>
					</PropertyRow>
				</InspectorSection>
			)}
			<ClipCompositingFields
				layout={resolved.layout}
				parts={parts}
				inline={inline}
				onChange={write}
				error={error}
				maskEditing={maskEditing}
				beginGesture={writers.beginGesture}
				endGesture={writers.endGesture}
				onEditMask={() => {
					if (visual && scene) setChoice({ sceneId: scene.id, visualId: visual.id });
					setMaskEditing(!maskEditing);
					setBottomSheet("none");
				}}
			/>
		</>
	);
}
