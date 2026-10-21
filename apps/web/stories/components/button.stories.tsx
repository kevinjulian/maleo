import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Button, ButtonLabel, ButtonLink } from "@design-system/components/button.tsx";

/* Canonical. Five variants, each a purpose; two sizes on the control-height
 * tokens. Pick by what the action does, not by the colour you want. */
const meta = {
	title: "Components/Button",
	component: Button,
	args: { children: "Export" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { variant: "primary" } };
export const Secondary: Story = { args: { variant: "secondary" } };
export const Ghost: Story = { args: { variant: "ghost" } };
export const Danger: Story = { args: { variant: "danger", children: "Delete clip" } };
/* Running: aria-busy, a spinner, presses ignored, focus kept. */
export const Loading: Story = { args: { variant: "primary", loading: true, children: "Saving" } };

/* Every variant at both sizes and in every state, side by side. */
const VARIANTS = ["primary", "secondary", "ghost", "danger"] as const;
export const Matrix: Story = {
	render: () => (
		<div className="tw:grid tw:grid-cols-[auto_repeat(5,auto)] tw:items-center tw:justify-start tw:gap-3">
			<span />
			{["md", "sm", "with icon", "disabled", "loading"].map((h) => (
				<span key={h} className="tw:text-xs tw:text-muted-foreground">
					{h}
				</span>
			))}
			{VARIANTS.map((v) => (
				<div key={v} className="tw:contents">
					<span className="tw:text-xs tw:text-muted-foreground">{v}</span>
					<Button variant={v}>Export</Button>
					<Button variant={v} size="sm">
						Export
					</Button>
					<Button variant={v} size="sm">
						{Ic.download(ICON.sm)} Export
					</Button>
					<Button variant={v} size="sm" disabled>
						Export
					</Button>
					<Button variant={v} size="sm" loading>
						Export
					</Button>
				</div>
			))}
		</div>
	),
};

export const Focused: Story = {
	args: { variant: "secondary" },
	play: async ({ canvasElement }) => {
		await userEvent.tab();
		await expect(within(canvasElement).getByRole("button")).toHaveFocus();
	},
};

/* A link and a file-picker label that must look exactly like a button. */
export const AsLinkAndLabel: Story = {
	render: () => (
		<div className="tw:flex tw:gap-2">
			<ButtonLink href="#render" variant="secondary" size="sm">
				{Ic.download(ICON.sm)} Download render
			</ButtonLink>
			<ButtonLabel variant="secondary" size="sm">
				{Ic.upload(ICON.sm)} Upload
				<input type="file" hidden />
			</ButtonLabel>
		</div>
	),
};
