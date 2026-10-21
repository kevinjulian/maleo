import type { Meta, StoryObj } from "@storybook/react-vite";
import { SidebarNavigation } from "@design-system/patterns/sidebar-navigation.tsx";
import {
	Topbar,
	TopbarLeading,
	TopbarStatus,
	TopbarActions,
} from "@design-system/patterns/topbar.tsx";
import { Button } from "@design-system/components/button.tsx";
import { ICON, Ic } from "@design-system/icons/index.tsx";
const groups = [
	{ items: [{ id: "projects", label: "Projects", icon: Ic.book(ICON.md), onNavigate: () => {} }] },
	{
		label: "Library",
		items: [
			{ id: "elements", label: "Elements", icon: Ic.elements(ICON.md), onNavigate: () => {} },
			{
				id: "materials",
				label: "Materials with a very long translated name",
				icon: Ic.layers(ICON.md),
				onNavigate: () => {},
			},
		],
	},
];
const meta = {
	title: "Patterns/Shell",
	component: SidebarNavigation,
	args: { groups, current: "projects", header: "Workspace", footer: "maleo" },
	decorators: [
		(Story) => (
			<div className="tw:h-[600px] tw:w-64 tw:border tw:border-border">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SidebarNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Expanded: Story = {};
export const Rail: Story = { args: { variant: "rail", header: "A" } };
export const Drawer: Story = { args: { variant: "drawer" } };
export const Hidden: Story = { args: { variant: "hidden" } };
export const AppTopbar: Story = {
	render: () => (
		<Topbar>
			<TopbarLeading>Projects with long name</TopbarLeading>
			<TopbarActions>
				<Button>Search</Button>
				<Button>Account</Button>
			</TopbarActions>
		</Topbar>
	),
};
export const EditorTopbar: Story = {
	render: () => (
		<Topbar variant="editor">
			<TopbarLeading>Project title</TopbarLeading>
			<TopbarStatus>
				<span role="status">Saved</span>
			</TopbarStatus>
			<TopbarActions>
				<Button>Timeline</Button>
				<Button>Export</Button>
			</TopbarActions>
		</Topbar>
	),
};
export const SaveFailed: Story = {
	render: () => (
		<Topbar variant="editor">
			<TopbarLeading>Project title</TopbarLeading>
			<TopbarStatus>
				<span role="status">Save failed</span>
			</TopbarStatus>
			<TopbarActions>
				<Button>Export</Button>
			</TopbarActions>
		</Topbar>
	),
};
