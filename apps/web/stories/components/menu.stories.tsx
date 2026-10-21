import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, within } from "storybook/test";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import {
	ContextMenu,
	Menu,
	MenuItem,
	MenuLabel,
	MenuSeparator,
} from "@design-system/components/menu.tsx";

/* Base UI popup in a portal: proves positioning, z-index and tokens reach
 * content rendered outside the story root. */
const meta = {
	title: "Components/Menu",
	component: Menu,
	args: {
		label: "Clip actions",
		align: "start",
		trigger: <span className="tw:inline-flex tw:p-2">{Ic.plus(ICON.md)}</span>,
		children: (
			<>
				<MenuLabel>Clip</MenuLabel>
				<MenuItem icon={Ic.regen(ICON.sm)} onSelect={() => {}}>
					Regenerate
				</MenuItem>
				<MenuItem icon={Ic.link(ICON.sm)} onSelect={() => {}}>
					Copy link
				</MenuItem>
				<MenuItem onSelect={() => {}} disabled>
					Unavailable
				</MenuItem>
				<MenuSeparator />
				<MenuItem icon={Ic.trash(ICON.sm)} onSelect={() => {}} danger>
					Delete
				</MenuItem>
			</>
		),
	},
} satisfies Meta<typeof Menu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("button", { name: "Clip actions" }));
		await expect(await screen.findByRole("menu")).toBeVisible();
	},
};

/* The same list opened at the pointer: right-click the region. */
export const Context: Story = {
	render: () => (
		<ContextMenu
			className="tw:flex tw:h-32 tw:w-64 tw:items-center tw:justify-center tw:rounded-md tw:border tw:border-dashed tw:border-border tw:text-xs tw:text-muted-foreground"
			menu={
				<>
					<MenuItem icon={Ic.copy(ICON.sm)} onSelect={() => {}}>
						Duplicate
					</MenuItem>
					<MenuItem icon={Ic.cut(ICON.sm)} onSelect={() => {}}>
						Split at playhead
					</MenuItem>
					<MenuSeparator />
					<MenuItem icon={Ic.trash(ICON.sm)} onSelect={() => {}} danger>
						Delete clip
					</MenuItem>
				</>
			}
		>
			Right-click this clip
		</ContextMenu>
	),
	play: async ({ canvasElement }) => {
		await userEvent.pointer({
			keys: "[MouseRight]",
			target: within(canvasElement).getByText("Right-click this clip"),
		});
		await expect(await screen.findByRole("menuitem", { name: "Delete clip" })).toBeVisible();
	},
};
