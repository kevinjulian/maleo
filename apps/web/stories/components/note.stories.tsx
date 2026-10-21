import type { Meta, StoryObj } from "@storybook/react-vite";
import { Callout, Note } from "@design-system/components/note.tsx";

/* Note is a line of text; Callout owns a block of layout. Two components on
 * purpose (note.tsx). */
const meta = {
	title: "Components/Note",
	component: Note,
	args: { children: "Start / end frames, focal point and shot live in the full editor." },
	decorators: [
		(Story) => (
			<div className="tw:max-w-sm">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Note>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {};
export const Muted: Story = { args: { tone: "muted" } };
export const Warn: Story = {
	args: { tone: "warn", children: "Provider is unconfigured; the app default is used." },
};
export const ErrorTone: Story = {
	args: { tone: "error", children: "Volume must be between 0 and 100." },
};
export const CalloutWarn: Story = {
	render: () => (
		<Callout>Image provider is down. Generation will fall back to the app default.</Callout>
	),
};
export const CalloutError: Story = {
	render: () => <Callout tone="error">Render failed: the music file could not be read.</Callout>,
};
export const CalloutInfo: Story = {
	render: () => <Callout tone="info">Edits apply to every section using this template.</Callout>,
};
