import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatMessage, ToolCall } from "@design-system/patterns/chat.tsx";

/* One entry in a conversation, and one tool the assistant used. Flat: neither
 * is a card. */
const meta = {
	title: "Patterns/Chat",
	component: ChatMessage,
	args: { speaker: "user", children: "Draft a three-beat fixture story." },
	decorators: [
		(Story) => (
			<div className="tw:flex tw:w-96 tw:flex-col tw:gap-2 tw:bg-background tw:p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ChatMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const User: Story = {};
export const Assistant: Story = {
	args: {
		speaker: "assistant",
		children: "Tightened the hook and moved the stat callout to the second beat.",
	},
};
export const AssistantHeld: Story = {
	args: { speaker: "assistant", held: "Proposed, not applied", children: "Rewrote slide two." },
};
export const LongUserMessage: Story = {
	args: {
		children:
			"A long instruction that wraps across several lines so the bubble's width cap and the wrapping of an unbroken-url-like-token-that-has-no-spaces can be seen.",
	},
};

export const ToolCalls: Story = {
	render: () => (
		<>
			<ToolCall name="patch scene" status="running" />
			<ToolCall name="generate image" status="done" note="2 frames generated" />
			<ToolCall
				name="patch scene"
				status="error"
				note="Planning timed out: the planner did not answer in time."
			/>
		</>
	),
};
