import type { Meta, StoryObj } from "@storybook/react-vite";
import { MediaGrid } from "@design-system/patterns/media.tsx";
import { UploadCard } from "@components/timeline/media/upload-card.tsx";
import type { MediaImportRow } from "@hooks/editor/use-media-import.ts";

/* Every state an imported file passes through before it joins the project's
 * media: queued, uploading with measured progress, finishing, processing,
 * failed (retryable or interrupted), and ready with a placement notice. */
const rows: MediaImportRow[] = [
	{ key: "q", filename: "interview-b-roll.mp4", batchSize: 6, status: "queued", retryable: true },
	{
		key: "u",
		filename: "camera-footage-with-a-long-original-name.mov",
		batchSize: 6,
		status: "uploading",
		retryable: true,
		progress: 0.42,
	},
	{
		key: "f",
		filename: "voiceover-take-3.wav",
		batchSize: 6,
		status: "uploading",
		retryable: true,
		progress: 1,
	},
	{ key: "p", filename: "drone-shot.mp4", batchSize: 6, status: "processing", retryable: true },
	{
		key: "e",
		filename: "storefront.png",
		batchSize: 6,
		status: "failed",
		retryable: true,
		file: new File([], "storefront.png"),
		error: "Upload service unavailable (HTTP 502). Retry in a moment.",
	},
	{
		key: "i",
		filename: "music-bed.m4a",
		batchSize: 6,
		status: "failed",
		retryable: false,
		error: "Upload interrupted; retry file",
	},
	{
		key: "r",
		filename: "late.png",
		batchSize: 6,
		status: "ready",
		retryable: false,
		error: "File ready; destination changed or locked. Add from Ready to place.",
	},
];

const meta = {
	title: "Patterns/Media/Upload card",
	component: MediaGrid,
	args: { label: "Files being imported", children: null },
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

export const States: Story = {
	render: () => (
		<>
			{(["grid", "list"] as const).map((layout) => (
				<MediaGrid
					key={layout}
					label={`Files being imported, ${layout}`}
					layout={layout}
					min={96}
					density="compact"
				>
					{rows.map((row) => (
						<UploadCard
							key={row.key}
							row={row}
							layout={layout}
							onRetry={noop}
							onChooseAgain={noop}
							onDismiss={noop}
						/>
					))}
				</MediaGrid>
			))}
		</>
	),
};
