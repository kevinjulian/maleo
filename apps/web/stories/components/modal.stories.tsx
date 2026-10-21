import { useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "@design-system/components/button.tsx";
import { Input } from "@design-system/components/input.tsx";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { AlphaColorControl } from "@design-system/components/color-control.tsx";
import { Modal } from "@design-system/components/modal.tsx";
import { Popover, PopoverContent, PopoverTrigger } from "@design-system/components/popover.tsx";

/* The app dialog: portalled through the controllers/overlay stack with its
 * focus trap and scroll lock. A Modal is open while mounted, so each story
 * holds the open state and offers a button to reopen after Escape or close. */
function ModalHarness({
	dock = false,
	dismissOnBack = false,
}: {
	dock?: boolean;
	dismissOnBack?: boolean;
}) {
	const [open, setOpen] = useState(true);
	return (
		<>
			<Button variant="primary" onClick={() => setOpen(true)}>
				Open dialog
			</Button>
			{open && (
				<Modal
					title="Rename project"
					sub="Visible to everyone in this workspace"
					dock={dock}
					dismissOnBack={dismissOnBack}
					onClose={() => setOpen(false)}
				>
					<div className="tw:flex tw:flex-col tw:gap-3">
						<Input aria-label="Project name" defaultValue="Launch teaser" />
						<div className="tw:flex tw:justify-end tw:gap-2">
							<Button variant="ghost" onClick={() => setOpen(false)}>
								Cancel
							</Button>
							<Button variant="primary" onClick={() => setOpen(false)}>
								Save
							</Button>
						</div>
					</div>
				</Modal>
			)}
		</>
	);
}

const meta = {
	title: "Components/Modal",
	component: ModalHarness,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof ModalHarness>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const BackDismissal: Story = { args: { dismissOnBack: true } };
export const Docked: Story = { args: { dock: true }, globals: { viewport: { value: "mobile1" } } };

/* A popup opened inside a dialog renders in the dialog's own host: reachable,
 * its Tab stays inside it, and Escape closes the popup before the dialog. */
function NestedHarness() {
	const [open, setOpen] = useState(true);
	const [fill, setFill] = useState<string | undefined>("#e0a3c8ff");
	return (
		<>
			<Button variant="primary" onClick={() => setOpen(true)}>
				Open dialog
			</Button>
			{open && (
				<Modal title="Edit caption" onClose={() => setOpen(false)}>
					<div className="tw:flex tw:flex-col tw:gap-3">
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="secondary" size="sm">
									Rename
								</Button>
							</PopoverTrigger>
							<PopoverContent align="start" className="tw:w-56">
								<Input size="sm" aria-label="New name" defaultValue="Fixture caption" />
							</PopoverContent>
						</Popover>
						<AlphaColorControl label="Fill" value={fill} fallback="#ffffff" onChange={setFill} />
					</div>
				</Modal>
			)}
		</>
	);
}

export const WithNestedPopups: Story = {
	render: () => <NestedHarness />,
	play: async () => {
		const page = within(document.body);
		await userEvent.click(await page.findByRole("button", { name: "Rename" }));
		const field = await page.findByRole("textbox", { name: "New name" });
		await waitFor(() => expect(field).toHaveFocus());
		await userEvent.type(field, "!");
		await expect(field).toHaveValue("Fixture caption!");
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(page.queryByRole("textbox", { name: "New name" })).toBeNull());
		await expect(page.getByRole("dialog", { name: "Edit caption" })).toBeVisible();
		await userEvent.click(page.getByRole("button", { name: "Fill color" }));
		const done = await page.findByRole("button", { name: "Done" });
		await waitFor(() => expect(done).toBeVisible());
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(page.queryByRole("button", { name: "Done" })).toBeNull());
		await expect(page.getByRole("dialog", { name: "Edit caption" })).toBeVisible();
		await userEvent.keyboard("{Escape}");
		await waitFor(() => expect(page.queryByRole("dialog", { name: "Edit caption" })).toBeNull());
	},
};
