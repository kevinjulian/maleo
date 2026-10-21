import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	AmountField,
	FieldRow,
	InspectorSection,
	PropertyRow,
} from "@design-system/patterns/inspector.tsx";
import { Toggle } from "@design-system/components/toggle-group.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Button } from "@design-system/components/button.tsx";
import { INSPECTOR_WIDTHS, InspectorFrame, type InspectorWidth } from "./inspector-frame.tsx";

/* Whole inspector categories rebuilt from the patterns, to prove they compose.
 *
 * The properties, ranges and defaults are the production ones:
 *   Transform  `TransformSection` in components/timeline/clip-canvas.tsx
 *   Audio      `AudioControls` in the same file
 * Story state stands in for the feature: the patterns take values and
 * callbacks and own none of them. */

type Layout = {
	xPct: number;
	yPct: number;
	widthPct: number;
	heightPct: number;
	fit: string;
	opacity: number;
	rotationDeg: number;
	playbackRate: number;
	reverse: boolean;
};
const DEFAULT_LAYOUT: Layout = {
	xPct: 0,
	yPct: 0,
	widthPct: 100,
	heightPct: 100,
	fit: "cover",
	opacity: 100,
	rotationDeg: 0,
	playbackRate: 100,
	reverse: false,
};

function TransformInspector() {
	const [L, setL] = useState(DEFAULT_LAYOUT);
	const [crop, setCrop] = useState({
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		flipX: false,
		flipY: false,
	});
	const set = (patch: Partial<Layout>) => setL((prev) => ({ ...prev, ...patch }));
	const reset = (key: keyof Layout) => () => set({ [key]: DEFAULT_LAYOUT[key] });
	return (
		<>
			<InspectorSection title="Position & Size" collapsible defaultOpen>
				<FieldRow label="Position">
					<AmountField
						label="X offset"
						short="X"
						suffix="%"
						min={-50}
						max={150}
						value={L.xPct}
						onChange={(xPct) => set({ xPct })}
					/>
					<AmountField
						label="Y offset"
						short="Y"
						suffix="%"
						min={-50}
						max={150}
						value={L.yPct}
						onChange={(yPct) => set({ yPct })}
					/>
				</FieldRow>
				<FieldRow label="Size">
					<AmountField
						label="Width"
						short="W"
						suffix="%"
						min={4}
						max={200}
						value={L.widthPct}
						onChange={(widthPct) => set({ widthPct })}
					/>
					<AmountField
						label="Height"
						short="H"
						suffix="%"
						min={4}
						max={200}
						value={L.heightPct}
						onChange={(heightPct) => set({ heightPct })}
					/>
				</FieldRow>
				<PropertyRow label="Fit">
					<Select
						size="xs"
						value={L.fit}
						onValueChange={(e) => set({ fit: e })}
						aria-label={"Fit"}
						options={[
							...(["contain", "cover", "stretch"].map((f) => ({ value: f, label: f })) ?? []),
						]}
					/>
				</PropertyRow>
			</InspectorSection>
			<InspectorSection title="Rotation" collapsible defaultOpen>
				<FieldRow label="Rotation" onReset={reset("rotationDeg")}>
					<AmountField
						label="Rotation"
						short="R"
						suffix="°"
						min={-180}
						max={180}
						value={L.rotationDeg}
						onChange={(rotationDeg) => set({ rotationDeg })}
					/>
					<Toggle
						aria-label="Flip horizontal"
						pressed={crop.flipX}
						onPressedChange={(flipX) => setCrop({ ...crop, flipX })}
					>
						{Ic.flipHorizontal(ICON.xs)}
					</Toggle>
					<Toggle
						aria-label="Flip vertical"
						pressed={crop.flipY}
						onPressedChange={(flipY) => setCrop({ ...crop, flipY })}
					>
						{Ic.flipVertical(ICON.xs)}
					</Toggle>
				</FieldRow>
				<FieldRow label="Opacity" onReset={reset("opacity")}>
					<AmountField
						label="Opacity"
						short="α"
						suffix="%"
						min={0}
						max={100}
						value={L.opacity}
						onChange={(opacity) => set({ opacity })}
					/>
				</FieldRow>
			</InspectorSection>
			<InspectorSection
				title="Crop"
				collapsible
				action={
					<Button
						variant="ghost"
						size="xs"
						onClick={() => setCrop({ ...crop, x: 0, y: 0, width: 100, height: 100 })}
					>
						Reset crop
					</Button>
				}
			>
				<FieldRow label="Crop position">
					<AmountField
						label="Crop X"
						short="X"
						suffix="%"
						min={0}
						max={100 - crop.width}
						value={crop.x}
						onChange={(x) => setCrop({ ...crop, x })}
					/>
					<AmountField
						label="Crop Y"
						short="Y"
						suffix="%"
						min={0}
						max={100 - crop.height}
						value={crop.y}
						onChange={(y) => setCrop({ ...crop, y })}
					/>
				</FieldRow>
				<FieldRow label="Crop size">
					<AmountField
						label="Crop width"
						short="W"
						suffix="%"
						min={1}
						max={100 - crop.x}
						value={crop.width}
						onChange={(width) => setCrop({ ...crop, width })}
					/>
					<AmountField
						label="Crop height"
						short="H"
						suffix="%"
						min={1}
						max={100 - crop.y}
						value={crop.height}
						onChange={(height) => setCrop({ ...crop, height })}
					/>
				</FieldRow>
			</InspectorSection>
			<InspectorSection title="Playback" collapsible>
				<FieldRow label="Playback" onReset={reset("playbackRate")}>
					<AmountField
						label="Rate"
						short="×"
						suffix="%"
						min={25}
						max={400}
						step={5}
						value={L.playbackRate}
						onChange={(playbackRate) => set({ playbackRate })}
					/>
					<Toggle
						aria-label="Reverse"
						pressed={L.reverse}
						onPressedChange={(reverse) => set({ reverse })}
					>
						{Ic.swap(ICON.xs)}
					</Toggle>
				</FieldRow>
			</InspectorSection>
		</>
	);
}

function AudioInspector() {
	const [a, setA] = useState({ volume: 72, duck: 35, fadeIn: 0, fadeOut: 1.5 });
	const set = (patch: Partial<typeof a>) => setA((prev) => ({ ...prev, ...patch }));
	return (
		<InspectorSection title="Clip audio" collapsible defaultOpen>
			<FieldRow label="Volume">
				<AmountField
					label="Volume"
					short="Vol"
					suffix="%"
					min={0}
					max={100}
					value={a.volume}
					onChange={(volume) => set({ volume })}
				/>
				<AmountField
					label="Under voice"
					short="Duck"
					suffix="%"
					min={0}
					max={100}
					value={a.duck}
					onChange={(duck) => set({ duck })}
				/>
			</FieldRow>
			<FieldRow label="Fades">
				<AmountField
					label="Fade in"
					short="In"
					suffix="s"
					min={0}
					max={5}
					step={0.1}
					value={a.fadeIn}
					onChange={(fadeIn) => set({ fadeIn })}
				/>
				<AmountField
					label="Fade out"
					short="Out"
					suffix="s"
					min={0}
					max={5}
					step={0.1}
					value={a.fadeOut}
					onChange={(fadeOut) => set({ fadeOut })}
				/>
			</FieldRow>
		</InspectorSection>
	);
}

const WIDTH_NAMES: InspectorWidth[] = ["docked", "rail", "narrow", "phone"];

const meta = {
	title: "Patterns/Inspector/Examples",
	component: InspectorFrame,
	args: { width: "docked", children: null },
	argTypes: { width: { control: "inline-radio", options: WIDTH_NAMES } },
} satisfies Meta<typeof InspectorFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Transform: Story = {
	render: (args) => (
		<InspectorFrame width={args.width}>
			<TransformInspector />
		</InspectorFrame>
	),
};

export const Audio: Story = {
	render: (args) => (
		<InspectorFrame width={args.width}>
			<AudioInspector />
		</InspectorFrame>
	),
};

/* Every width the inspector actually renders at, side by side. `narrow` is
 * below the row's container breakpoint, so its labels stack. */
export const Widths: Story = {
	parameters: { layout: "fullscreen" },
	render: () => (
		<div className="tw:flex tw:flex-wrap tw:items-start tw:gap-6 tw:p-4">
			{WIDTH_NAMES.map((w) => (
				<div key={w} className="tw:flex tw:flex-col tw:gap-2">
					<code className="tw:text-xs">
						{w} · {INSPECTOR_WIDTHS[w]}px
					</code>
					<InspectorFrame width={w}>
						<TransformInspector />
					</InspectorFrame>
				</div>
			))}
		</div>
	),
};
