import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Page, PageHeader, PageTitle } from "@design-system/components/page.tsx";

const meta = {
	title: "Components/Page",
	component: Page,
	parameters: { layout: "fullscreen" },
	args: { children: null },
} satisfies Meta<typeof Page>;

export default meta;
type Story = StoryObj<typeof meta>;

const body = <p className="tw:text-sm tw:text-muted-foreground">Page content.</p>;

export const Default: Story = {
	render: () => (
		<Page>
			<PageHeader
				title="Presets"
				lead="Saved looks you can apply to any project."
				action={
					<Button variant="primary" size="sm">
						New preset
					</Button>
				}
			/>
			{body}
		</Page>
	),
};
export const Narrow: Story = {
	render: () => (
		<Page width="narrow">
			<PageHeader title="Video settings" lead="Defaults for new projects in this workspace." />
			{body}
		</Page>
	),
};
export const TitleOnly: Story = {
	render: () => (
		<Page>
			<PageHeader title="Usage" />
			{body}
		</Page>
	),
};
export const SubTitle: Story = {
	render: () => (
		<Page>
			<PageTitle level="sub">Edit preset</PageTitle>
			{body}
		</Page>
	),
};
