import type { Meta, StoryObj } from "@storybook/react-vite";
import { Avatar } from "@design-system/components/avatar.tsx";

/* Initials only: accounts carry no image. Decorative (aria-hidden); the name
 * is always printed beside it. A person is a circle on ink, a workspace a
 * square on its own colour. */
const meta = {
	title: "Components/Avatar",
	component: Avatar,
	args: { name: "Kevin Julian" },
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoWords: Story = {};
export const OneWord: Story = { args: { name: "maleo" } };
export const Email: Story = { args: { name: "ops.team@example.com" } };
export const WithName: Story = {
	render: (args) => (
		<span className="tw:inline-flex tw:items-center tw:gap-2 tw:text-sm">
			<Avatar {...args} />
			{args.name}
		</span>
	),
};

/* A workspace: square, on the colour its registry derives from its name. */
export const Workspace: Story = {
	args: { name: "Fixture Workspace", initials: "FW", color: "hsl(262 60% 48%)", shape: "square" },
};
export const WorkspaceSmall: Story = {
	args: {
		name: "Fixture Workspace",
		initials: "FW",
		color: "hsl(160 55% 32%)",
		shape: "square",
		size: "sm",
	},
};
export const Small: Story = { args: { size: "sm" } };
