import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ToolbarAction } from "@design-system/patterns/toolbar.tsx";
import { TransportControls } from "@design-system/patterns/transport.tsx";

/* Play or pause, and the playhead against the duration. The surface owns the
 * clock; this draws it. */
const meta = {
	title: "Patterns/TransportControls",
	component: TransportControls,
	args: { playing: false, onTogglePlay: () => {}, currentSec: 4.5, durationSec: 183 },
	decorators: [
		(Story) => (
			<div className="tw:flex tw:items-center tw:gap-3 tw:border tw:border-border tw:bg-background tw:p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof TransportControls>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Paused: Story = {};
export const Playing: Story = { args: { playing: true } };
export const NotReady: Story = { args: { disabled: true, currentSec: 0, durationSec: 0 } };
export const WithNeighbours: Story = {
	args: {
		before: (
			<>
				<ToolbarAction label="Playback speed" onAction={() => {}}>
					1×
				</ToolbarAction>
				<ToolbarAction label="Jump to start" icon={Ic.chevR(ICON.sm)} onAction={() => {}} />
			</>
		),
		after: <ToolbarAction label="Jump to end" icon={Ic.chevR(ICON.sm)} onAction={() => {}} />,
	},
};
