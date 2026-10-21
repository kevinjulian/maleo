import type { Meta, StoryObj } from "@storybook/react-vite";
import { SelectionRow, SelectionRowLabel } from "@design-system/components/selection-row.tsx";

const meta = { title: "Components/Selection row" } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const ColumnSelection: Story = {
	render: () => (
		<div>
			<SelectionRow layout="inline">
				<SelectionRowLabel>Idle row</SelectionRowLabel>
				<small>0 tools · 1 instruction</small>
			</SelectionRow>
			<SelectionRow href="#selected" layout="inline" selected>
				<SelectionRowLabel>Selected row</SelectionRowLabel>
				<small>1 tool · 17 instructions</small>
			</SelectionRow>
			<SelectionRow href="#instruction" layout="stacked">
				<SelectionRowLabel>Instruction</SelectionRowLabel>
				<p>Short purpose summary with room for longer labels.</p>
			</SelectionRow>
		</div>
	),
};
