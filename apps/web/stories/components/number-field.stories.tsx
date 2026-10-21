import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { NumberField, type NumberFieldProps } from "@design-system/components/number-field.tsx";

/* Ported from OpenCut classic (MIT). Drag the prefix left or right to scrub
 * one step per pixel; type or use the arrow keys to edit. */
function Harness({
	initial,
	...props
}: Omit<NumberFieldProps, "value" | "onValueChange"> & { initial: number }) {
	const [value, setValue] = useState(initial);
	return (
		<div className="tw:w-40">
			<NumberField {...props} value={value} onValueChange={setValue} />
		</div>
	);
}

const meta = {
	title: "Components/NumberField",
	component: Harness,
	args: { initial: 50, "aria-label": "X offset", icon: "X", suffix: "%" },
} satisfies Meta<typeof Harness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LetterPrefix: Story = {};
export const GlyphPrefix: Story = {
	args: {
		initial: 15,
		"aria-label": "Rotation",
		icon: Ic.regen(ICON.xs),
		suffix: "°",
		min: -180,
		max: 180,
	},
};
export const FineStep: Story = {
	args: {
		initial: 1.5,
		"aria-label": "Fade out",
		icon: undefined,
		suffix: "s",
		step: 0.1,
		min: 0,
		max: 5,
	},
};
export const NoAffixes: Story = {
	args: { initial: 42, "aria-label": "Value", icon: undefined, suffix: undefined },
};
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
