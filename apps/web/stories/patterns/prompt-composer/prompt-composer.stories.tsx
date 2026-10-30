import { useState, type ComponentProps } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ChipButton } from "@design-system/components/chip.tsx";
import { PromptComposer } from "@design-system/patterns/prompt-composer.tsx";
import { Select } from "@design-system/components/select.tsx";

/* Write a prompt and send it. Enter sends, Shift+Enter adds a line, and the
 * Enter that confirms an input-method candidate does neither. */
const meta = {
	title: "Patterns/PromptComposer",
	component: PromptComposer,
	args: {
		label: "Instruction",
		value: "",
		onValueChange: () => {},
		onSubmit: () => {},
		submitLabel: "Send",
		placeholder: "Describe a change",
	},
	decorators: [
		(Story) => (
			<div className="tw:w-96 tw:bg-background tw:p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PromptComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const Ready: Story = { args: { value: "Make the opening punchier" } };
export const Busy: Story = {
	args: {
		value: "A lighthouse at dusk",
		busy: true,
		disabled: true,
		submitLabel: "Generate image",
		busyLabel: "Generating image",
	},
};
export const Unavailable: Story = {
	args: { disabled: true, placeholder: "Select a workspace first" },
};
export const WithContextAndTools: Story = {
	args: {
		value: "A lighthouse at dusk",
		elevated: true,
		context: (
			<span className="tw:text-[length:var(--type-label-size)] tw:text-muted-foreground">
				About Fixture opening
			</span>
		),
		tools: (
			<>
				<ChipButton variant="inline">{Ic.image(ICON.sm)} 2 refs</ChipButton>
				<ChipButton variant="inline">9:16</ChipButton>
			</>
		),
	},
};

export const WithModelOption: Story = {
	args: {
		elevated: true,
		value: "Make the opening shorter",
		tools: (
			<Select
				aria-label="Chat model"
				width="auto"
				options={[{ value: "fixture-text", label: "Fixture Text" }]}
				value="fixture-text"
			/>
		),
	},
};

/* The draft is the caller's: sending does not clear it until the caller does. */
export const KeepsDraftUntilAccepted: Story = {
	render: (args) => <KeepsDraftDemo {...args} />,
};

function KeepsDraftDemo(args: ComponentProps<typeof PromptComposer>) {
	const [value, setValue] = useState("Type, press Enter: the text stays");
	const [sent, setSent] = useState(0);
	return (
		<PromptComposer
			{...args}
			value={value}
			onValueChange={setValue}
			onSubmit={() => setSent((n) => n + 1)}
			context={
				<span className="tw:text-[length:var(--type-label-size)] tw:text-muted-foreground">
					Sent {sent} times
				</span>
			}
		/>
	);
}
