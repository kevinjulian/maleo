import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { PanelHeader } from "@design-system/patterns/panel-header.tsx";

/* Names a panel and places its actions and close. `panel` for rail panels and
 * sheets; `compact` for an inspector column or a popover. */
const meta = {
	title: "Patterns/PanelHeader",
	component: PanelHeader,
	args: { title: "Captions", onClose: () => {}, closeLabel: "Hide panel" },
	decorators: [
		(Story) => (
			<div className="tw:w-80 tw:border tw:border-border tw:bg-background">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PanelHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Panel: Story = {};
export const Tool: Story = { args: { density: "tool", title: "Assets" } };
export const NotClosable: Story = { args: { title: "Inspector", onClose: undefined } };
export const WithActions: Story = {
	args: {
		title: "Audit",
		closeLabel: "Close audit",
		actions: (
			<IconButton size="xs" aria-label="Refresh">
				{Ic.regen(ICON.md)}
			</IconButton>
		),
	},
};
export const Compact: Story = {
	args: { density: "compact", title: "Edit timeline item", closeLabel: "Close" },
};
export const CompactWithContext: Story = {
	args: {
		density: "compact",
		title: "Scene · Fixture opening",
		sub: "Transform properties",
		onClose: undefined,
		actions: (
			<IconButton size="xs" aria-label="Show selected clip in chat">
				{Ic.chat(ICON.sm)}
			</IconButton>
		),
	},
};
export const LongTitle: Story = {
	args: { title: "A panel whose title is far too long to fit in a rail" },
};
