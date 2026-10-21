import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Toggle, ToggleGroup, ToggleGroupItem } from "@design-system/components/toggle-group.tsx";

/* Canonical. ToggleGroup is a segmented single choice that always keeps one
 * option pressed; Toggle is one on/off flag. Pressed is the selection role. */
function FitGroup({ size = "xs", disabled = false }: { size?: "xs" | "sm"; disabled?: boolean }) {
	const [fit, setFit] = useState("cover");
	return (
		<ToggleGroup
			aria-label="Fit"
			value={fit}
			onValueChange={setFit}
			size={size}
			disabled={disabled}
		>
			{["contain", "cover", "stretch"].map((f) => (
				<ToggleGroupItem key={f} value={f}>
					{f}
				</ToggleGroupItem>
			))}
		</ToggleGroup>
	);
}

const meta = { title: "Components/ToggleGroup", component: FitGroup } satisfies Meta<
	typeof FitGroup
>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Segmented: Story = {
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(canvas.getByRole("button", { name: "stretch" }));
		await expect(canvas.getByRole("button", { name: "stretch" })).toHaveAttribute(
			"aria-pressed",
			"true",
		);
		await expect(canvas.getByRole("button", { name: "cover" })).toHaveAttribute(
			"aria-pressed",
			"false",
		);
	},
};
export const Toolbar: Story = { args: { size: "sm" } };
export const Disabled: Story = { args: { disabled: true } };

function AlignGroup() {
	const [align, setAlign] = useState("left");
	return (
		<ToggleGroup aria-label="Text align" value={align} onValueChange={setAlign}>
			<ToggleGroupItem value="left">{Ic.list(ICON.sm)} Left</ToggleGroupItem>
			<ToggleGroupItem value="center">Center</ToggleGroupItem>
			<ToggleGroupItem value="right">Right</ToggleGroupItem>
		</ToggleGroup>
	);
}
export const WithIcon: Story = { render: () => <AlignGroup /> };

function ReverseToggle() {
	const [on, setOn] = useState(false);
	return (
		<Toggle pressed={on} onPressedChange={setOn}>
			{Ic.repeat(ICON.sm)} Reverse
		</Toggle>
	);
}
export const SingleToggle: Story = { render: () => <ReverseToggle /> };
