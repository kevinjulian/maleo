import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Input } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
const OPTIONS = ["16:9", "9:16", "1:1"].map((value) => ({ value, label: value }));
const meta = {
	title: "Components/Select",
	component: Select,
	args: { "aria-label": "Aspect ratio", defaultValue: "9:16", options: OPTIONS },
} satisfies Meta<typeof Select>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Form: Story = { args: { size: "md" } };
export const EditorField: Story = { args: { size: "xs", phoneBreakpoint: 860 } };
export const AutoWidth: Story = { args: { width: "auto" } };
export const Disabled: Story = { args: { disabled: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
export const Unavailable: Story = { args: { value: "4:3" } };
export const Empty: Story = { args: { options: [] } };
export const RichOptions: Story = {
	args: {
		options: OPTIONS.map((option, index) => ({
			...option,
			icon: Ic.rect(ICON.md),
			description: `Output ${option.label}`,
			group: index < 2 ? "Video" : "Square",
			disabled: index === 2,
		})),
	},
};
export const LongList: Story = {
	args: {
		options: Array.from({ length: 60 }, (_, index) => ({
			value: String(index),
			label: `Choice ${index}`,
		})),
	},
};
export const BesideInput: Story = {
	render: () => (
		<form className="tw:flex tw:max-w-md tw:gap-2">
			<Input aria-label="Title" defaultValue="Launch teaser" />
			<Select
				name="aspect"
				size="md"
				aria-label="Aspect ratio"
				width="auto"
				defaultValue="9:16"
				options={OPTIONS}
			/>
		</form>
	),
};
function DynamicChoice() {
	const [value, setValue] = useState("mixed");
	return (
		<Select
			aria-label="Easing"
			value={value}
			onValueChange={setValue}
			options={[
				...(value === "mixed" ? [{ value: "mixed", label: "Mixed", disabled: true }] : []),
				{ value: "linear", label: "Linear" },
				{ value: "in", label: "Ease in" },
				{ value: "hold", label: "Hold" },
			]}
		/>
	);
}
export const DynamicOptions: Story = { render: () => <DynamicChoice /> };
