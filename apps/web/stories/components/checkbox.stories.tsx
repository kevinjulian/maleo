import type { Meta, StoryObj } from "@storybook/react-vite";
import { Checkbox } from "@design-system/components/checkbox.tsx";

const meta = {
	title: "Components/Checkbox",
	component: Checkbox,
	args: { "aria-label": "Include in scene" },
} satisfies Meta<typeof Checkbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Unchecked: Story = {};
export const Checked: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledChecked: Story = { args: { disabled: true, defaultChecked: true } };
export const Invalid: Story = { args: { "aria-invalid": true } };
/* The usual composition: the checkbox inside a label, so the text names it. */
export const WithLabel: Story = {
	render: (args) => (
		<label className="tw:inline-flex tw:items-center tw:gap-2 tw:text-sm">
			<Checkbox {...args} aria-label={undefined} />
			Include in scene
		</label>
	),
};
