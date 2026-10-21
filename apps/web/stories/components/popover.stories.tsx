import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import {
	Popover,
	PopoverContent,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@design-system/components/popover.tsx";

/* Canonical. An anchored floating surface for a small task. Overlay surface,
 * md radius, overlay elevation, --z-floating; Escape and outside press close. */
function Example({ align = "start" }: { align?: "start" | "center" | "end" }) {
	return (
		<Popover>
			<PopoverTrigger asChild>
				<Button variant="secondary" size="sm">
					Rename scene
				</Button>
			</PopoverTrigger>
			<PopoverContent align={align} sideOffset={6} className="tw:w-64">
				<PopoverHeader>
					<PopoverTitle>Rename scene</PopoverTitle>
				</PopoverHeader>
				<div className="tw:flex tw:flex-col tw:gap-2">
					<Input size="sm" aria-label="Scene name" defaultValue="Fixture opening" />
					<Button variant="primary" size="sm">
						Save
					</Button>
				</div>
			</PopoverContent>
		</Popover>
	);
}

const meta = {
	title: "Components/Popover",
	component: Example,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};
export const Open: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("button", { name: "Rename scene" }));
		/* The surface fades in; assert after the entrance, not its first frame. */
		const field = await screen.findByRole("textbox", { name: "Scene name" });
		await waitFor(() => expect(field).toBeVisible());
	},
};
