import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "@design-system/components/input.tsx";
import { ML } from "@design-system/components/field-label.tsx";

/* The small uppercase field label on editor surfaces. */
const meta = {
	title: "Components/FieldLabel",
	component: ML,
	args: { children: "Comparison" },
	decorators: [
		(Story) => (
			<div className="tw:max-w-xs">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ML>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	render: (args) => (
		<>
			<ML {...args} htmlFor="ml-default" />
			<Input id="ml-default" defaultValue="vs the fixture baseline" />
		</>
	),
};
export const Flush: Story = {
	render: (args) => (
		<>
			<ML {...args} flush htmlFor="ml-flush" />
			<Input id="ml-flush" defaultValue="vs the fixture baseline" />
		</>
	),
};
