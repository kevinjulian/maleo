import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Slider } from "@design-system/components/slider.tsx";

function Controlled({ initial = 72, disabled = false }: { initial?: number; disabled?: boolean }) {
	const [value, setValue] = useState(initial);
	return (
		<div className="tw:flex tw:w-60 tw:items-center tw:gap-2 tw:text-xs">
			<Slider
				aria-label="Volume"
				min={0}
				max={100}
				value={value}
				disabled={disabled}
				onChange={(e) => setValue(Number(e.target.value))}
			/>
			<span className="tw:w-8 tw:tabular-nums">{value}</span>
		</div>
	);
}

const meta = {
	title: "Components/Slider",
	component: Controlled,
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Empty: Story = { args: { initial: 0 } };
export const Full: Story = { args: { initial: 100 } };
export const Disabled: Story = { args: { disabled: true } };
export const Uncontrolled: Story = {
	render: () => (
		<div className="tw:w-60">
			<Slider aria-label="Rotation" min={-180} max={180} defaultValue={45} />
		</div>
	),
};
