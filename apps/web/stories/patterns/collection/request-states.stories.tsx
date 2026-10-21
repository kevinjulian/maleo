import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState, ErrorState, LoadingState } from "@design-system/patterns/collection.tsx";

/* The three states of a collection region with no rows. They look related and
 * are told apart: empty is plain content, loading is a busy status, failure is
 * an alert with a way to recover. `collectionPhase` picks between them. */
function States() {
	return null;
}
const meta = { title: "Patterns/Request states", component: States } satisfies Meta<typeof States>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	render: () => <EmptyState label="No presets yet. Create one to reuse a look across projects." />,
};
export const EmptyWithTitle: Story = {
	render: () => (
		<EmptyState
			title="No images in Fixture Workspace yet"
			label="Generated images appear here automatically."
		/>
	),
};
export const FilteredEmpty: Story = {
	render: () => <EmptyState label="No presets match “neon”." />,
};
export const Loading: Story = { render: () => <LoadingState label="Loading presets…" /> };
export const Failed: Story = {
	render: () => (
		<ErrorState
			title="Could not load presets"
			message="The server did not answer."
			onRetry={() => {}}
		/>
	),
};
export const FailedRetrying: Story = {
	render: () => (
		<ErrorState
			title="Could not load presets"
			message="The server did not answer."
			onRetry={() => {}}
			retrying
		/>
	),
};
export const FailedNoRetry: Story = { render: () => <ErrorState title="Detail unavailable" /> };
export const FailedInline: Story = {
	render: () => (
		<div className="tw:flex tw:max-w-lg tw:flex-col tw:gap-3">
			<ErrorState
				inline
				title="Could not delete the preset."
				message="It is in use by two projects."
				onRetry={() => {}}
			/>
			<div className="tw:rounded-md tw:border tw:border-border tw:p-3 tw:text-sm">
				The rows stay on screen.
			</div>
		</div>
	),
};
