import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Sheet, type SheetEdge } from "@design-system/components/sheet.tsx";

/* The app's sheet: a dialog on the controllers/overlay stack, dismissed
 * by scrim, Escape or Back. Open while `open`; reopen from the button. */
function SheetHarness({ edge }: { edge: SheetEdge }) {
	const [open, setOpen] = useState(true);
	return (
		<>
			<Button variant="primary" onClick={() => setOpen(true)}>
				Open sheet
			</Button>
			<Sheet
				edge={edge}
				open={open}
				onClose={() => setOpen(false)}
				label="Clip properties"
				size={edge === "bottom" ? "50vh" : "320px"}
			>
				<div className="tw:flex tw:flex-col tw:gap-3 tw:p-4 tw:text-sm">
					<strong>Clip properties</strong>
					<p className="tw:m-0 tw:text-muted-foreground">Sheet content.</p>
					<Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
						Close
					</Button>
				</div>
			</Sheet>
		</>
	);
}

const meta = {
	title: "Components/Sheet",
	component: SheetHarness,
	parameters: { layout: "fullscreen" },
	args: { edge: "right" },
} satisfies Meta<typeof SheetHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {};
export const Left: Story = { args: { edge: "left" } };
export const Bottom: Story = {
	args: { edge: "bottom" },
	globals: { viewport: { value: "mobile1" } },
};
