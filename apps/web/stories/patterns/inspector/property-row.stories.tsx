import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import {
	AmountField,
	FieldRow,
	InspectorSection,
	PropertyRow,
} from "@design-system/patterns/inspector.tsx";
import { Ic, ICON } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";
import { Switch } from "@design-system/components/switch.tsx";
import { InspectorFrame } from "./inspector-frame.tsx";

/* Each story is one row from a real inspector — the clip transform, the audio
 * fader, the data callout and the text style — inside the docked inspector
 * width. A row outside an InspectorSection has no container to measure, so
 * every story renders it inside one. */
function Frame({ children }: { children: React.ReactNode }) {
	return (
		<InspectorFrame>
			<InspectorSection title="Properties">{children}</InspectorSection>
		</InspectorFrame>
	);
}

function OpacityRow({ initial, onResetTo }: { initial: number; onResetTo?: number }) {
	const [value, setValue] = useState(initial);
	return (
		<FieldRow
			label="Opacity"
			onReset={onResetTo === undefined ? undefined : () => setValue(onResetTo)}
		>
			<AmountField
				label="Opacity"
				short="α"
				suffix="%"
				min={0}
				max={100}
				value={value}
				onChange={setValue}
			/>
		</FieldRow>
	);
}

function SizeRow() {
	const [size, setSize] = useState({ w: 50, h: 25 });
	const [locked, setLocked] = useState(true);
	const ratio = size.h / size.w;
	return (
		<FieldRow label="Size">
			<AmountField
				label="Width"
				short="W"
				suffix="%"
				value={size.w}
				onChange={(w) => setSize(locked ? { w, h: w * ratio } : { ...size, w })}
			/>
			<IconButton
				size="xs"
				aria-label="Lock size"
				aria-pressed={locked}
				onClick={() => setLocked(!locked)}
			>
				{Ic.lock(ICON.xs)}
			</IconButton>
			<AmountField
				label="Height"
				short="H"
				suffix="%"
				value={size.h}
				onChange={(h) => setSize(locked ? { w: h / ratio, h } : { ...size, h })}
			/>
		</FieldRow>
	);
}

const meta = {
	title: "Patterns/Inspector/PropertyRow",
	component: PropertyRow,
	decorators: [
		(Story) => (
			<Frame>
				<Story />
			</Frame>
		),
	],
	args: { label: "Title", children: null },
} satisfies Meta<typeof PropertyRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TextInput: Story = {
	render: () => (
		<PropertyRow label="Title">
			<Input size="xs" defaultValue="Fixture measure" />
		</PropertyRow>
	),
};

export const NumberInput: Story = {
	render: () => (
		<PropertyRow label="Rotation">
			<Input size="xs" type="number" defaultValue={0} min={-180} max={180} />
		</PropertyRow>
	),
};

export const Amount: Story = {
	render: () => <OpacityRow initial={100} />,
};

export const FieldRowPair: Story = {
	name: "FieldRow (Position)",
	render: () => (
		<FieldRow label="Position">
			<AmountField label="X offset" short="X" suffix="%" value={10} onChange={() => {}} />
			<AmountField label="Y offset" short="Y" suffix="%" value={20} onChange={() => {}} />
		</FieldRow>
	),
};

export const FieldRowLocked: Story = {
	name: "FieldRow (Size with lock)",
	render: () => <SizeRow />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const width = canvas.getByRole("spinbutton", { name: "Width" });
		await userEvent.clear(width);
		await userEvent.type(width, "60");
		await expect(canvas.getByRole("spinbutton", { name: "Height" })).toHaveValue(30);
	},
};

export const FieldRowTriple: Story = {
	name: "FieldRow (Adjust, three cells)",
	render: () => (
		<FieldRow label="Adjust" onReset={() => {}}>
			<AmountField label="brightness" short="B" suffix="%" value={100} onChange={() => {}} />
			<AmountField label="contrast" short="C" suffix="%" value={100} onChange={() => {}} />
			<AmountField label="saturation" short="S" suffix="%" value={100} onChange={() => {}} />
		</FieldRow>
	),
};

export const SelectControl: Story = {
	name: "Select",
	render: () => (
		<PropertyRow label="Fit">
			<Select
				size="xs"
				defaultValue="cover"
				aria-label={"Fit"}
				options={[...(["contain", "cover", "stretch"].map((v) => ({ value: v, label: v })) ?? [])]}
			/>
		</PropertyRow>
	),
};

export const Toggle: Story = {
	render: () => (
		<PropertyRow label="Reverse">
			<Switch size="sm" defaultChecked={false} />
		</PropertyRow>
	),
};

export const Compound: Story = {
	name: "Compound (Position)",
	render: () => (
		<PropertyRow label="Position" as="div">
			<Input size="xs" type="number" aria-label="X offset" defaultValue={50} />
			<Input size="xs" type="number" aria-label="Y offset" defaultValue={50} />
		</PropertyRow>
	),
};

export const WithResetAction: Story = {
	render: () => <OpacityRow initial={64} onResetTo={100} />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		/* Focus inside the row reveals the reset; the reveal is an opacity
		 * transition, so wait for it rather than asserting its first frame. */
		await userEvent.click(canvas.getByRole("spinbutton", { name: "Opacity" }));
		const reset = canvas.getByRole("button", { name: "Reset Opacity" });
		await waitFor(() => expect(reset).toBeVisible());
		await userEvent.click(reset);
		await expect(canvas.getByRole("spinbutton", { name: "Opacity" })).toHaveValue(100);
	},
};

export const Disabled: Story = {
	render: () => (
		<>
			<PropertyRow label="Font size" onReset={() => {}}>
				<Input size="xs" type="number" defaultValue={48} disabled />
			</PropertyRow>
			<PropertyRow label="Reverse">
				<Switch size="sm" disabled />
			</PropertyRow>
		</>
	),
};

export const Invalid: Story = {
	render: () => (
		<PropertyRow label="Value">
			<Input size="xs" defaultValue="forty-two" aria-invalid />
		</PropertyRow>
	),
};

export const LongLabel: Story = {
	render: () => (
		<>
			<PropertyRow label="Under voice ducking depth">
				<Input size="xs" type="number" defaultValue={35} />
			</PropertyRow>
			<PropertyRow label="Comparison baseline description shown under the value">
				<Input size="xs" defaultValue="vs the fixture baseline" />
			</PropertyRow>
		</>
	),
};

export const LongValue: Story = {
	render: () => (
		<>
			<PropertyRow label="Title">
				<Input
					size="xs"
					defaultValue="Quarterly recurring revenue measured against the trailing twelve month baseline"
				/>
			</PropertyRow>
			<PropertyRow label="Font">
				<Select
					size="xs"
					defaultValue="long"
					aria-label={"Font"}
					options={[{ value: "long", label: "Space Grotesk Display Condensed Semibold Italic" }]}
				/>
			</PropertyRow>
		</>
	),
};

export const AdjacentActions: Story = {
	render: () => (
		<PropertyRow
			label="Scale"
			as="div"
			actions={
				<>
					<IconButton size="xs" aria-label="Previous scale key" disabled>
						‹
					</IconButton>
					<Button size="xs" aria-label="Add scale key">
						◇ Key
					</Button>
					<IconButton size="xs" aria-label="Next scale key" disabled>
						›
					</IconButton>
				</>
			}
		>
			<Input size="xs" type="number" aria-label="Scale (%)" defaultValue={100} />
		</PropertyRow>
	),
};
