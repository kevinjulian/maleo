import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, screen, userEvent, waitFor, within } from "storybook/test";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";

function ColorHarness({
	initial,
	compact,
	brand,
}: {
	initial?: string;
	compact?: boolean;
	brand?: boolean;
}) {
	const [value, setValue] = useState(initial);
	return (
		<div className="tw:w-60">
			<AlphaColorControl
				label="Fill"
				value={value}
				fallback="#ffffff"
				onChange={setValue}
				compact={compact}
				brandValue={brand ? "#1f6f5cff" : undefined}
				brandLabel={brand ? "Brand green" : undefined}
			/>
		</div>
	);
}

const meta = {
	title: "Components/AlphaColorControl",
	component: ColorHarness,
	args: { initial: "#e0a3c8ff" },
} satisfies Meta<typeof ColorHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Transparent: Story = { args: { initial: "transparent" } };
export const Fallback: Story = { args: { initial: undefined } };
export const Compact: Story = { args: { compact: true } };
export const WithBrand: Story = { args: { brand: true } };
export const Open: Story = {
	play: async ({ canvasElement }) => {
		await userEvent.click(within(canvasElement).getByRole("button", { name: /Fill/ }));
		const done = await screen.findByRole("button", { name: "Done" });
		await waitFor(() => expect(done).toBeVisible());
		/* A typed hex is the value, not a reset to the fallback. */
		const hex = screen.getByRole("textbox", { name: "Fill hex" });
		await userEvent.clear(hex);
		await userEvent.type(hex, "112233ff");
		await expect(hex).toHaveValue("112233ff");
	},
};
