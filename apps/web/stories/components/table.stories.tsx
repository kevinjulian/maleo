import type { Meta, StoryObj } from "@storybook/react-vite";
import { Table, TableScroll } from "@design-system/components/table.tsx";

const meta = { title: "Components/Table", component: Table } satisfies Meta<typeof Table>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Inventory: Story = {
	render: () => (
		<TableScroll label="Definition inventory table">
			<Table>
				<caption>Definition inventory</caption>
				<thead>
					<tr>
						<th scope="col">Definition</th>
						<th scope="col">Content</th>
						<th scope="col">Consumers</th>
					</tr>
				</thead>
				<tbody>
					<tr>
						<td>Plan story</td>
						<td>Video</td>
						<td>2 direct</td>
					</tr>
					<tr data-selected="true">
						<td>Generate frame · Selected</td>
						<td>Image / video</td>
						<td>3 direct</td>
					</tr>
				</tbody>
			</Table>
		</TableScroll>
	),
};
