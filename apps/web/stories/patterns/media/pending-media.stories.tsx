import type { Meta, StoryObj } from "@storybook/react-vite";
import { MediaCard, MediaGrid } from "@design-system/patterns/media.tsx";
import { Frame, FrameAction } from "@design-system/components/frame.tsx";
import { Toolbar } from "@design-system/patterns/toolbar.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { pendingUploadLabel, type PendingUploadState } from "@models/core/pending-media-sources.ts";
import {
	PendingUploadActions,
	PendingUploadMeta,
	PendingUploadOverlay,
} from "@components/timeline/media/pending-upload.tsx";

/* A pending asset's card in Ready to place or In use, per state
 * (docs/design-system/patterns/media-card.md#pending-media). */
const states: Array<[string, PendingUploadState]> = [
	["beach-footage.mov", { phase: "uploading", progress: 0.4 }],
	["drone-shot.mp4", { phase: "processing" }],
	[
		"storefront.png",
		{
			phase: "failed",
			reason: "Upload service unavailable (HTTP 502). Retry in a moment.",
			canRetry: true,
		},
	],
	["music-bed.m4a", { phase: "interrupted" }],
];
const noop = (): void => {};
const handlers = { onCancel: noop, onRetry: noop, onChooseAgain: noop, onDelete: noop };

const meta = {
	title: "Patterns/Media/Pending media",
	component: MediaGrid,
	args: { label: "Ready to place", children: null },
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

export const States: Story = {
	render: () => (
		<>
			{(["grid", "list"] as const).map((layout) => (
				<MediaGrid
					key={layout}
					label={`Ready to place, ${layout}`}
					layout={layout}
					min={96}
					density="compact"
				>
					{states.map(([name, state], index) => (
						<MediaCard
							key={name}
							layout={layout}
							caption="below"
							title={name}
							label={`${name}, ${pendingUploadLabel(state)}`}
							data-upload-state={state.phase}
							meta={<PendingUploadMeta state={state} />}
							preview={
								<Frame generated src={undefined} seed={index + 3} aspect={1} w="100%" fit="cover" />
							}
							overlay={<PendingUploadOverlay name={name} state={state} />}
							actions={
								<Toolbar label={`Media actions: ${name}`}>
									<FrameAction title={`Add ${name} to timeline`} onClick={noop}>
										{Ic.plus(ICON.xs)}
									</FrameAction>
									<PendingUploadActions name={name} state={state} handlers={handlers} />
								</Toolbar>
							}
						/>
					))}
				</MediaGrid>
			))}
		</>
	),
};
