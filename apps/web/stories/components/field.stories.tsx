import type { Meta, StoryObj } from "@storybook/react-vite";
import { Field } from "@design-system/components/field.tsx";
import { Input, Textarea } from "@design-system/components/input.tsx";
import { Note } from "@design-system/components/note.tsx";
import { Select } from "@design-system/components/select.tsx";

/* Label / control / help stack. The label stays a child, because a field's
 * head is sometimes a row (field.tsx). */
const meta = {
	title: "Components/Field",
	component: Field,
	decorators: [
		(Story) => (
			<div className="tw:max-w-sm">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithInput: Story = {
	render: () => (
		<Field>
			<span>Project title</span>
			<Input defaultValue="Launch teaser" />
		</Field>
	),
};
export const WithSelect: Story = {
	render: () => (
		<Field>
			<span>Aspect ratio</span>
			<Select
				defaultValue="9:16"
				options={[...(["16:9", "9:16", "1:1"].map((v) => ({ value: v, label: v })) ?? [])]}
			/>
		</Field>
	),
};
export const WithHelp: Story = {
	render: () => (
		<Field>
			<span>Description</span>
			<Textarea rows={3} placeholder="What the video is about" />
			<Note as="span" tone="muted">
				Shown to collaborators in this workspace.
			</Note>
		</Field>
	),
};
export const WithWarning: Story = {
	render: () => (
		<Field>
			<span>Music volume</span>
			<Input type="number" defaultValue={140} aria-invalid />
			<Note as="span" tone="error">
				Volume must be between 0 and 100.
			</Note>
		</Field>
	),
};
export const AsGroup: Story = {
	render: () => (
		<Field as="div">
			<span>Voice</span>
			<div className="tw:flex tw:gap-2">
				<Input aria-label="Voice name" defaultValue="Narrator" />
				<Select
					aria-label="Language"
					width="auto"
					options={[
						{ value: "en", label: "en" },
						{ value: "id", label: "id" },
					]}
				/>
			</div>
		</Field>
	),
};
