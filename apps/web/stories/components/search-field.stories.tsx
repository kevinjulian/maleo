import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { SearchField } from "@design-system/components/search-field.tsx";

/* Canonical. A query, its glyph and one clear control in one box. Escape clears
 * and keeps focus; the clear control returns focus to the field. */
function Harness({
	initial = "",
	size,
	disabled,
}: {
	initial?: string;
	size?: "sm" | "md";
	disabled?: boolean;
}) {
	const [query, setQuery] = useState(initial);
	return (
		<div className="tw:max-w-sm">
			<SearchField
				label="Search materials"
				value={query}
				onValueChange={setQuery}
				size={size}
				disabled={disabled}
			/>
		</div>
	);
}

const meta = { title: "Components/SearchField", component: Harness } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const WithQuery: Story = { args: { initial: "cinematic" } };
export const Compact: Story = { args: { size: "sm", initial: "cinematic" } };
export const Disabled: Story = { args: { disabled: true, initial: "cinematic" } };

export const ClearKeepsFocus: Story = {
	args: { initial: "cinematic" },
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const field = canvas.getByRole("searchbox", { name: "Search materials" });
		await userEvent.click(canvas.getByRole("button", { name: "Clear search" }));
		await expect(field).toHaveValue("");
		await expect(field).toHaveFocus();
		await userEvent.type(field, "logo");
		await userEvent.keyboard("{Escape}");
		await expect(field).toHaveValue("");
		await expect(field).toHaveFocus();
	},
};
