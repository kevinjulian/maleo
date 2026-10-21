import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, userEvent, within } from "storybook/test";
import { ICON, Ic } from "@design-system/icons/index.tsx";
import { IconButton } from "@design-system/components/icon-button.tsx";
import { InspectorSection, PropertyRow } from "@design-system/patterns/inspector.tsx";
import { Input } from "@design-system/components/input.tsx";
import { Select } from "@design-system/components/select.tsx";
import { InspectorFrame } from "./inspector-frame.tsx";

const meta = {
	title: "Patterns/Inspector/InspectorSection",
	component: InspectorSection,
	decorators: [
		(Story) => (
			<InspectorFrame>
				<Story />
			</InspectorFrame>
		),
	],
	args: { title: "Data", children: null },
} satisfies Meta<typeof InspectorSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/* The data callout's fields, from the docked clip inspector. */
export const Default: Story = {
	render: () => (
		<InspectorSection title="Data">
			<PropertyRow label="Title">
				<Input size="xs" defaultValue="Fixture measure" />
			</PropertyRow>
			<PropertyRow label="Value">
				<Input size="xs" defaultValue="42" />
			</PropertyRow>
			<PropertyRow label="Suffix">
				<Input size="xs" defaultValue="%" />
			</PropertyRow>
			<PropertyRow label="Comparison">
				<Input size="xs" defaultValue="vs the fixture baseline" />
			</PropertyRow>
		</InspectorSection>
	),
};

export const Collapsible: Story = {
	render: () => (
		<>
			<InspectorSection title="Position & Size" collapsible defaultOpen>
				<PropertyRow label="Position" as="div">
					<Input size="xs" type="number" aria-label="X offset" defaultValue={50} />
					<Input size="xs" type="number" aria-label="Y offset" defaultValue={50} />
				</PropertyRow>
				<PropertyRow label="Fit">
					<Select
						size="xs"
						defaultValue="cover"
						aria-label={"Fit"}
						options={[
							...(["contain", "cover", "stretch"].map((v) => ({ value: v, label: v })) ?? []),
						]}
					/>
				</PropertyRow>
			</InspectorSection>
			<InspectorSection title="Playback" collapsible>
				<PropertyRow label="Rate">
					<Input size="xs" type="number" defaultValue={100} />
				</PropertyRow>
			</InspectorSection>
		</>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const playback = canvas.getByRole("button", { name: "Playback" });
		await expect(playback).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(playback);
		await expect(playback).toHaveAttribute("aria-expanded", "true");
		await expect(canvas.getByRole("spinbutton", { name: "Rate" })).toBeVisible();
		await expect(playback).toHaveFocus();
	},
};

/* A section-scoped action sits beside the disclosure, never inside it, and
 * acts on this section only. No production section carries one yet; the
 * package accordion's `right` slot is unused, so this is the spec's slot. */
export const WithAction: Story = {
	render: () => (
		<InspectorSection
			title="Position & Size"
			collapsible
			defaultOpen
			action={
				<IconButton size="xs" aria-label="Reset Position & Size">
					{Ic.refresh(ICON.xs)}
				</IconButton>
			}
		>
			<PropertyRow label="Position" as="div">
				<Input size="xs" type="number" aria-label="X offset" defaultValue={12} />
				<Input size="xs" type="number" aria-label="Y offset" defaultValue={-4} />
			</PropertyRow>
			<PropertyRow label="Size" as="div">
				<Input size="xs" type="number" aria-label="Box width" defaultValue={80} />
				<Input size="xs" type="number" aria-label="Box height" defaultValue={100} />
			</PropertyRow>
		</InspectorSection>
	),
};

export const LongTitle: Story = {
	render: () => (
		<InspectorSection
			title="Comparison baseline and annotation settings for the data callout"
			collapsible
			defaultOpen
			action={
				<IconButton size="xs" aria-label="Reset comparison">
					{Ic.refresh(ICON.xs)}
				</IconButton>
			}
		>
			<PropertyRow label="Baseline">
				<Input size="xs" defaultValue="vs last quarter" />
			</PropertyRow>
		</InspectorSection>
	),
};

export const ProjectSettings: Story = {
	render: () => (
		<>
			<InspectorSection title="Output" collapsible defaultOpen>
				<PropertyRow label="Aspect ratio">
					<Select
						size="xs"
						defaultValue="16:9"
						aria-label={"Aspect ratio"}
						options={[
							{ value: "16:9", label: "16:9" },
							{ value: "9:16", label: "9:16" },
						]}
					/>
				</PropertyRow>
			</InspectorSection>
			<InspectorSection title="Audio" collapsible defaultOpen>
				<PropertyRow
					label="Voice"
					as="div"
					actions={
						<IconButton size="xs" aria-label="Voice default actions">
							{Ic.more(ICON.xs)}
						</IconButton>
					}
				>
					<Select
						size="xs"
						aria-label="Voice"
						defaultValue="Calm"
						options={[
							{ value: "Calm", label: "Calm" },
							{ value: "Bright", label: "Bright" },
						]}
					/>
					<IconButton size="xs" aria-label="Play voice sample">
						{Ic.play(ICON.xs)}
					</IconButton>
				</PropertyRow>
			</InspectorSection>
		</>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await expect(canvas.getByRole("combobox", { name: "Aspect ratio" })).toBeVisible();
		await expect(canvas.getByRole("combobox", { name: "Voice" })).toBeVisible();
		await expect(canvas.getByRole("button", { name: "Voice default actions" })).toBeVisible();
		const audio = canvas.getByRole("button", { name: "Audio" });
		await userEvent.click(audio);
		await expect(audio).toHaveAttribute("aria-expanded", "false");
		await expect(audio).toHaveFocus();
		await userEvent.keyboard("{Enter}");
		await expect(canvas.getByRole("button", { name: "Play voice sample" })).toBeVisible();
	},
};

export const CollapsedValue: Story = {
	render: () => (
		<>
			<InspectorSection title="Entrance" collapsible summary="Fade">
				<PropertyRow label="Duration">
					<Input defaultValue="0.4" />
				</PropertyRow>
			</InspectorSection>
			<InspectorSection title="Exit" collapsible>
				<PropertyRow label="Duration">
					<Input defaultValue="0.4" />
				</PropertyRow>
			</InspectorSection>
		</>
	),
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		const entrance = canvas.getByRole("button", { name: "Entrance Fade" });
		await expect(entrance).toHaveAttribute("aria-expanded", "false");
		await userEvent.click(entrance);
		await expect(entrance).toHaveAttribute("aria-expanded", "true");
		await expect(canvas.queryByText("Fade")).not.toBeInTheDocument();
		await expect(canvas.getByRole("region", { name: "Entrance" })).toBeVisible();
	},
};
