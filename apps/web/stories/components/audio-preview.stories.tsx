import type { Meta, StoryObj } from "@storybook/react-vite";
import { AudioPreview } from "@design-system/components/audio-preview.tsx";
import { toneWav } from "./media-fixture.ts";

/* One shared audio element: starting a preview stops any other. */
const TONE = toneWav(2);

const meta = {
	title: "Components/AudioPreview",
	component: AudioPreview,
	args: { src: TONE, durationSec: 2, label: "Narrator sample" },
	decorators: [
		(Story) => (
			<div className="tw:max-w-xs">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AudioPreview>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoSource: Story = { args: { src: undefined, label: "Not generated yet" } };
export const Two: Story = {
	name: "Two previews",
	render: () => (
		<div className="tw:flex tw:flex-col tw:gap-2">
			<AudioPreview src={TONE} durationSec={2} label="Narrator sample" />
			<AudioPreview src={toneWav(1)} durationSec={1} label="Music bed" />
		</div>
	),
};
