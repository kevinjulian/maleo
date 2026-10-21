import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button } from "@design-system/components/button.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { Tooltip } from "@design-system/components/tooltip.tsx";

/* Canonical. A supplemental hint on hover and on keyboard focus, in place of a
 * native `title`. The control keeps its own accessible name. */
function Example({ side = "top" }: { side?: "top" | "bottom" | "left" | "right" }) {
	return (
		<Tooltip label="Split at playhead" side={side}>
			<IconButton size="sm" aria-label="Split">
				{Ic.cut(ICON.md)}
			</IconButton>
		</Tooltip>
	);
}

const meta = {
	title: "Components/Tooltip",
	component: Example,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Example>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const OnHover: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.hover(within(canvasElement).getByRole("button", { name: "Split" }));
		const tip = await screen.findByText("Split at playhead");
		await waitFor(() => expect(tip).toBeVisible());
	},
};

/* What a native title never did: the hint follows the keyboard. */
export const OnFocus: Story = {
	args: { side: "bottom" },
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		await expect(within(canvasElement).getByRole("button", { name: "Split" })).toHaveFocus();
		const tip = await screen.findByText("Split at playhead");
		await waitFor(() => expect(tip).toBeVisible());
	},
};

export const Sides: Story = {
	render: () => (
		<div className="tw:flex tw:gap-2">
			{(["top", "bottom", "left", "right"] as const).map((side) => (
				<Tooltip key={side} label={`Opens on the ${side}`} side={side}>
					<Button variant="secondary" size="sm">
						{side}
					</Button>
				</Tooltip>
			))}
		</div>
	),
};

export const OnDisabledLoading: Story = {
	name: "On a loading button",
	render: () => (
		<Tooltip label="Rendering 42%">
			<Button variant="primary" size="sm" loading>
				Export
			</Button>
		</Tooltip>
	),
};
