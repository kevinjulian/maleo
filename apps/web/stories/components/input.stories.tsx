import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input, Textarea } from "@design-system/components/input.tsx";

/* Canonical. One field recipe (field-recipe.ts) in three sizes: md for forms
 * (default), sm for compact rows and toolbars, xs for the editor field. */
const meta = {
	title: "Components/Input",
	component: Input,
	args: { placeholder: "Project title", "aria-label": "Project title" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithValue: Story = { args: { defaultValue: "Launch teaser" } };
export const Compact: Story = { args: { size: "sm", defaultValue: "Launch teaser" } };
export const EditorField: Story = { args: { size: "xs", defaultValue: "Fixture measure" } };
export const EditorNumber: Story = {
	args: { size: "xs", type: "number", defaultValue: 42, "aria-label": "Value" },
};
export const Disabled: Story = { args: { defaultValue: "Launch teaser", disabled: true } };
export const Invalid: Story = { args: { defaultValue: "", "aria-invalid": true } };

/* Every size in every state. Hover a field to see the border strengthen;
 * tab through to see the focus ring (inset on the editor field). */
export const Matrix: Story = {
	render: () => (
		<div className="tw:grid tw:max-w-[640px] tw:grid-cols-[auto_1fr_1fr_1fr] tw:items-center tw:gap-3">
			<span />
			{["rest", "disabled", "invalid"].map((h) => (
				<span key={h} className="tw:text-xs tw:text-muted-foreground">
					{h}
				</span>
			))}
			{(["md", "sm", "xs"] as const).map((size) => (
				<div key={size} className="tw:contents">
					<span className="tw:text-xs tw:text-muted-foreground">{size}</span>
					<Input size={size} aria-label={`${size} rest`} defaultValue="Launch teaser" />
					<Input
						size={size}
						aria-label={`${size} disabled`}
						defaultValue="Launch teaser"
						disabled
					/>
					<Input
						size={size}
						aria-label={`${size} invalid`}
						defaultValue="Launch teaser"
						aria-invalid
					/>
				</div>
			))}
		</div>
	),
};

export const TextareaDefault: Story = {
	name: "Textarea",
	render: () => <Textarea aria-label="Script" rows={4} placeholder="Write the narration" />,
};
