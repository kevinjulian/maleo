import type { Meta, StoryObj } from "@storybook/react-vite";
import { Switch } from "@design-system/components/switch.tsx";

const meta = {
	title: "Components/Switch",
	component: Switch,
	args: { "aria-label": "Enable captions" },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Off: Story = {};
export const On: Story = { args: { defaultChecked: true } };
export const Disabled: Story = { args: { disabled: true } };
export const DisabledOn: Story = { args: { disabled: true, defaultChecked: true } };
/* The editor step, beside 24px editor fields. */
export const Small: Story = { args: { size: "sm" } };
export const SmallOn: Story = { args: { size: "sm", defaultChecked: true } };
