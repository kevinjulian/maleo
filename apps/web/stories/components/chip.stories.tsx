import { Select } from "@design-system/components/select.tsx";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { Chip, ChipButton } from "@design-system/components/chip.tsx";

/* Canonical. `tag` is the badge role: status or category, tinted by tone.
 * `inline` is a filter pill that can hold a small control. ChipButton is the
 * pressable form; `on` is announced with aria-pressed. */
const meta = {
	title: "Components/Chip",
	component: Chip,
	args: { children: "Draft" },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Badge: Story = {};
export const Tones: Story = {
	render: () => (
		<div className="tw:flex tw:flex-wrap tw:gap-2">
			<Chip>Draft</Chip>
			<Chip tone="ok">Ready</Chip>
			<Chip tone="warn">Pending</Chip>
			<Chip tone="err">Failed</Chip>
			<Chip tone="info">Queued</Chip>
			<Chip tone="accent">Default</Chip>
		</div>
	),
};
export const Filters: Story = {
	render: () => (
		<div className="tw:flex tw:flex-wrap tw:gap-2">
			<ChipButton on={false}>All</ChipButton>
			<ChipButton on>Music</ChipButton>
			<ChipButton on={false}>Voice</ChipButton>
			<ChipButton on={false} disabled>
				Archived
			</ChipButton>
		</div>
	),
};
export const Inline: Story = {
	render: () => (
		<div className="tw:flex tw:flex-wrap tw:gap-2">
			<Chip variant="inline">{Ic.layers(ICON.xs)} Scene 2</Chip>
			<Chip variant="inline" on>
				{Ic.music(ICON.xs)} Music bed
			</Chip>
			<Chip variant="inline" as="label">
				{Ic.type(ICON.xs)} Font{" "}
				<Select
					aria-label="Font"
					defaultValue="Space Grotesk"
					options={[
						{ value: "Space Grotesk", label: "Space Grotesk" },
						{ value: "Inter", label: "Inter" },
					]}
				/>
			</Chip>
		</div>
	),
};
