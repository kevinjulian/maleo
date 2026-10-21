import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";

/* Canonical. A text-less action on the control-height scale (micro 16, xs 24,
 * sm 32, md 40). `on` makes it a toggle (aria-pressed, selection paint);
 * `danger` reddens the hover. An accessible name is required by type. */
const meta = {
	title: "Components/IconButton",
	component: IconButton,
	args: { "aria-label": "Regenerate", children: Ic.regen(ICON.md) },
} satisfies Meta<typeof IconButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Toolbar: Story = { args: { size: "sm" } };
export const EditorRow: Story = { args: { size: "xs", children: Ic.regen(ICON.sm) } };
export const Micro: Story = {
	args: { size: "micro", children: Ic.x(ICON.xs), "aria-label": "Remove" },
};
export const Pressed: Story = {
	args: { on: true, "aria-label": "Show layers", children: Ic.layers(ICON.md) },
};
export const Danger: Story = {
	args: { danger: true, "aria-label": "Delete clip", children: Ic.trash(ICON.md) },
};
export const Disabled: Story = { args: { disabled: true } };

export const Matrix: Story = {
	render: () => (
		<div className="tw:grid tw:grid-cols-[auto_repeat(4,auto)] tw:items-center tw:justify-start tw:gap-3">
			<span />
			{["rest", "pressed", "danger", "disabled"].map((h) => (
				<span key={h} className="tw:text-xs tw:text-muted-foreground">
					{h}
				</span>
			))}
			{(["md", "sm", "xs"] as const).map((size) => {
				const g = size === "md" ? ICON.md : ICON.sm;
				return (
					<div key={size} className="tw:contents">
						<span className="tw:text-xs tw:text-muted-foreground">{size}</span>
						<IconButton size={size} aria-label="Layers">
							{Ic.layers(g)}
						</IconButton>
						<IconButton size={size} on aria-label="Layers on">
							{Ic.layers(g)}
						</IconButton>
						<IconButton size={size} danger aria-label="Delete">
							{Ic.trash(g)}
						</IconButton>
						<IconButton size={size} disabled aria-label="Layers disabled">
							{Ic.layers(g)}
						</IconButton>
					</div>
				);
			})}
		</div>
	),
};
