import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { FrameAction, FrameActions, FrameBadge } from "@design-system/components/frame.tsx";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import { useState } from "react";
import { Button } from "@design-system/components/button.tsx";
import { Chip } from "@design-system/components/chip.tsx";
import { Progress } from "@design-system/components/progress.tsx";
import { Spinner } from "@design-system/components/spinner.tsx";

/* A collection of assets and one asset in it. The swatches stand in for media:
 * the card owns the box, the caller supplies what goes in it. */
const meta = {
	title: "Patterns/Media",
	component: MediaGrid,
	args: { label: "Generated images", children: null },
	decorators: [
		(Story) => (
			<div className="tw:bg-background tw:p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof MediaGrid>;

export default meta;
type Story = StoryObj<typeof meta>;
const noop = (): void => {};
const swatch = (hue: number): React.ReactElement => (
	<span
		style={{
			display: "block",
			width: "100%",
			height: "100%",
			background: `oklch(0.7 0.12 ${hue})`,
		}}
	/>
);

function ManagedMediaExamples(): React.ReactElement {
	const [checked, setChecked] = useState(true);
	return (
		<>
			{(["grid", "list"] as const).map((layout) => (
				<MediaGrid key={layout} label={`${layout} media selection`} layout={layout}>
					<MediaCard
						layout={layout}
						preview={swatch(250)}
						title="Camera footage with a long original filename kept accessible"
						meta="Video · 4.2s · 42 MB"
						onActivate={noop}
						label="Preview footage"
						selection={{
							label: "Select footage",
							checked,
							onCheckedChange: setChecked,
						}}
					/>
					<MediaCard
						layout={layout}
						preview={null}
						title="Unavailable source remains selectable for repair"
						unavailable="Source missing"
						selection={{
							label: "Select missing source",
							checked: false,
							onCheckedChange: noop,
						}}
						actions={
							<Toolbar label="Media actions">
								<FrameAction title="Media details" onClick={noop}>
									{Ic.expand(ICON.sm)}
								</FrameAction>
							</Toolbar>
						}
					/>
				</MediaGrid>
			))}
		</>
	);
}
export const ManagedMedia: Story = { render: () => <ManagedMediaExamples /> };

export const ProjectRecords: Story = {
	render: () => (
		<MediaGrid label="Projects" layout="list">
			<MediaCard
				layout="list"
				aspect={16 / 9}
				preview={swatch(250)}
				title="A long project name which remains accessible on narrow screens"
				meta="Video · 1:24 · edited 3 Oct · created 1 Oct"
				onActivate={noop}
			/>
			<MediaCard
				layout="list"
				aspect={16 / 9}
				preview={null}
				unavailable="Preview unavailable"
				title="Missing preview stays openable"
				meta="Video · Duration unknown · edited 3 Oct"
				onActivate={noop}
			/>
			<MediaCard
				layout="list"
				aspect={16 / 9}
				preview={null}
				unavailable="Rendering"
				unavailableIcon={<Spinner size="md" />}
				title="Running export with facts, progress and a row-end action"
				meta={
					<>
						<Chip tone="info">running</Chip>
						<span>3 Oct, 10.24</span>
						<span>storyboard-wide</span>
						<Progress value={42} label="Rendering" />
					</>
				}
				onActivate={noop}
				actions={
					<Button variant="secondary" size="sm" onClick={noop}>
						Details
					</Button>
				}
			/>
		</MediaGrid>
	),
};

export const Selectable: Story = {
	render: () => (
		<MediaGrid label="Generated images">
			<MediaCard
				preview={swatch(250)}
				caption="overlay"
				title="Tides explainer"
				label="Image, Tides explainer"
				selected
				onActivate={noop}
				overlay={<FrameBadge corner="tr">{Ic.zap(ICON.xs)}</FrameBadge>}
			/>
			<MediaCard
				preview={swatch(150)}
				caption="overlay"
				title="default"
				label="Image, default"
				selected={false}
				onActivate={noop}
			/>
			<MediaCard
				preview={null}
				unavailable="Image unavailable"
				caption="overlay"
				title="default"
				label="Image, default"
				selected={false}
				onActivate={noop}
			/>
		</MediaGrid>
	),
};

export const WithMetadata: Story = {
	render: () => (
		<MediaGrid label="Reference images" min={160}>
			<MediaCard
				preview={swatch(80)}
				fit="contain"
				ground="oklch(0.6 0.12 40)"
				title="Fixture Style"
				meta="Style · Fixture reference for the style filter."
				onActivate={noop}
			/>
			<MediaCard
				preview={swatch(200)}
				fit="contain"
				ground="oklch(0.6 0.12 180)"
				title="A reference whose name is too long to fit on one line"
				meta="Location"
				onActivate={noop}
			/>
		</MediaGrid>
	),
};

/* A rail panel: compact, draggable, browse-only. The action sits beside the
 * card, not inside an activation, and shows on hover, focus and touch. */
export const CompactWithActions: Story = {
	render: () => (
		<div className="tw:w-72">
			<MediaGrid label="Stock results" min={72} density="compact">
				<MediaCard
					draggable
					hint="Drag onto the timeline"
					preview={swatch(20)}
					overlay={<FrameBadge corner="tr">0:12</FrameBadge>}
					actions={
						<FrameActions corner="tl" reveal>
							<FrameAction title="Add without placing" onClick={noop}>
								{Ic.plus(ICON.sm)}
							</FrameAction>
						</FrameActions>
					}
				/>
				<MediaCard draggable preview={swatch(300)} caption="overlay" title="Shot 2" />
				<MediaCard
					draggable
					preview={swatch(100)}
					caption="overlay"
					title="Shot 3"
					overlay={<FrameBadge>{Ic.spark(ICON.xs)}</FrameBadge>}
				/>
			</MediaGrid>
		</div>
	),
};

export const ElementPickerTiles: Story = {
	render: () => (
		<div className="tw:w-72">
			<MediaGrid label="Element picker" min={72} density="compact">
				<MediaCard
					variant="picker"
					preview={Ic.type(ICON.display)}
					title="Text"
					label="Add Text"
					onActivate={noop}
					draggable
				/>
				<MediaCard
					variant="picker"
					preview={swatch(20)}
					title="Rectangle"
					label="Add Rectangle"
					onActivate={noop}
					draggable
					selected
				/>
			</MediaGrid>
		</div>
	),
};
