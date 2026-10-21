import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { ChipButton } from "@design-system/components/chip.tsx";
import { SearchField } from "@design-system/components/search-field.tsx";
import { Slider } from "@design-system/components/slider.tsx";
import { Toolbar, ToolbarAction, ToolbarGroup } from "@design-system/patterns/toolbar.tsx";

/* The actions of one work region. Groups carry the rule between them; an
 * action is icon-only or labelled, a command or a toggle. */
const meta = {
	title: "Patterns/Toolbar",
	component: Toolbar,
	args: { label: "Timeline tools", children: null },
	decorators: [
		(Story) => (
			<div className="tw:border tw:border-border tw:bg-background tw:p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Toolbar>;

export default meta;
type Story = StoryObj<typeof meta>;
const noop = (): void => {};

export const Commands: Story = {
	render: () => (
		<Toolbar label="Timeline tools">
			<ToolbarGroup label="History">
				<ToolbarAction label="Undo" hint="Undo (⌘Z)" icon={Ic.regen(ICON.sm)} onAction={noop} />
				<ToolbarAction
					label="Redo"
					hint="Redo (⇧⌘Z)"
					icon={Ic.regen(ICON.sm)}
					disabled
					onAction={noop}
				/>
			</ToolbarGroup>
			<ToolbarGroup label="Edit">
				<ToolbarAction label="Split at playhead" icon={Ic.cut(ICON.sm)} onAction={noop} />
				<ToolbarAction label="Delete clip" icon={Ic.trash(ICON.sm)} danger onAction={noop} />
			</ToolbarGroup>
			<ToolbarGroup label="View">
				<ToolbarAction label="Organize range" icon={Ic.layers(ICON.xs)} onAction={noop}>
					Organize range
				</ToolbarAction>
				<ToolbarAction label="Pacing insights" icon={Ic.pulse(ICON.md)} on onAction={noop} />
				<ToolbarAction label="Beat grid" icon={Ic.music(ICON.md)} on={false} onAction={noop} />
			</ToolbarGroup>
		</Toolbar>
	),
};

export const LabelledStates: Story = {
	render: () => (
		<Toolbar label="States">
			<ToolbarGroup>
				<ToolbarAction label="Speed" onAction={noop}>
					1×
				</ToolbarAction>
				<ToolbarAction label="Speed" on onAction={noop}>
					1.5×
				</ToolbarAction>
				<ToolbarAction label="Export" busy onAction={noop}>
					Exporting
				</ToolbarAction>
				<ToolbarAction label="Export" disabled onAction={noop}>
					Export
				</ToolbarAction>
			</ToolbarGroup>
		</Toolbar>
	),
};

export const WithControl: Story = {
	render: () => (
		<Toolbar label="Timeline tools">
			<ToolbarGroup label="Timeline zoom">
				<ToolbarAction label="Zoom out" icon={Ic.zoomOut(ICON.sm)} onAction={noop} />
				<Slider
					className="tw:w-20"
					min={0}
					max={100}
					value={40}
					onChange={noop}
					aria-label="Timeline zoom"
				/>
				<ToolbarAction label="Zoom in" icon={Ic.zoomIn(ICON.sm)} onAction={noop} />
			</ToolbarGroup>
		</Toolbar>
	),
};

export const CollectionQuery: Story = {
	render: () => (
		<Toolbar label="Search and filter content">
			<SearchField label="Search content" value="" onValueChange={noop} />
			<ToolbarGroup label="Filter content by type">
				<ChipButton variant="inline" on>
					All
				</ChipButton>
				<ChipButton variant="inline">Video</ChipButton>
				<ChipButton variant="inline">Image</ChipButton>
			</ToolbarGroup>
		</Toolbar>
	),
};

/* Wraps; the group order holds and no rule dangles at the start of a line that
 * began with a non-group. */
export const Narrow: Story = {
	...Commands,
	decorators: [
		(Story) => (
			<div className="tw:w-56 tw:border tw:border-border tw:bg-background tw:p-2">
				<Story />
			</div>
		),
	],
};
